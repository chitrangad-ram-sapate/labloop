"use server";

import { redirect } from "next/navigation";
import { attempt, need, str, type ActionResult } from "@/lib/action";
import { requireActor, type Actor } from "@/lib/auth";
import { getResource, offerNext, openHoursPerWeek, precheck, scoreFor, type Resource } from "@/lib/booking";
import { fromFirestore, getFirebaseDb, newRecordId } from "@/lib/firebase";
import { istToDate } from "@/lib/format";
import { audit, notifyDepartment } from "@/lib/log";
import { MAX_ACTIVE_BOOKINGS, MAX_WEEKLY_HIGH_DEMAND_BOOKINGS, PURPOSES, type Purpose } from "@/lib/rules";

const HOLD_MINUTES = 12;
const ACTIVE = ["PENDING_REVIEW", "APPROVED", "OFFERED", "IN_USE", "OVERDUE"];
type CartLine = { id: string; user_id: string; resource_id: string; quantity: number; start_at: Date; end_at: Date; turnaround_min: number; purpose_category: string; purpose_text: string; team_code: string | null; hold_expires_at: Date; created_at: Date };
const asDate = (v: unknown) => v instanceof Date ? v : new Date(v as string | number);
const quantityFrom = (fd: FormData) => {
  const n = Number(need(fd, "quantity", "a quantity"));
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error("Quantity must be a whole number between 1 and 1,000.");
  return n;
};

function istWeekStart(value: Date) {
  const localDate = value.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const mondayNoon = new Date(`${localDate}T12:00:00+05:30`);
  mondayNoon.setUTCDate(mondayNoon.getUTCDate() - ((mondayNoon.getUTCDay() + 6) % 7));
  return mondayNoon.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function peak(rows: Array<{ start: Date; end: Date; quantity: number }>, start: Date, end: Date) {
  const points = [start, ...rows.map((row) => row.start).filter((time) => time > start && time < end)];
  return Math.max(0, ...points.map((time) => rows.filter((row) => row.start <= time && row.end > time).reduce((sum, row) => sum + row.quantity, 0)));
}

function occupancy(bookings: CartLine[], carts: CartLine[], resource: Resource, now = new Date()) {
  const activeBookings = bookings.filter((row) => ["APPROVED", "OFFERED", "IN_USE", "OVERDUE"].includes(row.purpose_category) || ["APPROVED", "OFFERED", "IN_USE", "OVERDUE"].includes(String((row as unknown as { status?: string }).status)));
  const used = activeBookings.map((row) => ({ start: row.start_at, end: new Date(row.end_at.getTime() + resource.turnaround_min * 60_000), quantity: Number(row.quantity ?? 1) }));
  const held = carts.filter((row) => row.hold_expires_at > now).map((row) => ({ start: row.start_at, end: new Date(row.end_at.getTime() + Number(row.turnaround_min ?? resource.turnaround_min) * 60_000), quantity: Number(row.quantity) }));
  return [...used, ...held];
}

async function validateWeeklyLimits(actor: Actor, cart: CartLine[], resources: Map<string, Resource>, bookingsByResource?: Map<string, CartLine[]>) {
  const weekly = new Map<string, CartLine[]>();
  for (const line of cart) {
    const resource = resources.get(line.resource_id)!;
    if (!resource.high_demand) continue;
    const key = `${resource.id}:${istWeekStart(line.start_at)}`;
    weekly.set(key, [...(weekly.get(key) ?? []), line]);
  }
  for (const lines of weekly.values()) {
    const resource = resources.get(lines[0].resource_id)!;
    const week = istWeekStart(lines[0].start_at);
    const weekStart = new Date(`${week}T00:00:00+05:30`);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
    const existing = bookingsByResource?.get(resource.id) ?? (await getFirebaseDb().collection("bookings").where("resource_id", "==", resource.id).get()).docs.map((doc) => fromFirestore(doc.id, doc.data()) as CartLine);
    const counted = existing.filter((row) => asDate(row.start_at) >= weekStart && asDate(row.start_at) < weekEnd && !["REJECTED", "CANCELLED", "NO_SHOW"].includes(String((row as unknown as { status?: string }).status)));
    const mine = counted.filter((row) => row.user_id === actor.id);
    const proposedHours = lines.reduce((sum, line) => sum + (line.end_at.getTime() - line.start_at.getTime()) / 3_600_000, 0);
    const currentUserHours = mine.reduce((sum, row) => sum + (asDate(row.end_at).getTime() - asDate(row.start_at).getTime()) / 3_600_000, 0);
    if (mine.length + lines.length > MAX_WEEKLY_HIGH_DEMAND_BOOKINGS) throw new Error(`${resource.name}: this combined request exceeds the limit of ${MAX_WEEKLY_HIGH_DEMAND_BOOKINGS} bookings per person per week.`);
    if (currentUserHours + proposedHours > resource.max_hours_week) throw new Error(`${resource.name}: this combined request exceeds the weekly ${resource.max_hours_week}-hour limit.`);
    if (actor.role === "external") {
      const externalUsers = new Set((await getFirebaseDb().collection("profiles").where("role", "==", "external").get()).docs.map((doc) => doc.id));
      const externalHours = counted.filter((row) => externalUsers.has(row.user_id)).reduce((sum, row) => sum + (asDate(row.end_at).getTime() - asDate(row.start_at).getTime()) / 3_600_000, 0);
      if (externalHours + proposedHours > openHoursPerWeek(resource) * resource.external_max_pct / 100) throw new Error(`${resource.name}: this combined request exceeds the external-user weekly share.`);
    }
    const teamHours = new Map<string, number>();
    for (const row of counted) if (row.team_code) teamHours.set(row.team_code, (teamHours.get(row.team_code) ?? 0) + (asDate(row.end_at).getTime() - asDate(row.start_at).getTime()) / 3_600_000);
    const proposedTeamHours = new Map<string, number>();
    for (const line of lines) if (line.team_code) proposedTeamHours.set(line.team_code, (proposedTeamHours.get(line.team_code) ?? 0) + (line.end_at.getTime() - line.start_at.getTime()) / 3_600_000);
    for (const [team, hours] of proposedTeamHours) if ((teamHours.get(team) ?? 0) + hours > openHoursPerWeek(resource) * 0.3) throw new Error(`${resource.name}: team ${team} would exceed the 30% weekly allocation cap.`);
  }
}

function bookingWindow(fd: FormData) {
  const date = need(fd, "date", "a date");
  const from = need(fd, "from", "a start time");
  const to = need(fd, "to", "an end time");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) throw new Error("Choose a valid date and time.");
  const validTime = (value: string) => Number(value.slice(0, 2)) < 24 && Number(value.slice(3, 5)) < 60;
  if (!validTime(from) || !validTime(to)) throw new Error("Choose a valid 24-hour time.");
  const start = istToDate(date, from);
  const end = istToDate(date, to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("End time must be after start time.");
  if (start.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) !== date) throw new Error("Choose a valid calendar date.");
  return { start, end };
}

export async function addCartItem(resourceId: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const resource = await getResource(resourceId);
    if (!resource) throw new Error("Resource not found.");
    const { start, end } = bookingWindow(fd);
    const quantity = quantityFrom(fd);
    const purpose = need(fd, "purpose", "a purpose") as Purpose;
    if (!Object.hasOwn(PURPOSES, purpose)) throw new Error("Pick a valid purpose.");
    const purposeText = need(fd, "purpose_text", "a short description of what you'll do");
    if (purposeText.length > 1000) throw new Error("Please keep the purpose under 1,000 characters.");
    const team = str(fd, "team_code").toUpperCase() || actor.team_code;
    const check = await precheck(actor, resource, start, end, team);
    if (!check.ok) throw new Error(check.blocks.map((x) => x.message).join(" "));

    const db = getFirebaseDb();
    const resourceRef = db.collection("resources").doc(resourceId);
    const lineId = newRecordId();
    const existingCartQuery = db.collection("cart_items").where("user_id", "==", actor.id).where("resource_id", "==", resourceId);
    const bookingQuery = db.collection("bookings").where("resource_id", "==", resourceId);
    const cartQuery = db.collection("cart_items").where("resource_id", "==", resourceId);
  let savedId: string = lineId;
    await db.runTransaction(async (tx) => {
      const [resourceSnap, ownCarts, bookings, carts] = await Promise.all([tx.get(resourceRef), tx.get(existingCartQuery), tx.get(bookingQuery), tx.get(cartQuery)]);
      if (!resourceSnap.exists || resourceSnap.get("status") !== "ACTIVE") throw new Error("Resource is no longer available.");
      const existing = ownCarts.docs.map((doc) => fromFirestore(doc.id, doc.data()) as CartLine).find((line) =>
        line.start_at.getTime() === start.getTime() && line.end_at.getTime() === end.getTime() && line.purpose_category === purpose && line.hold_expires_at > new Date());
      const bookingRows = bookings.docs.map((doc) => fromFirestore(doc.id, doc.data()) as CartLine);
      const cartRows = carts.docs.map((doc) => fromFirestore(doc.id, doc.data()) as CartLine);
      const used = occupancy(bookingRows, cartRows.filter((line) => line.id !== existing?.id), resource);
      const finish = new Date(end.getTime() + resource.turnaround_min * 60_000);
      const allocated = peak(used, start, finish);
      if (allocated + quantity > resource.units_available) throw new Error(`Only ${Math.max(0, resource.units_available - allocated)} unit(s) are available for that time; other bookings or active cart holds use the rest.`);
      savedId = existing?.id ?? lineId;
      const line = {
        user_id: actor.id, resource_id: resourceId, quantity, start_at: start, end_at: end, turnaround_min: resource.turnaround_min,
        purpose_category: purpose, purpose_text: purposeText, team_code: team, hold_expires_at: new Date(Date.now() + HOLD_MINUTES * 60_000),
        created_at: existing?.created_at ?? new Date(),
      };
      await audit(tx, actor, "cart.hold_created", "resource", resourceId, `Held ${quantity} unit(s) for ${HOLD_MINUTES} minutes.`, { cart_item: savedId, start, end });
      tx.update(resourceRef, { availability_version: Number(resourceSnap.get("availability_version") ?? 0) + 1 });
      tx.set(db.collection("cart_items").doc(savedId), line);
    });
    return `Added to your cart. This hold expires in ${HOLD_MINUTES} minutes.`;
  });
}

export async function changeCartQuantity(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const delta = Number(str(fd, "delta"));
    if (delta !== -1 && delta !== 1) throw new Error("Invalid quantity change.");
    const db = getFirebaseDb();
    const lineRef = db.collection("cart_items").doc(id);
    const initial = await lineRef.get();
    if (!initial.exists || initial.get("user_id") !== actor.id) throw new Error("Cart hold not found or already expired.");
    const resourceId = String(initial.get("resource_id"));
    const resourceRef = db.collection("resources").doc(resourceId);
    await db.runTransaction(async (tx) => {
      const [resourceSnap, lineSnap, bookings, carts] = await Promise.all([
        tx.get(resourceRef), tx.get(lineRef), tx.get(db.collection("bookings").where("resource_id", "==", resourceId)), tx.get(db.collection("cart_items").where("resource_id", "==", resourceId)),
      ]);
      if (!resourceSnap.exists || !lineSnap.exists || lineSnap.get("user_id") !== actor.id) throw new Error("Cart hold not found.");
      const resource = fromFirestore(resourceSnap.id, resourceSnap.data()!) as Resource;
      const line = fromFirestore(lineSnap.id, lineSnap.data()!) as CartLine;
      if (line.hold_expires_at <= new Date()) throw new Error("This cart hold expired. Remove it and add the resource again.");
      const quantity = Number(line.quantity) + delta;
      if (quantity < 1 || quantity > resource.units_available) throw new Error("Quantity must stay between 1 and the resource's available unit count.");
      const bookingsRows = bookings.docs.map((doc) => fromFirestore(doc.id, doc.data()) as CartLine);
      const cartsRows = carts.docs.map((doc) => fromFirestore(doc.id, doc.data()) as CartLine).filter((row) => row.id !== id);
      const allocated = peak(occupancy(bookingsRows, cartsRows, resource), line.start_at, new Date(line.end_at.getTime() + resource.turnaround_min * 60_000));
      if (allocated + quantity > resource.units_available) throw new Error(`Only ${Math.max(0, resource.units_available - allocated)} unit(s) remain for that time.`);
      await audit(tx, actor, "cart.quantity_changed", "resource", resourceId, `Cart quantity set to ${quantity}.`, { cart_item: id });
      tx.update(resourceRef, { availability_version: Number(resourceSnap.get("availability_version") ?? 0) + 1 });
      tx.update(lineRef, { quantity, hold_expires_at: new Date(Date.now() + HOLD_MINUTES * 60_000) });
    });
    if (delta < 0) await offerNext(null, resourceId);
    return "Cart quantity updated; the 12-minute hold has been renewed.";
  });
}

export async function removeCartItem(id: string, _: ActionResult, _fd: FormData) {
  void _; void _fd;
  return attempt(async () => {
    const actor = await requireActor();
    const db = getFirebaseDb();
    const lineRef = db.collection("cart_items").doc(id);
    const initial = await lineRef.get();
    if (!initial.exists || initial.get("user_id") !== actor.id) throw new Error("Cart item not found.");
    const resourceId = String(initial.get("resource_id"));
    const resourceRef = db.collection("resources").doc(resourceId);
    await db.runTransaction(async (tx) => {
      const [resource, line] = await Promise.all([tx.get(resourceRef), tx.get(lineRef)]);
      if (!line.exists || line.get("user_id") !== actor.id) throw new Error("Cart item changed before it could be removed.");
      await audit(tx, actor, "cart.hold_released", "resource", resourceId, "Removed from cart.", { cart_item: id });
      if (resource.exists) tx.update(resourceRef, { availability_version: Number(resource.get("availability_version") ?? 0) + 1 });
      tx.delete(lineRef);
    });
    await offerNext(null, resourceId);
    return "Resource removed from your cart and its hold released.";
  });
}

export async function submitCart(_: ActionResult, _fd: FormData) {
  void _; void _fd;
  return attempt(async () => {
    const actor = await requireActor();
    const db = getFirebaseDb();
    const cartQuery = db.collection("cart_items").where("user_id", "==", actor.id);
    const cartSnapshot = await cartQuery.get();
    const cart = cartSnapshot.docs.map((doc) => fromFirestore(doc.id, doc.data()) as CartLine).sort((a, b) => a.resource_id.localeCompare(b.resource_id) || a.start_at.getTime() - b.start_at.getTime());
    if (!cart.length) throw new Error("Your cart is empty.");
    if (cart.length > 75) throw new Error("A combined booking request can contain at most 75 cart items. Submit this request first, then add the remaining items.");
    if (cart.some((line) => line.hold_expires_at <= new Date())) throw new Error("At least one cart hold expired. Remove expired items and add them again before submitting.");
    const resources = new Map<string, Resource>();
    for (const line of cart) {
      const resource = await getResource(line.resource_id);
      if (!resource || resource.status !== "ACTIVE") throw new Error(`A resource in your cart is no longer available.`);
      resources.set(line.resource_id, resource);
      const check = await precheck(actor, resource, line.start_at, line.end_at, line.team_code);
      if (!check.ok) throw new Error(`${resource.name}: ${check.blocks.map((x) => x.message).join(" ")}`);
    }
    await validateWeeklyLimits(actor, cart, resources);
    for (const resource of resources.values()) {
      if (!resource.cooldown_hours) continue;
      const lines = cart.filter((line) => line.resource_id === resource.id).sort((a, b) => a.start_at.getTime() - b.start_at.getTime());
      for (let i = 1; i < lines.length; i++) if (lines[i].start_at.getTime() < lines[i - 1].end_at.getTime() + resource.cooldown_hours * 3_600_000) throw new Error(`${resource.name}: cart items must leave a ${resource.cooldown_hours}-hour cooldown.`);
    }

    const requestId = newRecordId();
    const bookingIds = new Map(cart.map((line) => [line.id, newRecordId()]));
    const scores = new Map(await Promise.all([...resources.values()].map(async (resource) => [resource.id, await scoreFor(actor.id, resource.id, cart.find((line) => line.resource_id === resource.id)!.purpose_category as Purpose)] as const)));
    const requestRef = db.collection("booking_requests").doc(requestId);
    const resourceRefs = [...resources.keys()].map((resourceId) => db.collection("resources").doc(resourceId));
    const bookingQueries = [...resources.keys()].map((resourceId) => db.collection("bookings").where("resource_id", "==", resourceId));
    const userBookingsQuery = db.collection("bookings").where("user_id", "==", actor.id);
    await db.runTransaction(async (tx) => {
      const [latest, ownBookings, ...resourceAndBookingSnapshots] = await Promise.all([
        tx.get(cartQuery), tx.get(userBookingsQuery), ...resourceRefs.map((ref) => tx.get(ref)), ...bookingQueries.map((query) => tx.get(query)),
      ]);
      const latestLines = latest.docs.map((doc) => fromFirestore(doc.id, doc.data()) as CartLine);
      if (latestLines.length !== cart.length || latestLines.some((line) => line.hold_expires_at <= new Date())) throw new Error("Your cart changed or a hold expired. Refresh the cart and try again.");
      if (ownBookings.docs.filter((doc) => ACTIVE.includes(String(doc.get("status")))).length + latestLines.length > MAX_ACTIVE_BOOKINGS) throw new Error(`This combined request would exceed your limit of ${MAX_ACTIVE_BOOKINGS} active bookings.`);
      const resourceSnapshots = resourceAndBookingSnapshots.slice(0, resourceRefs.length) as FirebaseFirestore.DocumentSnapshot[];
      const bookingSnapshots = resourceAndBookingSnapshots.slice(resourceRefs.length) as FirebaseFirestore.QuerySnapshot[];
      for (let i = 0; i < resourceSnapshots.length; i++) {
        const resourceSnapshot = resourceSnapshots[i];
        const resource = fromFirestore(resourceSnapshot.id, resourceSnapshot.data() ?? {}) as Resource;
        if (!resourceSnapshot.exists || resource.status !== "ACTIVE") throw new Error("A resource in your cart is no longer available.");
        const bookings = bookingSnapshots[i].docs.map((doc) => fromFirestore(doc.id, doc.data()) as CartLine);
        const carts = latest.docs.map((doc) => fromFirestore(doc.id, doc.data()) as CartLine);
        const allocated = peak(occupancy(bookings, carts, resource), new Date(0), new Date(8640000000000000));
        if (allocated > resource.units_available) throw new Error(`${resource.name}: inventory changed while your cart was open. Refresh and try again.`);
      }
      const latestIds = new Set(latest.docs.map((doc) => doc.id));
      if (cart.some((line) => !latestIds.has(line.id))) throw new Error("Your cart changed. Refresh and try again.");
      await audit(tx, actor, "booking.request_group_submitted", "booking_request", requestId, `Submitted ${latestLines.length} booking item(s) from cart.`, { items: latestLines.length });
      for (const line of latestLines) {
        const resource = resources.get(line.resource_id)!;
        const bookingId = bookingIds.get(line.id)!;
        await audit(tx, actor, "booking.requested", "booking", bookingId, `${line.quantity} unit(s) of ${resource.name}: ${PURPOSES[line.purpose_category as Purpose].label} — ${line.purpose_text}`, { request_id: requestId, quantity: line.quantity, start: line.start_at, end: line.end_at });
      }
      for (let i = 0; i < resourceSnapshots.length; i++) tx.update(resourceRefs[i], { availability_version: Number(resourceSnapshots[i].get("availability_version") ?? 0) + 1 });
      const request = { user_id: actor.id, created_at: new Date() };
      tx.create(requestRef, request);
      for (const line of latestLines) {
        const resource = resources.get(line.resource_id)!;
        const score = scores.get(resource.id)!;
        const bookingId = bookingIds.get(line.id)!;
        tx.create(db.collection("bookings").doc(bookingId), {
          resource_id: resource.id, resource_name: resource.name, department_id: resource.department_id,
          user_id: actor.id, user_name: actor.full_name, user_role: actor.role, org_name: actor.org_name,
          start_at: line.start_at, end_at: line.end_at, purpose_category: line.purpose_category, purpose_text: line.purpose_text,
          team_code: line.team_code, status: "PENDING_REVIEW", score: score.score, score_breakdown: score.breakdown,
          quantity: line.quantity, request_group_id: requestId, decided_by: null, decision_reason: null,
          offer_expires_at: null, requested_end_at: null, checked_out_at: null, returned_at: null, reminded_at: null,
          created_at: new Date(),
        });
        tx.create(db.collection("booking_items").doc(newRecordId()), { request_id: requestId, booking_id: bookingId, resource_id: resource.id, quantity: line.quantity, user_id: actor.id, created_at: new Date() });
        tx.delete(db.collection("cart_items").doc(line.id));
      }
    });
    for (const line of cart) {
      const resource = resources.get(line.resource_id)!;
      await notifyDepartment(null, resource.department_id, "New booking request", `${actor.full_name} (${actor.org_name}) requested ${line.quantity} unit(s) of ${resource.name}`, "/manage");
      await offerNext(null, resource.id);
    }
    redirect(`/bookings?request=${requestId}`);
  });
}
