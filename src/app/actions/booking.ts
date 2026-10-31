"use server";

import { redirect } from "next/navigation";
import { attempt, need, photo, str, type ActionResult } from "@/lib/action";
import { aiCompareReturn, aiSummariseIncident } from "@/lib/ai-jobs";
import { canManage, requireActor, type Actor } from "@/lib/auth";
import { getResource, isSupervised, offerNext, precheck, scoreFor, type Resource } from "@/lib/booking";
import { fromFirestore, getFirebaseDb, newRecordId } from "@/lib/firebase";
import { istToDate } from "@/lib/format";
import { audit, notify, notifyDepartment } from "@/lib/log";
import { assertTransition, HOLDING, MAX_ACTIVE_BOOKINGS, PURPOSES, type BookingStatus, type Purpose } from "@/lib/rules";

type Booking = Record<string, unknown> & { id: string; status: BookingStatus; user_id: string; resource_id: string; start_at: Date; end_at: Date; quantity: number };
const ACTIVE = ["PENDING_REVIEW", "APPROVED", "OFFERED", "IN_USE", "OVERDUE"];
const asDate = (value: unknown) => value instanceof Date ? value : new Date(value as string | number);
const startOf = (booking: Booking) => asDate(booking.start_at);
const endOf = (booking: Booking) => asDate(booking.end_at);
const overlap = (a: Date, b: Date, c: Date, d: Date) => a < d && b > c;
const slug = (value: string) => value.replace(/_/g, " ").toLowerCase();

function peak(rows: Array<{ start: Date; end: Date; quantity: number }>, start: Date, end: Date) {
  const points = [start, ...rows.map((row) => row.start).filter((time) => time > start && time < end)];
  return Math.max(0, ...points.map((time) => rows.filter((row) => row.start <= time && row.end > time).reduce((sum, row) => sum + row.quantity, 0)));
}

function activeUse(bookingSnapshot: FirebaseFirestore.QuerySnapshot, cartSnapshot: FirebaseFirestore.QuerySnapshot, resource: Resource, skipBooking?: string) {
  const bookings = bookingSnapshot.docs.map((doc) => fromFirestore(doc.id, doc.data()) as Booking).filter((row) => row.id !== skipBooking && HOLDING.includes(row.status)).map((row) => ({ start: startOf(row), end: new Date(endOf(row).getTime() + resource.turnaround_min * 60_000), quantity: Number(row.quantity ?? 1) }));
  const carts = cartSnapshot.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((row) => asDate(row.hold_expires_at) > new Date()).map((row) => ({ start: asDate(row.start_at), end: new Date(asDate(row.end_at).getTime() + Number(row.turnaround_min ?? resource.turnaround_min) * 60_000), quantity: Number(row.quantity) }));
  return [...bookings, ...carts];
}

async function load(id: string) {
  const bookingSnapshot = await getFirebaseDb().collection("bookings").doc(id).get();
  if (!bookingSnapshot.exists) throw new Error("Booking not found.");
  return fromFirestore(bookingSnapshot.id, bookingSnapshot.data()!) as Booking;
}

async function writeMove(bookingId: string, actor: Actor | null, to: BookingStatus, reason: string, extra: Record<string, unknown> = {}, requireCapacity = false) {
  const db = getFirebaseDb();
  const bookingRef = db.collection("bookings").doc(bookingId);
  const initial = await load(bookingId);
  const resourceRef = db.collection("resources").doc(initial.resource_id);
  const final = await db.runTransaction(async (tx) => {
    const [bookingSnapshot, resourceSnapshot, resourceBookings, resourceCarts, userBookings] = await Promise.all([
      tx.get(bookingRef), tx.get(resourceRef), tx.get(db.collection("bookings").where("resource_id", "==", initial.resource_id)),
      tx.get(db.collection("cart_items").where("resource_id", "==", initial.resource_id)),
      tx.get(db.collection("bookings").where("user_id", "==", initial.user_id)),
    ]);
    if (!bookingSnapshot.exists || bookingSnapshot.get("status") !== initial.status) throw new Error("This booking changed while you were viewing it. Refresh the page and try again.");
    const current = fromFirestore(bookingSnapshot.id, bookingSnapshot.data()!) as Booking;
    assertTransition(current.status, to);
    if (!resourceSnapshot.exists) throw new Error("Resource not found.");
    const resource = fromFirestore(resourceSnapshot.id, resourceSnapshot.data()!) as Resource;
    const activeUser = userBookings.docs.filter((doc) => doc.id !== bookingId && ACTIVE.includes(String(doc.get("status")))).length;
    if (to === "APPROVED" && activeUser >= MAX_ACTIVE_BOOKINGS) throw new Error(`You already have ${activeUser} active bookings (limit ${MAX_ACTIVE_BOOKINGS}).`);
    if (requireCapacity) {
      const used = activeUse(resourceBookings, resourceCarts, resource, bookingId);
      const end = new Date(endOf(current).getTime() + resource.turnaround_min * 60_000);
      if (peak(used, startOf(current), end) + Number(current.quantity ?? 1) > resource.units_available) throw new Error("This request no longer fits the available inventory. It can be waitlisted instead.");
    }
    await audit(tx, actor, `booking.${to.toLowerCase()}`, "booking", bookingId, reason, { from: current.status });
    const decision = ["APPROVED", "REJECTED", "WAITLISTED", "CANCELLED"].includes(to) ? { decision_reason: reason } : {};
    tx.update(bookingRef, { status: to, ...decision, ...extra, updated_at: new Date() });
    tx.update(resourceRef, { availability_version: Number(resourceSnapshot.get("availability_version") ?? 0) + 1 });
    return current;
  });
  if (actor?.id !== final.user_id) await notify(null, final.user_id, `${String(final.resource_name ?? "Resource")}: ${slug(to)}`, reason, `/bookings/${bookingId}`);
  return final;
}

export async function requestBooking(resourceId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const resource = await getResource(resourceId);
    if (!resource) throw new Error("Resource not found.");
    const date = need(fd, "date", "a date");
    const start = istToDate(date, need(fd, "from", "a start time"));
    const end = istToDate(date, need(fd, "to", "an end time"));
    const purpose = need(fd, "purpose", "a purpose") as Purpose;
    if (!Object.hasOwn(PURPOSES, purpose)) throw new Error("Pick a purpose.");
    const text = need(fd, "purpose_text", "a short description of what you'll do");
    const team = str(fd, "team_code").toUpperCase() || actor.team_code;
    const validation = await precheck(actor, resource, start, end, team);
    if (!validation.ok) throw new Error(validation.blocks.map((block) => block.message).join(" "));
    const score = await scoreFor(actor.id, resource.id, purpose);
    const db = getFirebaseDb();
    const bookingId = newRecordId();
    const bookingRef = db.collection("bookings").doc(bookingId);
    const profileRef = db.collection("profiles").doc(actor.id);
    await db.runTransaction(async (tx) => {
      const [profile, currentResource, userBookings] = await Promise.all([
        tx.get(profileRef), tx.get(db.collection("resources").doc(resource.id)), tx.get(db.collection("bookings").where("user_id", "==", actor.id)),
      ]);
      if (!profile.exists || !currentResource.exists || currentResource.get("status") !== "ACTIVE") throw new Error("Resource is no longer available.");
      const active = userBookings.docs.filter((doc) => ACTIVE.includes(String(doc.get("status")))).length;
      if (active >= MAX_ACTIVE_BOOKINGS) throw new Error(`You already have ${active} active bookings (limit ${MAX_ACTIVE_BOOKINGS}).`);
      await audit(tx, actor, "booking.requested", "booking", bookingId, `${PURPOSES[purpose].label}: ${text}`, { start, end, score: score.score, warnings: validation.warnings.map((warning) => warning.code) });
      tx.update(profileRef, { booking_version: Number(profile.get("booking_version") ?? 0) + 1 });
      tx.create(bookingRef, {
        resource_id: resource.id, resource_name: resource.name, department_id: resource.department_id,
        user_id: actor.id, user_name: actor.full_name, user_role: actor.role, org_name: actor.org_name,
        start_at: start, end_at: end, purpose_category: purpose, purpose_text: text, team_code: team,
        status: "PENDING_REVIEW", score: score.score, score_breakdown: score.breakdown, quantity: 1,
        request_group_id: null, decision_reason: null, decided_by: null, offer_expires_at: null,
        requested_end_at: null, checked_out_at: null, returned_at: null, reminded_at: null, created_at: new Date(),
      });
    });
    await notifyDepartment(null, resource.department_id, "New booking request", `${actor.full_name} (${actor.org_name}) requested ${resource.name}`, "/manage");
    redirect(`/bookings/${bookingId}`);
  });
}

export async function decide(id: string, to: "APPROVED" | "REJECTED" | "WAITLISTED", _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "manager", "admin");
    const booking = await load(id);
    const resource = await getResource(booking.resource_id);
    if (!resource || !canManage(actor, resource.department_id)) throw new Error("Only this resource's department can decide on it.");
    const reason = need(fd, "reason", "a reason the requester will see");
    await writeMove(id, actor, to, reason, { decided_by: actor.id, decision_reason: reason }, to === "APPROVED");
    if (to === "APPROVED") {
      const db = getFirebaseDb();
      const all = await db.collection("bookings").where("resource_id", "==", booking.resource_id).get();
      const competitors = all.docs.map((doc) => fromFirestore(doc.id, doc.data()) as Booking).filter((row) => row.id !== id && row.status === "PENDING_REVIEW" && overlap(startOf(row), new Date(endOf(row).getTime() + resource.turnaround_min * 60_000), startOf(booking), new Date(endOf(booking).getTime() + resource.turnaround_min * 60_000)));
      for (const rival of competitors) {
        const [bookings, carts] = await Promise.all([
          db.collection("bookings").where("resource_id", "==", booking.resource_id).get(),
          db.collection("cart_items").where("resource_id", "==", booking.resource_id).get(),
        ]);
        const rows = activeUse(bookings, carts, resource);
        const free = resource.units_available - peak(rows, startOf(rival), new Date(endOf(rival).getTime() + resource.turnaround_min * 60_000));
        if (free >= Number(rival.quantity ?? 1)) continue;
        const why = `This time was given to another request (“${reason}”) and the remaining ${Math.max(0, free)} unit(s) cannot fit your request. You are on the waitlist and will be offered capacity automatically if it frees up.`;
        await writeMove(rival.id, actor, "WAITLISTED", why);
      }
    }
    return to === "APPROVED" ? "Approved. Overlapping requests were waitlisted only where remaining unit capacity could not fit them." : "Decision recorded.";
  });
}

export async function cancelBooking(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const booking = await load(id);
    const resource = await getResource(booking.resource_id);
    if (!resource) throw new Error("Resource not found.");
    if (booking.user_id !== actor.id && !canManage(actor, resource.department_id)) throw new Error("You can't cancel this booking.");
    const reason = need(fd, "reason", "a reason");
    await writeMove(id, actor, "CANCELLED", reason);
    if (HOLDING.includes(booking.status)) await offerNext(null, booking.resource_id);
    if (actor.id === booking.user_id) await notifyDepartment(null, resource.department_id, `${resource.name}: booking cancelled`, reason, `/bookings/${id}`);
    return "Booking cancelled.";
  });
}

export async function answerOffer(id: string, accept: boolean) {
  const actor = await requireActor();
  const booking = await load(id);
  if (booking.user_id !== actor.id) throw new Error("Not your offer.");
  if (accept) await writeMove(id, actor, "APPROVED", "Accepted the waitlist offer.", { offer_expires_at: null }, true);
  else {
    await writeMove(id, actor, "CANCELLED", "Declined the waitlist offer.");
    await offerNext(null, booking.resource_id);
  }
  redirect(`/bookings/${id}`);
}

function checklistFrom(fd: FormData) {
  const out: Record<string, "ok" | "issue"> = {};
  for (const [key, value] of fd.entries()) if (key.startsWith("item:")) out[key.slice(5)] = value === "issue" ? "issue" : "ok";
  return out;
}

async function addConditionReport(bookingId: string, actor: Actor, phase: "CHECKOUT" | "RETURN", fd: FormData, status: "IN_USE" | "RETURNED") {
  const db = getFirebaseDb();
  const booking = await load(bookingId);
  const resourceRef = db.collection("resources").doc(booking.resource_id);
  const bookingRef = db.collection("bookings").doc(bookingId);
  const reportRef = db.collection("condition_reports").doc(`${bookingId}_${phase}`);
  const report = { booking_id: bookingId, phase, checklist: checklistFrom(fd), photo: photo(fd), notes: str(fd, "notes"), recorded_by: actor.id, ai_diff: null, created_at: new Date() };
  await db.runTransaction(async (tx) => {
    const [current, resource, existingReport] = await Promise.all([tx.get(bookingRef), tx.get(resourceRef), tx.get(reportRef)]);
    if (!current.exists || !resource.exists) throw new Error("Booking not found.");
    if (existingReport.exists) throw new Error(`The ${phase === "CHECKOUT" ? "check-out" : "return"} condition has already been recorded.`);
    const currentBooking = fromFirestore(current.id, current.data()!) as Booking;
    assertTransition(currentBooking.status, status);
    const issues = Object.entries(report.checklist).filter(([, value]) => value === "issue").map(([key]) => key);
    await audit(tx, actor, `booking.${status.toLowerCase()}`, "booking", bookingId, phase === "CHECKOUT" ? "Checked out; starting condition recorded." : issues.length ? `Returned with issues reported: ${issues.join(", ")}` : "Returned; no issues reported.");
    tx.create(reportRef, report);
    tx.update(bookingRef, { status, ...(phase === "CHECKOUT" ? { checked_out_at: new Date() } : { returned_at: new Date() }), updated_at: new Date() });
    if (status === "RETURNED") tx.update(resourceRef, { availability_version: Number(resource.get("availability_version") ?? 0) + 1 });
  });
  const resource = await getResource(booking.resource_id);
  const issues = Object.entries(report.checklist).filter(([, value]) => value === "issue").map(([key]) => key);
  if (status === "RETURNED" && resource) await notifyDepartment(null, resource.department_id, `${resource.name} returned, please inspect`, issues.length ? `Issues: ${issues.join(", ")}` : "No issues reported", `/bookings/${bookingId}`);
  return { booking, resource };
}

export async function checkOut(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const booking = await load(id);
    const resource = await getResource(booking.resource_id);
    const staff = Boolean(resource && canManage(actor, resource.department_id));
    const supervised = resource && isSupervised(resource, String(booking.user_role ?? "user"));
    if (!resource) throw new Error("Resource not found.");
    if (supervised && !staff) throw new Error("This resource is supervised: a lab manager must confirm the check-out in person.");
    if (!staff && actor.id !== booking.user_id) throw new Error("Only the booker or lab staff can check this out.");
    if (process.env.DEMO_MODE !== "true" && Date.now() < startOf(booking).getTime() - 15 * 60_000) throw new Error("Check-out opens 15 minutes before your start time.");
    if (resource.deposit_note && staff && fd.get("deposit") !== "on") throw new Error("Confirm the deposit was collected.");
    await addConditionReport(id, actor, "CHECKOUT", fd, "IN_USE");
    return "Checked out. Enjoy, and return it on time.";
  });
}

export async function returnItem(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const booking = await load(id);
    const resource = await getResource(booking.resource_id);
    if (!resource || (actor.id !== booking.user_id && !canManage(actor, resource.department_id))) throw new Error("Only the booker or lab staff can return this.");
    await addConditionReport(id, actor, "RETURN", fd, "RETURNED");
    aiCompareReturn(id);
    return "Returned. A lab manager will inspect it and close the booking.";
  });
}

export async function inspect(id: string, outcome: "CLOSED" | "DISPUTED", _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "manager", "admin");
    const booking = await load(id);
    const resource = await getResource(booking.resource_id);
    if (!resource || !canManage(actor, resource.department_id)) throw new Error("Only this resource's department can inspect it.");
    const note = need(fd, "reason", "an inspection note");
    await writeMove(id, actor, outcome, note);
    if (outcome === "DISPUTED") {
      const incidentId = newRecordId();
      const reportedBy = actor.id;
      await getFirebaseDb().collection("incidents").doc(incidentId).set({
        booking_id: id, resource_id: booking.resource_id, user_id: booking.user_id, reported_by: reportedBy,
        type: str(fd, "type") || "DAMAGE", severity: str(fd, "severity") || "LOW", description: note,
        ai_summary: null, status: "OPEN", resolution: null, penalty: null, reviewed_by: null,
        appeal_text: null, appeal_status: null, created_at: new Date(),
      });
      await audit(null, actor, "incident.reported", "booking", id, note, { incident: incidentId });
      aiSummariseIncident(incidentId);
    }
    return outcome === "CLOSED" ? "Inspection passed; booking closed." : `Incident opened for review (${id}).`;
  });
}

export async function requestExtension(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const booking = await load(id);
    if (booking.user_id !== actor.id) throw new Error("Not your booking.");
    const end = istToDate(startOf(booking).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), need(fd, "to", "a new end time"));
    if (end <= endOf(booking)) throw new Error("The new end time must be later than the current one.");
    await getFirebaseDb().collection("bookings").doc(id).update({ requested_end_at: end });
    const resource = await getResource(booking.resource_id);
    await audit(null, actor, "booking.extension_requested", "booking", id, need(fd, "reason", "a reason"), { to: end });
    if (resource) await notifyDepartment(null, resource.department_id, `${resource.name}: extension requested`, `${actor.full_name} asks to keep it longer`, `/bookings/${id}`);
    return "Extension requested. The owner will decide.";
  });
}

export async function decideExtension(id: string, approve: boolean, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "manager", "admin");
    const booking = await load(id);
    const resource = await getResource(booking.resource_id);
    if (!resource || !canManage(actor, resource.department_id) || !booking.requested_end_at) throw new Error("Nothing to decide.");
    const reason = need(fd, "reason", "a reason");
    const db = getFirebaseDb();
    const bookingRef = db.collection("bookings").doc(id);
    const resourceRef = db.collection("resources").doc(booking.resource_id);
    await db.runTransaction(async (tx) => {
      const [current, currentResource, bookings, carts] = await Promise.all([
        tx.get(bookingRef), tx.get(resourceRef), tx.get(db.collection("bookings").where("resource_id", "==", booking.resource_id)), tx.get(db.collection("cart_items").where("resource_id", "==", booking.resource_id)),
      ]);
      if (!current.exists || !current.get("requested_end_at")) throw new Error("Nothing to decide.");
      const end = asDate(current.get("requested_end_at"));
      if (approve) {
        const use = activeUse(bookings, carts, resource, id);
        const finish = new Date(end.getTime() + resource.turnaround_min * 60_000);
        if (peak(use, startOf(booking), finish) + Number(booking.quantity ?? 1) > resource.units_available) throw new Error("A booking or active hold conflicts with the extension.");
        tx.update(bookingRef, { end_at: end, requested_end_at: null });
      } else tx.update(bookingRef, { requested_end_at: null });
      tx.update(resourceRef, { availability_version: Number(currentResource.get("availability_version") ?? 0) + 1 });
    });
    await audit(null, actor, approve ? "booking.extension_approved" : "booking.extension_rejected", "booking", id, reason);
    await notify(null, booking.user_id, `${resource.name}: extension ${approve ? "approved" : "declined"}`, reason, `/bookings/${id}`);
    return approve ? "Extension approved." : "Extension declined.";
  });
}

export async function reportIncident(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const booking = await load(id);
    const resource = await getResource(booking.resource_id);
    if (!resource || (actor.id !== booking.user_id && !canManage(actor, resource.department_id))) throw new Error("Only people involved in this booking can report on it.");
    const incidentId = newRecordId();
    const description = need(fd, "description", "what happened");
    await getFirebaseDb().collection("incidents").doc(incidentId).set({ booking_id: id, resource_id: booking.resource_id, user_id: booking.user_id, reported_by: actor.id, type: need(fd, "type"), severity: need(fd, "severity"), description, ai_summary: null, status: "OPEN", resolution: null, penalty: null, reviewed_by: null, appeal_text: null, appeal_status: null, created_at: new Date() });
    await audit(null, actor, "incident.reported", "booking", id, description, { incident: incidentId, type: str(fd, "type") });
    await notifyDepartment(null, resource.department_id, `Incident reported: ${resource.name}`, description, `/bookings/${id}`);
    aiSummariseIncident(incidentId);
    return "Incident reported. A lab manager will review it.";
  });
}

export async function resolveIncident(incidentId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "manager", "admin");
    const db = getFirebaseDb();
    const incidentRef = db.collection("incidents").doc(incidentId);
    const incident = await incidentRef.get();
    if (!incident.exists) throw new Error("Incident not found.");
    const incidentData = incident.data()!;
    const resource = await getResource(String(incidentData.resource_id));
    if (!resource || !canManage(actor, resource.department_id)) throw new Error("Only this resource's department can resolve it.");
    const penalty = need(fd, "penalty");
    if (!["NONE", "WARNING", "STRIKE", "SUSPEND_7D"].includes(penalty)) throw new Error("Choose a valid outcome.");
    const resolution = need(fd, "resolution", "a resolution note");
    const bookingRef = incidentData.booking_id ? db.collection("bookings").doc(String(incidentData.booking_id)) : null;
    const profileRef = incidentData.user_id ? db.collection("profiles").doc(String(incidentData.user_id)) : null;
    await db.runTransaction(async (tx) => {
      const [current, booking, profile] = await Promise.all([
        tx.get(incidentRef), bookingRef ? tx.get(bookingRef) : Promise.resolve(null), profileRef ? tx.get(profileRef) : Promise.resolve(null),
      ]);
      if (!current.exists || current.get("status") !== "OPEN") throw new Error("Incident has already been resolved.");
      tx.update(incidentRef, { status: "RESOLVED", resolution, penalty, reviewed_by: actor.id });
      if (penalty === "SUSPEND_7D" && profile?.exists) tx.update(profile.ref, { suspended_until: new Date(Date.now() + 7 * 86_400_000) });
      if (booking?.exists && booking.get("status") === "DISPUTED") tx.update(booking.ref, { status: "CLOSED" });
    });
    const bookingId = String(incidentData.booking_id ?? "");
    await audit(null, actor, "incident.resolved", "booking", bookingId || null, resolution, { incident: incidentId, penalty });
    if (incidentData.user_id) await notify(null, String(incidentData.user_id), "Incident reviewed", `${resolution} (outcome: ${penalty.replace("_", " ").toLowerCase()}). You may appeal once.`, bookingId ? `/bookings/${bookingId}` : null);
    return "Incident resolved.";
  });
}

export async function appeal(incidentId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const db = getFirebaseDb();
    const incidentRef = db.collection("incidents").doc(incidentId);
    const incident = await incidentRef.get();
    if (!incident.exists || incident.get("user_id") !== actor.id) throw new Error("You can only appeal decisions about your own bookings.");
    if (incident.get("appeal_status")) throw new Error("You have already appealed this decision.");
    const text = need(fd, "appeal", "your reasons");
    await db.runTransaction(async (tx) => {
      const current = await tx.get(incidentRef);
      if (!current.exists || current.get("appeal_status")) throw new Error("You have already appealed this decision.");
      tx.update(incidentRef, { appeal_text: text, appeal_status: "PENDING" });
    });
    const bookingId = String(incident.get("booking_id") ?? "");
    await audit(null, actor, "incident.appealed", "booking", bookingId || null, text, { incident: incidentId });
    const admins = await db.collection("profiles").where("role", "==", "admin").get();
    await Promise.all(admins.docs.map((admin) => notify(null, admin.id, "New appeal to review", text, "/admin")));
    return "Appeal sent to an administrator.";
  });
}
