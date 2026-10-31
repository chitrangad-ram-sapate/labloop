import { offerNext } from "./booking";
import { fromFirestore, getFirebaseDb } from "./firebase";
import { audit, notify, notifyDepartment } from "./log";

/** Idempotent scheduler pass for expired cart holds, reminders, no-shows, overdue loans and offers. */
export async function tick() {
  const db = getFirebaseDb();
  const now = new Date();
  const expiredCart = await db.collection("cart_items").where("hold_expires_at", "<=", now).get();
  const expiredByResource = new Map<string, string[]>();
  for (const doc of expiredCart.docs) {
    const resourceId = String(doc.get("resource_id"));
    expiredByResource.set(resourceId, [...(expiredByResource.get(resourceId) ?? []), doc.id]);
  }
  for (const [resourceId, ids] of expiredByResource) {
    for (let offset = 0; offset < ids.length; offset += 450) {
      const refs = ids.slice(offset, offset + 450).map((id) => db.collection("cart_items").doc(id));
      const resourceRef = db.collection("resources").doc(resourceId);
      await db.runTransaction(async (tx) => {
        const [resource, ...holds] = await Promise.all([tx.get(resourceRef), ...refs.map((ref) => tx.get(ref))]);
        holds.forEach((hold) => { if (hold.exists && hold.get("hold_expires_at")?.toDate?.() <= now) tx.delete(hold.ref); });
        if (resource.exists) tx.update(resourceRef, { availability_version: Number(resource.get("availability_version") ?? 0) + 1 });
      });
    }
    await audit(null, null, "cart.hold_expired", "resource", resourceId, `${ids.length} expired cart hold(s) released back to inventory.`);
    await offerNext(null, resourceId);
  }

  let reminded = 0;
  const approved = await db.collection("bookings").where("status", "==", "APPROVED").get();
  for (const doc of approved.docs) {
    const booking = fromFirestore(doc.id, doc.data());
    const start = new Date(booking.start_at);
    if (booking.reminded_at || start < now || start > new Date(now.getTime() + 60 * 60_000)) continue;
    const resourceRef = db.collection("resources").doc(String(booking.resource_id));
    const resource = await resourceRef.get();
    const didRemind = await db.runTransaction(async (tx) => {
      const current = await tx.get(doc.ref);
      if (!current.exists || current.get("status") !== "APPROVED" || current.get("reminded_at")) return false;
      tx.update(doc.ref, { reminded_at: new Date() });
      return true;
    });
    if (didRemind) {
      await notify(null, String(booking.user_id), `${resource.get("name") ?? "Your booking"} starts within the hour`, "Remember to record its condition at check-out.", `/bookings/${booking.id}`);
      reminded++;
    }
  }

  let noShows = 0;
  for (const doc of approved.docs) {
    const booking = fromFirestore(doc.id, doc.data());
    if (new Date(booking.start_at) >= new Date(now.getTime() - 15 * 60_000)) continue;
    const resourceRef = db.collection("resources").doc(String(booking.resource_id));
    const changed = await db.runTransaction(async (tx) => {
      const [current, resource] = await Promise.all([tx.get(doc.ref), tx.get(resourceRef)]);
      if (!current.exists || current.get("status") !== "APPROVED") return false;
      tx.update(doc.ref, { status: "NO_SHOW" });
      if (resource.exists) tx.update(resourceRef, { availability_version: Number(resource.get("availability_version") ?? 0) + 1 });
      return true;
    });
    if (!changed) continue;
    noShows++;
    await audit(null, null, "booking.no_show", "booking", booking.id, "Not checked out within 15 minutes of the start, so the slot was released. This counts against reliability scoring.");
    await notify(null, String(booking.user_id), "Marked as no-show", "You didn't check out within 15 minutes of your start time, so the slot was released.", `/bookings/${booking.id}`);
    await offerNext(null, String(booking.resource_id));
  }

  let overdue = 0;
  const inUse = await db.collection("bookings").where("status", "==", "IN_USE").get();
  for (const doc of inUse.docs) {
    const booking = fromFirestore(doc.id, doc.data());
    if (new Date(booking.end_at) >= now) continue;
    const resource = await db.collection("resources").doc(String(booking.resource_id)).get();
    const changed = await db.runTransaction(async (tx) => {
      const current = await tx.get(doc.ref);
      if (!current.exists || current.get("status") !== "IN_USE") return false;
      tx.update(doc.ref, { status: "OVERDUE" });
      return true;
    });
    if (!changed) continue;
    overdue++;
    await audit(null, null, "booking.overdue", "booking", booking.id, "Not returned by the end time.");
    await notify(null, String(booking.user_id), `${resource.get("name") ?? "Resource"} is overdue`, "Please return it now and record its condition.", `/bookings/${booking.id}`);
    await notifyDepartment(null, String(resource.get("department_id")), `${resource.get("name") ?? "Resource"} is overdue`, "The borrower has been reminded.", `/bookings/${booking.id}`);
  }

  let expiredOffers = 0;
  const offers = await db.collection("bookings").where("status", "==", "OFFERED").get();
  for (const doc of offers.docs) {
    const booking = fromFirestore(doc.id, doc.data());
    if (!booking.offer_expires_at || new Date(booking.offer_expires_at) >= now) continue;
    const resourceRef = db.collection("resources").doc(String(booking.resource_id));
    const changed = await db.runTransaction(async (tx) => {
      const [current, resource] = await Promise.all([tx.get(doc.ref), tx.get(resourceRef)]);
      if (!current.exists || current.get("status") !== "OFFERED" || new Date(current.get("offer_expires_at")?.toDate?.() ?? current.get("offer_expires_at")).getTime() >= Date.now()) return false;
      tx.update(doc.ref, { status: "CANCELLED", decision_reason: "Waitlist offer expired before it was accepted." });
      if (resource.exists) tx.update(resourceRef, { availability_version: Number(resource.get("availability_version") ?? 0) + 1 });
      return true;
    });
    if (!changed) continue;
    expiredOffers++;
    await audit(null, null, "booking.cancelled", "booking", booking.id, "Waitlist offer expired; passed to the next person.");
    await notify(null, String(booking.user_id), "Waitlist offer expired", "The slot has been offered to the next person.", `/bookings/${booking.id}`);
    await offerNext(null, String(booking.resource_id));
  }

  return { expiredCartHolds: expiredCart.size, reminded, noShows, overdue, expiredOffers };
}
