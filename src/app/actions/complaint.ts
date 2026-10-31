"use server";

import { attempt, need, photo, type ActionResult } from "@/lib/action";
import { aiSummariseComplaint } from "@/lib/ai-jobs";
import { canManage, requireActor } from "@/lib/auth";
import { COMPLAINT_ISSUES, COMPLAINT_TRANSITIONS, type ComplaintIssue, type ComplaintStatus } from "@/lib/complaints";
import { sql } from "@/lib/db";
import { audit, notify, notifyDepartment } from "@/lib/log";

async function complaintContext(ticketId: string) {
  const [ticket] = await sql`
    select t.id, t.booking_id, t.opened_by, t.status, b.user_id, r.department_id, r.name as resource_name
    from complaint_tickets t join bookings b on b.id = t.booking_id
    join resources r on r.id = b.resource_id where t.id = ${ticketId}`;
  if (!ticket) throw new Error("Complaint ticket not found.");
  return ticket;
}

export async function openComplaint(bookingId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const [booking] = await sql`select b.id, b.user_id, b.resource_id, r.department_id, r.name as resource_name
      from bookings b join resources r on r.id = b.resource_id where b.id = ${bookingId}`;
    if (!booking || booking.user_id !== actor.id) throw new Error("You can only open a complaint for your own booking.");
    const issue = need(fd, "issue_type") as ComplaintIssue;
    if (!Object.hasOwn(COMPLAINT_ISSUES, issue)) throw new Error("Choose a valid issue type.");
    const body = need(fd, "message", "a description of the issue");
    if (body.length > 5000) throw new Error("Please keep the complaint under 5,000 characters.");
    const evidence = photo(fd, "evidence");
    const ticketId = await sql.begin(async (tx) => {
      const [ticket] = await tx`insert into complaint_tickets (booking_id, opened_by, issue_type)
        values (${booking.id}, ${actor.id}, ${issue}) returning id`;
      await tx`insert into complaint_messages (ticket_id, author_id, body, status, evidence)
        values (${ticket.id}, ${actor.id}, ${body}, 'OPEN', ${evidence})`;
      await audit(tx, actor, "complaint.opened", "complaint_ticket", ticket.id, body, { booking_id: booking.id, issue_type: issue });
      await notifyDepartment(tx, booking.department_id, `Customer complaint: ${COMPLAINT_ISSUES[issue]}`,
        `${actor.full_name} opened a ticket for ${booking.resource_name}.`, `/bookings/${booking.id}`);
      return ticket.id as string;
    });
    aiSummariseComplaint(ticketId);
    return "Complaint ticket opened. The resource owner has been notified.";
  });
}

export async function addComplaintMessage(ticketId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const ticket = await complaintContext(ticketId);
    const staff = canManage(actor, ticket.department_id);
    if (!staff && actor.id !== ticket.opened_by) throw new Error("You cannot access this complaint.");
    if (ticket.status === "CLOSED") throw new Error("This complaint is closed and can no longer receive messages.");
    const body = need(fd, "message", "a message");
    if (body.length > 5000) throw new Error("Please keep the message under 5,000 characters.");
    const evidence = photo(fd, "evidence");
    await sql.begin(async (tx) => {
      const [current] = await tx`select status from complaint_tickets where id = ${ticketId} for update`;
      if (!current || current.status === "CLOSED") throw new Error("This complaint closed before your message could be added.");
      await tx`insert into complaint_messages (ticket_id, author_id, body, evidence)
        values (${ticketId}, ${actor.id}, ${body}, ${evidence})`;
      await tx`update complaint_tickets set updated_at = now() where id = ${ticketId}`;
      await audit(tx, actor, "complaint.message_added", "complaint_ticket", ticketId, "Complaint message added.", { evidence: Boolean(evidence) });
      if (staff) await notify(tx, ticket.opened_by, "New response to your complaint", `${ticket.resource_name}: ${body.slice(0, 180)}`, `/bookings/${ticket.booking_id}`);
      else await notifyDepartment(tx, ticket.department_id, "New message on a customer complaint", `${ticket.resource_name}: ${body.slice(0, 180)}`, `/bookings/${ticket.booking_id}`);
    });
    aiSummariseComplaint(ticketId);
    return "Message added to the complaint history.";
  });
}

export async function updateComplaintStatus(ticketId: string, to: ComplaintStatus, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "manager", "admin");
    const ticket = await complaintContext(ticketId);
    if (!canManage(actor, ticket.department_id)) throw new Error("Only staff for this resource's department can update the ticket.");
    if (!COMPLAINT_TRANSITIONS[ticket.status as ComplaintStatus]?.includes(to)) throw new Error("That complaint status transition is not allowed.");
    const note = need(fd, "message", "a status update for the customer");
    await sql.begin(async (tx) => {
      const changed = await tx`update complaint_tickets set status = ${to}, updated_at = now()
        where id = ${ticketId} and status = ${ticket.status} returning id`;
      if (!changed.length) throw new Error("This complaint changed while you were reviewing it. Refresh and try again.");
      await tx`insert into complaint_messages (ticket_id, author_id, body, status)
        values (${ticketId}, ${actor.id}, ${note}, ${to})`;
      await audit(tx, actor, `complaint.${to.toLowerCase()}`, "complaint_ticket", ticketId, note, { from: ticket.status, to });
      await notify(tx, ticket.opened_by, `Complaint ${to.replaceAll("_", " ").toLowerCase()}`, note, `/bookings/${ticket.booking_id}`);
    });
    aiSummariseComplaint(ticketId);
    return "Complaint status updated and the customer has been notified.";
  });
}

export async function escalateComplaint(ticketId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const ticket = await complaintContext(ticketId);
    if (actor.id !== ticket.opened_by) throw new Error("Only the customer who opened this complaint can escalate it.");
    if (!COMPLAINT_TRANSITIONS[ticket.status as ComplaintStatus]?.includes("ESCALATED")) throw new Error("This complaint cannot be escalated from its current status.");
    const note = need(fd, "message", "a reason for escalating");
    await sql.begin(async (tx) => {
      const changed = await tx`update complaint_tickets set status = 'ESCALATED', updated_at = now()
        where id = ${ticketId} and status = ${ticket.status} returning id`;
      if (!changed.length) throw new Error("This complaint changed while you were escalating it. Refresh and try again.");
      await tx`insert into complaint_messages (ticket_id, author_id, body, status) values (${ticketId}, ${actor.id}, ${note}, 'ESCALATED')`;
      await audit(tx, actor, "complaint.escalated", "complaint_ticket", ticketId, note);
      await tx`insert into notifications (user_id, title, body, link)
        select id, 'Complaint escalated', ${note}, ${`/bookings/${ticket.booking_id}`} from profiles where role = 'admin'`;
      await notifyDepartment(tx, ticket.department_id, "Complaint escalated", note, `/bookings/${ticket.booking_id}`);
    });
    aiSummariseComplaint(ticketId);
    return "Complaint escalated for further review.";
  });
}
