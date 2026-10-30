"use server";

import { redirect } from "next/navigation";
import type postgres from "postgres";
import { attempt, need, photo, str, type ActionResult } from "@/lib/action";
import { canManage, requireActor, type Actor } from "@/lib/auth";
import { getResource, isSupervised, offerNext, precheck, scoreFor } from "@/lib/booking";
import { sql } from "@/lib/db";
import { istToDate } from "@/lib/format";
import { audit, notify, notifyDepartment } from "@/lib/log";
import { assertTransition, HOLDING, PURPOSES, type BookingStatus, type Purpose } from "@/lib/rules";

export async function requestBooking(resourceId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const r = await getResource(resourceId);
    if (!r) throw new Error("Resource not found.");
    const date = need(fd, "date", "a date");
    const start = istToDate(date, need(fd, "from", "a start time"));
    const end = istToDate(date, need(fd, "to", "an end time"));
    const purpose = need(fd, "purpose", "a purpose") as Purpose;
    if (!(purpose in PURPOSES)) throw new Error("Pick a purpose.");
    const text = need(fd, "purpose_text", "a short description of what you'll do");
    const team = str(fd, "team_code").toUpperCase() || actor.team_code;

    const pc = await precheck(actor, r, start, end, team);
    if (!pc.ok) throw new Error(pc.blocks.map((b) => b.message).join(" "));
    const s = await scoreFor(actor.id, r.id, purpose);

    const id = await sql.begin(async (tx) => {
      const [b] = await tx`insert into bookings (resource_id, user_id, start_at, end_at, slot, purpose_category, purpose_text, team_code, status, score, score_breakdown)
        values (${r.id}, ${actor.id}, ${start}, ${end}, tstzrange(${start}::timestamptz, ${end}::timestamptz + make_interval(mins => ${r.turnaround_min})),
                ${purpose}, ${text}, ${team}, 'PENDING_REVIEW', ${s.score}, ${tx.json(s.breakdown as never)}) returning id`;
      await audit(tx, actor, "booking.requested", "booking", b.id, `${PURPOSES[purpose].label}: ${text}`,
        { start, end, score: s.score, warnings: pc.warnings.map((w) => w.code) });
      await notifyDepartment(tx, r.department_id, "New booking request", `${actor.full_name} (${actor.org_name}) requested ${r.name}`, "/manage");
      return b.id as string;
    });
    redirect(`/bookings/${id}`);
  });
}

type B = { id: string; status: BookingStatus; user_id: string; resource_id: string; department_id: string; resource_name: string; requested_end_at: Date | null; turnaround_min: number; start_at: Date; end_at: Date };

async function load(id: string) {
  const [b] = await sql<B[]>`select b.id, b.status, b.user_id, b.resource_id, b.requested_end_at, b.start_at, b.end_at,
    r.department_id, r.name as resource_name, r.turnaround_min from bookings b join resources r on r.id = b.resource_id where b.id = ${id}`;
  if (!b) throw new Error("Booking not found.");
  return b;
}

/** The one place a booking changes status: checks the state machine, writes the audit row and notifies the requester. */
async function move(tx: postgres.TransactionSql, actor: Actor | null, b: B, to: BookingStatus, reason: string, extra: Record<string, unknown> = {}) {
  assertTransition(b.status, to);
  // Decisions keep their reason on the booking so the requester always sees "why" at a glance.
  const decision = ["APPROVED", "REJECTED", "WAITLISTED", "CANCELLED"].includes(to) ? { decision_reason: reason } : {};
  await tx`update bookings set ${tx({ status: to, ...decision, ...extra } as never)} where id = ${b.id}`;
  await audit(tx, actor, `booking.${to.toLowerCase()}`, "booking", b.id, reason, { from: b.status });
  if (actor?.id !== b.user_id) await notify(tx, b.user_id, `${b.resource_name}: ${to.replace(/_/g, " ").toLowerCase()}`, reason, `/bookings/${b.id}`);
}

export async function decide(id: string, to: "APPROVED" | "REJECTED" | "WAITLISTED", _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "manager", "admin");
    const b = await load(id);
    if (!canManage(actor, b.department_id)) throw new Error("Only this resource's department can decide on it.");
    const reason = need(fd, "reason", "a reason the requester will see");
    await sql.begin(async (tx) => {
      await move(tx, actor, b, to, reason, { decided_by: actor.id, decision_reason: reason });
      if (to === "APPROVED") {
        // Competing requests for the same time go to the waitlist, with the reason spelled out.
        const losers = await tx<B[]>`select b.id, b.status, b.user_id, b.resource_id, r.department_id, r.name as resource_name
          from bookings b join resources r on r.id = b.resource_id
          where b.resource_id = ${b.resource_id} and b.id <> ${b.id} and b.status = 'PENDING_REVIEW'
            and b.slot && (select slot from bookings where id = ${b.id})`;
        for (const l of losers)
          await move(tx, actor, l, "WAITLISTED", `This time was given to another request (“${reason}”). You are on the waitlist and will be offered the slot automatically if it frees up.`);
      }
    });
    return to === "APPROVED" ? "Approved. Any overlapping requests were waitlisted." : "Decision recorded.";
  });
}

export async function cancelBooking(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const b = await load(id);
    if (b.user_id !== actor.id && !canManage(actor, b.department_id)) throw new Error("You can't cancel this booking.");
    const reason = need(fd, "reason", "a reason");
    await sql.begin(async (tx) => {
      await move(tx, actor, b, "CANCELLED", reason);
      if (HOLDING.includes(b.status)) await offerNext(tx, b.resource_id);
      if (actor.id === b.user_id) await notifyDepartment(tx, b.department_id, `${b.resource_name}: booking cancelled`, reason, `/bookings/${b.id}`);
    });
    return "Booking cancelled.";
  });
}

export async function answerOffer(id: string, accept: boolean) {
  const actor = await requireActor();
  const b = await load(id);
  if (b.user_id !== actor.id) throw new Error("Not your offer.");
  await sql.begin(async (tx) => {
    if (accept) await move(tx, actor, b, "APPROVED", "Accepted the waitlist offer.", { offer_expires_at: null });
    else {
      await move(tx, actor, b, "CANCELLED", "Declined the waitlist offer.");
      await offerNext(tx, b.resource_id);
    }
  });
  redirect(`/bookings/${id}`);
}

function checklistFrom(fd: FormData) {
  const out: Record<string, "ok" | "issue"> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("item:")) out[k.slice(5)] = v === "issue" ? "issue" : "ok";
  return out;
}

export async function checkOut(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const b = await load(id);
    const r = (await getResource(b.resource_id))!;
    const [owner] = await sql`select role from profiles where id = ${b.user_id}`;
    const staff = canManage(actor, b.department_id);
    if (isSupervised(r, owner.role) && !staff) throw new Error("This resource is supervised: a lab manager must confirm the check-out in person.");
    if (!staff && actor.id !== b.user_id) throw new Error("Only the booker or lab staff can check this out.");
    if (process.env.DEMO_MODE !== "true" && Date.now() < new Date(b.start_at).getTime() - 15 * 60_000)
      throw new Error("Check-out opens 15 minutes before your start time.");
    if (r.deposit_note && staff && fd.get("deposit") !== "on") throw new Error("Confirm the deposit was collected.");
    await sql.begin(async (tx) => {
      await tx`insert into condition_reports (booking_id, phase, checklist, photo, notes, recorded_by)
               values (${b.id}, 'CHECKOUT', ${tx.json(checklistFrom(fd))}, ${photo(fd)}, ${str(fd, "notes")}, ${actor.id})`;
      await move(tx, actor, b, "IN_USE", staff && actor.id !== b.user_id ? `Checked out under supervision of ${actor.full_name}` : "Checked out; starting condition recorded.", { checked_out_at: new Date() });
    });
    return "Checked out. Enjoy, and return it on time.";
  });
}

export async function returnItem(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const b = await load(id);
    if (actor.id !== b.user_id && !canManage(actor, b.department_id)) throw new Error("Only the booker or lab staff can return this.");
    const list = checklistFrom(fd);
    const issues = Object.entries(list).filter(([, v]) => v === "issue").map(([k]) => k);
    await sql.begin(async (tx) => {
      await tx`insert into condition_reports (booking_id, phase, checklist, photo, notes, recorded_by)
               values (${b.id}, 'RETURN', ${tx.json(list)}, ${photo(fd)}, ${str(fd, "notes")}, ${actor.id})`;
      await move(tx, actor, b, "RETURNED", issues.length ? `Returned with issues reported: ${issues.join(", ")}` : "Returned; no issues reported.", { returned_at: new Date() });
      await notifyDepartment(tx, b.department_id, `${b.resource_name} returned, please inspect`, issues.length ? `Issues: ${issues.join(", ")}` : "No issues reported", `/bookings/${b.id}`);
    });
    return "Returned. A lab manager will inspect it and close the booking.";
  });
}

export async function inspect(id: string, outcome: "CLOSED" | "DISPUTED", _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "manager", "admin");
    const b = await load(id);
    if (!canManage(actor, b.department_id)) throw new Error("Only this resource's department can inspect it.");
    const note = need(fd, "reason", "an inspection note");
    await sql.begin(async (tx) => {
      await move(tx, actor, b, outcome, note);
      if (outcome === "DISPUTED")
        await tx`insert into incidents (booking_id, resource_id, reported_by, type, severity, description)
                 values (${b.id}, ${b.resource_id}, ${actor.id}, ${str(fd, "type") || "DAMAGE"}, ${str(fd, "severity") || "LOW"}, ${note})`;
    });
    return outcome === "CLOSED" ? "Inspection passed; booking closed." : "Incident opened for review.";
  });
}

export async function requestExtension(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const b = await load(id);
    if (b.user_id !== actor.id) throw new Error("Not your booking.");
    const end = istToDate(new Date(b.end_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), need(fd, "to", "a new end time"));
    if (end <= new Date(b.end_at)) throw new Error("The new end time must be later than the current one.");
    await sql.begin(async (tx) => {
      await tx`update bookings set requested_end_at = ${end} where id = ${b.id}`;
      await audit(tx, actor, "booking.extension_requested", "booking", b.id, need(fd, "reason", "a reason"), { to: end });
      await notifyDepartment(tx, b.department_id, `${b.resource_name}: extension requested`, `${actor.full_name} asks to keep it longer`, `/bookings/${b.id}`);
    });
    return "Extension requested. The owner will decide.";
  });
}

export async function decideExtension(id: string, approve: boolean, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "manager", "admin");
    const b = await load(id);
    if (!canManage(actor, b.department_id) || !b.requested_end_at) throw new Error("Nothing to decide.");
    const reason = need(fd, "reason", "a reason");
    await sql.begin(async (tx) => {
      if (approve)
        await tx`update bookings set end_at = requested_end_at, requested_end_at = null,
                 slot = tstzrange(start_at, requested_end_at + make_interval(mins => ${b.turnaround_min})) where id = ${b.id}`;
      else await tx`update bookings set requested_end_at = null where id = ${b.id}`;
      await audit(tx, actor, approve ? "booking.extension_approved" : "booking.extension_rejected", "booking", b.id, reason);
      await notify(tx, b.user_id, `${b.resource_name}: extension ${approve ? "approved" : "declined"}`, reason, `/bookings/${b.id}`);
    });
    return approve ? "Extension approved." : "Extension declined.";
  });
}

export async function reportIncident(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const b = await load(id);
    if (actor.id !== b.user_id && !canManage(actor, b.department_id)) throw new Error("Only people involved in this booking can report on it.");
    await sql.begin(async (tx) => {
      const [i] = await tx`insert into incidents (booking_id, resource_id, reported_by, type, severity, description)
        values (${b.id}, ${b.resource_id}, ${actor.id}, ${need(fd, "type")}, ${need(fd, "severity")}, ${need(fd, "description", "what happened")}) returning id`;
      await audit(tx, actor, "incident.reported", "booking", b.id, str(fd, "description"), { incident: i.id, type: str(fd, "type") });
      await notifyDepartment(tx, b.department_id, `Incident reported: ${b.resource_name}`, str(fd, "description"), `/bookings/${b.id}`);
    });
    return "Incident reported. A lab manager will review it.";
  });
}

export async function resolveIncident(incidentId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "manager", "admin");
    const [i] = await sql`select i.*, r.department_id, b.user_id from incidents i join resources r on r.id = i.resource_id
                          left join bookings b on b.id = i.booking_id where i.id = ${incidentId}`;
    if (!i || !canManage(actor, i.department_id)) throw new Error("Only this resource's department can resolve it.");
    const penalty = need(fd, "penalty");
    const resolution = need(fd, "resolution", "a resolution note");
    await sql.begin(async (tx) => {
      await tx`update incidents set status = 'RESOLVED', resolution = ${resolution}, penalty = ${penalty}, reviewed_by = ${actor.id} where id = ${i.id}`;
      if (penalty === "SUSPEND_7D" && i.user_id) await tx`update profiles set suspended_until = now() + interval '7 days' where id = ${i.user_id}`;
      await audit(tx, actor, "incident.resolved", "booking", i.booking_id, resolution, { incident: i.id, penalty });
      if (i.booking_id) {
        const [b] = await tx`select status from bookings where id = ${i.booking_id}`;
        if (b.status === "DISPUTED") {
          await tx`update bookings set status = 'CLOSED' where id = ${i.booking_id}`;
          await audit(tx, actor, "booking.closed", "booking", i.booking_id, "Closed after incident review");
        }
      }
      if (i.user_id) await notify(tx, i.user_id, "Incident reviewed", `${resolution} (outcome: ${penalty.replace("_", " ").toLowerCase()}). You may appeal once.`, i.booking_id ? `/bookings/${i.booking_id}` : null);
    });
    return "Incident resolved.";
  });
}

export async function appeal(incidentId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const [i] = await sql`select i.id, i.booking_id, i.appeal_status, b.user_id from incidents i join bookings b on b.id = i.booking_id where i.id = ${incidentId}`;
    if (!i || i.user_id !== actor.id) throw new Error("You can only appeal decisions about your own bookings.");
    if (i.appeal_status) throw new Error("You have already appealed this decision.");
    const text = need(fd, "appeal", "your reasons");
    await sql.begin(async (tx) => {
      await tx`update incidents set appeal_text = ${text}, appeal_status = 'PENDING' where id = ${i.id}`;
      await audit(tx, actor, "incident.appealed", "booking", i.booking_id, text, { incident: i.id });
      await tx`insert into notifications (user_id, title, body, link) select id, 'New appeal to review', ${text}, '/admin' from profiles where role = 'admin'`;
    });
    return "Appeal sent to an administrator.";
  });
}
