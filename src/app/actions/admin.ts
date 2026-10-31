"use server";

import { redirect } from "next/navigation";
import { attempt, need, type ActionResult } from "@/lib/action";
import { requireActor } from "@/lib/auth";
import { fromFirestore, getFirebaseDb } from "@/lib/firebase";
import { audit, computeAuditHash, notify } from "@/lib/log";
import { tick } from "@/lib/tick";

export async function runScheduler() {
  return attempt(async () => {
    await requireActor("admin");
    const result = await tick();
    return `Scheduler ran: ${result.overdue} overdue, ${result.noShows} no-shows, ${result.expiredOffers} expired offers, ${result.reminded} reminders.`;
  });
}

export async function verifyChain() {
  return attempt(async () => {
    await requireActor("admin");
    const entries = (await getFirebaseDb().collection("audit_log").get()).docs.map((doc) => fromFirestore(doc.id, doc.data())).sort((a, b) => Number(a.sequence) - Number(b.sequence));
    let previous = "GENESIS";
    for (const entry of entries) {
      const expected = computeAuditHash(entry as never);
      if (entry.prev_hash !== previous || entry.hash !== expected) throw new Error(`Chain broken at entry #${entry.sequence}: that record was altered after it was written.`);
      previous = String(entry.hash);
    }
    return `Audit chain intact: all ${entries.length} entries verified.`;
  });
}

export async function decideAppeal(incidentId: string, uphold: boolean, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("admin");
    const reason = need(fd, "reason", "a reason");
    const db = getFirebaseDb();
    const incidentRef = db.collection("incidents").doc(incidentId);
    const incident = await incidentRef.get();
    if (!incident.exists || incident.get("appeal_status") !== "PENDING") throw new Error("Already decided.");
    const bookingId = String(incident.get("booking_id") ?? "");
    const profileId = String(incident.get("user_id") ?? "");
    const bookingRef = bookingId ? db.collection("bookings").doc(bookingId) : null;
    const profileRef = profileId ? db.collection("profiles").doc(profileId) : null;
    await db.runTransaction(async (tx) => {
      const [current, booking, profile] = await Promise.all([
        tx.get(incidentRef), bookingRef ? tx.get(bookingRef) : Promise.resolve(null), profileRef ? tx.get(profileRef) : Promise.resolve(null),
      ]);
      if (!current.exists || current.get("appeal_status") !== "PENDING") throw new Error("Already decided.");
      tx.update(incidentRef, { appeal_status: uphold ? "UPHELD" : "OVERTURNED", penalty: uphold ? current.get("penalty") : "NONE" });
      if (!uphold && profile?.exists) tx.update(profile.ref, { suspended_until: null });
      if (!uphold && booking?.exists && booking.get("status") === "DISPUTED") tx.update(booking.ref, { status: "CLOSED" });
    });
    await audit(null, actor, uphold ? "incident.appeal_upheld" : "incident.appeal_overturned", "booking", bookingId || null, reason, { incident: incidentId });
    if (!uphold && bookingId) await audit(null, actor, "booking.closed", "booking", bookingId, "Closed after appeal review");
    if (profileId) await notify(null, profileId, uphold ? "Appeal reviewed: decision stands" : "Appeal accepted: penalty removed", reason, bookingId ? `/bookings/${bookingId}` : null);
    return "Appeal decided.";
  });
}

export async function togglePartner(orgId: string) {
  const actor = await requireActor("admin");
  const orgRef = getFirebaseDb().collection("organizations").doc(orgId);
  let name = "";
  let active = false;
  await getFirebaseDb().runTransaction(async (tx) => {
    const organization = await tx.get(orgRef);
    if (!organization.exists || organization.get("kind") === "HOST") throw new Error("Only partner organisations can be changed here.");
    name = String(organization.get("name"));
    active = !organization.get("agreement_active");
    tx.update(orgRef, { agreement_active: active });
  });
  await audit(null, actor, active ? "partner.activated" : "partner.suspended", "organization", orgId, name);
  redirect("/admin");
}
