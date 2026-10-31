"use server";

import { attempt, need, photo, type ActionResult } from "@/lib/action";
import { aiSummariseComplaint } from "@/lib/ai-jobs";
import { canManage, requireActor } from "@/lib/auth";
import { COMPLAINT_ISSUES, COMPLAINT_TRANSITIONS, type ComplaintIssue, type ComplaintStatus } from "@/lib/complaints";
import { fromFirestore, getFirebaseDb, newRecordId } from "@/lib/firebase";
import { audit, notify, notifyDepartment } from "@/lib/log";

async function complaintContext(ticketId: string) {
  const db = getFirebaseDb();
  const ticketDoc = await db.collection("complaint_tickets").doc(ticketId).get();
  if (!ticketDoc.exists) throw new Error("Complaint ticket not found.");
  const ticket = fromFirestore(ticketDoc.id, ticketDoc.data()!);
  const bookingDoc = await db.collection("bookings").doc(String(ticket.booking_id)).get();
  if (!bookingDoc.exists) throw new Error("The booking linked to this complaint no longer exists.");
  const booking = fromFirestore(bookingDoc.id, bookingDoc.data()!);
  const resourceDoc = await db.collection("resources").doc(String(booking.resource_id)).get();
  if (!resourceDoc.exists) throw new Error("The resource linked to this complaint no longer exists.");
  const resource = fromFirestore(resourceDoc.id, resourceDoc.data()!);
  return { ...ticket, user_id: booking.user_id, department_id: resource.department_id, resource_name: resource.name };
}

export async function openComplaint(bookingId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const db = getFirebaseDb();
    const bookingDoc = await db.collection("bookings").doc(bookingId).get();
    if (!bookingDoc.exists || bookingDoc.get("user_id") !== actor.id) throw new Error("You can only open a complaint for your own booking.");
    const booking = fromFirestore(bookingDoc.id, bookingDoc.data()!);
    const resource = await db.collection("resources").doc(String(booking.resource_id)).get();
    if (!resource.exists) throw new Error("Resource not found.");
    const issue = need(fd, "issue_type") as ComplaintIssue;
    if (!Object.hasOwn(COMPLAINT_ISSUES, issue)) throw new Error("Choose a valid issue type.");
    const body = need(fd, "message", "a description of the issue");
    if (body.length > 5000) throw new Error("Please keep the complaint under 5,000 characters.");
    const evidence = photo(fd, "evidence");
    const ticketId = newRecordId();
    const messageId = newRecordId();
    const now = new Date();
    const batch = db.batch();
    batch.create(db.collection("complaint_tickets").doc(ticketId), { booking_id: bookingId, opened_by: actor.id, issue_type: issue, status: "OPEN", ai_summary: null, created_at: now, updated_at: now });
    batch.create(db.collection("complaint_messages").doc(messageId), { ticket_id: ticketId, author_id: actor.id, body, status: "OPEN", evidence: evidence ?? null, created_at: now });
    await batch.commit();
    await audit(null, actor, "complaint.opened", "complaint_ticket", ticketId, body, { booking_id: bookingId, issue_type: issue });
    await notifyDepartment(null, String(resource.get("department_id")), `Customer complaint: ${COMPLAINT_ISSUES[issue]}`, `${actor.full_name} opened a ticket for ${String(resource.get("name"))}.`, `/bookings/${bookingId}`);
    aiSummariseComplaint(ticketId);
    return "Complaint ticket opened. The resource owner has been notified.";
  });
}

export async function addComplaintMessage(ticketId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const ticket = await complaintContext(ticketId);
    const staff = canManage(actor, String(ticket.department_id));
    if (!staff && actor.id !== ticket.opened_by) throw new Error("You cannot access this complaint.");
    if (ticket.status === "CLOSED") throw new Error("This complaint is closed and can no longer receive messages.");
    const body = need(fd, "message", "a message");
    if (body.length > 5000) throw new Error("Please keep the message under 5,000 characters.");
    const evidence = photo(fd, "evidence");
    const db = getFirebaseDb();
    const ticketRef = db.collection("complaint_tickets").doc(ticketId);
    const messageRef = db.collection("complaint_messages").doc(newRecordId());
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ticketRef);
      if (!current.exists || current.get("status") === "CLOSED") throw new Error("This complaint closed before your message could be added.");
      tx.create(messageRef, { ticket_id: ticketId, author_id: actor.id, body, status: null, evidence: evidence ?? null, created_at: new Date() });
      tx.update(ticketRef, { updated_at: new Date() });
    });
    await audit(null, actor, "complaint.message_added", "complaint_ticket", ticketId, "Complaint message added.", { evidence: Boolean(evidence) });
    if (staff) await notify(null, String(ticket.opened_by), "New response to your complaint", `${String(ticket.resource_name)}: ${body.slice(0, 180)}`, `/bookings/${ticket.booking_id}`);
    else await notifyDepartment(null, String(ticket.department_id), "New message on a customer complaint", `${String(ticket.resource_name)}: ${body.slice(0, 180)}`, `/bookings/${ticket.booking_id}`);
    aiSummariseComplaint(ticketId);
    return "Message added to the complaint history.";
  });
}

async function changeComplaintStatus(ticketId: string, to: ComplaintStatus, actorId: string, note: string) {
  const ticket = await complaintContext(ticketId);
  if (!COMPLAINT_TRANSITIONS[ticket.status as ComplaintStatus]?.includes(to)) throw new Error("That complaint status transition is not allowed.");
  const actor = await requireActor();
  if (actor.id !== actorId) throw new Error("Your session changed. Please try again.");
  const db = getFirebaseDb();
  const ticketRef = db.collection("complaint_tickets").doc(ticketId);
  const messageRef = db.collection("complaint_messages").doc(newRecordId());
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ticketRef);
    if (!current.exists || current.get("status") !== ticket.status) throw new Error("This complaint changed while you were reviewing it. Refresh and try again.");
    tx.update(ticketRef, { status: to, updated_at: new Date() });
    tx.create(messageRef, { ticket_id: ticketId, author_id: actor.id, body: note, status: to, evidence: null, created_at: new Date() });
  });
  await audit(null, actor, `complaint.${to.toLowerCase()}`, "complaint_ticket", ticketId, note, { from: ticket.status, to });
  await notify(null, String(ticket.opened_by), `Complaint ${to.replaceAll("_", " ").toLowerCase()}`, note, `/bookings/${ticket.booking_id}`);
  return ticket;
}

export async function updateComplaintStatus(ticketId: string, to: ComplaintStatus, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "manager", "admin");
    const ticket = await complaintContext(ticketId);
    if (!canManage(actor, String(ticket.department_id))) throw new Error("Only staff for this resource's department can update the ticket.");
    const note = need(fd, "message", "a status update for the customer");
    await changeComplaintStatus(ticketId, to, actor.id, note);
    aiSummariseComplaint(ticketId);
    return "Complaint status updated and the customer has been notified.";
  });
}

export async function escalateComplaint(ticketId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const ticket = await complaintContext(ticketId);
    if (actor.id !== ticket.opened_by) throw new Error("Only the customer who opened this complaint can escalate it.");
    const note = need(fd, "message", "a reason for escalating");
    await changeComplaintStatus(ticketId, "ESCALATED", actor.id, note);
    const db = getFirebaseDb();
    const admins = await db.collection("profiles").where("role", "==", "admin").get();
    await Promise.all(admins.docs.map((admin) => notify(null, admin.id, "Complaint escalated", note, `/bookings/${ticket.booking_id}`)));
    await notifyDepartment(null, String(ticket.department_id), "Complaint escalated", note, `/bookings/${ticket.booking_id}`);
    aiSummariseComplaint(ticketId);
    return "Complaint escalated for further review.";
  });
}
