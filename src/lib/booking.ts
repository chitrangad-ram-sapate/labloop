import type { Actor } from "./auth";
import { fromFirestore, getFirebaseDb } from "./firebase";
import { fmt, istDateKey, istMinutes } from "./format";
import { audit, notify } from "./log";
import { fairShare, HOLDING, MAX_ACTIVE_BOOKINGS, MAX_WEEKLY_HIGH_DEMAND_BOOKINGS, type Purpose } from "./rules";

export type Resource = {
  id: string; department_id: string; owner_id: string; name: string;
  category: "space" | "equipment" | "computing" | "media";
  description: string; location: string; photo: string | null; usage_rules: string; checklist: string[];
  open_from: string; open_to: string; max_duration_min: number; turnaround_min: number; advance_days: number;
  requires_supervision: boolean; supervise_externals: boolean; open_to_externals: boolean;
  deposit_note: string | null; high_demand: boolean; max_hours_week: number; cooldown_hours: number;
  external_max_pct: number; units_available: number; status: "ACTIVE" | "MAINTENANCE" | "RETIRED"; qr_token: string;
};

export type Reason = { code: string; message: string; fix?: { label: string; href: string } };
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const openHoursPerWeek = (r: Resource) => ((toMin(r.open_to) - toMin(r.open_from)) / 60) * 7;
export const isSupervised = (r: Resource, role: string) => r.requires_supervision || (role === "external" && r.supervise_externals);

const ACTIVE = ["PENDING_REVIEW", "APPROVED", "OFFERED", "IN_USE", "OVERDUE"];
const HISTORY = [...ACTIVE, "RETURNED", "CLOSED", "DISPUTED"];
const asDate = (value: unknown) => value instanceof Date ? value : new Date(value as string | number);
const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

function peakUsage(rows: Array<{ start: Date; end: Date; quantity: number }>, start: Date, end: Date) {
  const points = [start, ...rows.filter((row) => overlaps(row.start, row.end, start, end)).map((row) => row.start)
    .filter((time) => time > start && time < end)];
  return Math.max(0, ...points.map((time) => rows
    .filter((row) => row.start <= time && row.end > time)
    .reduce((sum, row) => sum + row.quantity, 0)));
}

async function capacityRows(resourceId: string) {
  const db = getFirebaseDb();
  const [bookings, carts, resource] = await Promise.all([
    db.collection("bookings").where("resource_id", "==", resourceId).get(),
    db.collection("cart_items").where("resource_id", "==", resourceId).get(),
    db.collection("resources").doc(resourceId).get(),
  ]);
  const turnaround = Number(resource.get("turnaround_min") ?? 0);
  const booked = bookings.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((row) => HOLDING.includes(row.status)).map((row) => ({
    start: asDate(row.start_at), end: new Date(asDate(row.end_at).getTime() + turnaround * 60_000), quantity: Number(row.quantity ?? 1),
  }));
  return { bookings: booked, carts };
}

export async function getResource(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const snap = await getFirebaseDb().collection("resources").doc(id).get();
  return snap.exists ? fromFirestore(snap.id, snap.data()!) as Resource : null;
}

export async function getResourceAvailability(resourceId: string, start: Date, end: Date, actorId: string | null) {
  const resource = await getResource(resourceId);
  if (!resource) return null;
  const finish = new Date(end.getTime() + resource.turnaround_min * 60_000);
  const { bookings, carts } = await capacityRows(resourceId);
  const booked = peakUsage(bookings, start, finish);
  const cartRows = carts.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((row) => asDate(row.hold_expires_at) > new Date());
  const heldByOthers = peakUsage(cartRows.filter((row) => row.user_id !== actorId).map((row) => ({
    start: asDate(row.start_at), end: new Date(asDate(row.end_at).getTime() + Number(row.turnaround_min ?? 0) * 60_000), quantity: Number(row.quantity),
  })), start, finish);
  const total = peakUsage([...bookings, ...cartRows.map((row) => ({
    start: asDate(row.start_at), end: new Date(asDate(row.end_at).getTime() + Number(row.turnaround_min ?? 0) * 60_000), quantity: Number(row.quantity),
  }))], start, finish);
  return { capacity: resource.units_available, allocated: total, heldByOthers, available: Math.max(0, resource.units_available - total), booked };
}

export async function missingCredentials(userId: string, resourceId: string) {
  const db = getFirebaseDb();
  const [requirements, userCredentials] = await Promise.all([
    db.collection("resource_requirements").where("resource_id", "==", resourceId).get(),
    db.collection("user_credentials").where("profile_id", "==", userId).get(),
  ]);
  const credentials = userCredentials.docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const result = await Promise.all(requirements.docs.map(async (requirement) => {
    const id = String(requirement.get("credential_type_id"));
    const type = await db.collection("credential_types").doc(id).get();
    const userRows = credentials.filter((row) => row.credential_type_id === id);
    const valid = userRows.some((row) => row.status === "VERIFIED" && (!row.expires_at || asDate(row.expires_at) > new Date()));
    if (!type.exists || valid) return null;
    return { id, name: String(type.get("name")), description: String(type.get("description") ?? ""), pending: userRows.some((row) => row.status === "PENDING") };
  }));
  return result.filter((row): row is NonNullable<typeof row> => row !== null);
}

function weekBounds(date: Date) {
  const key = istDateKey(date);
  const localNoon = new Date(`${key}T12:00:00+05:30`);
  localNoon.setUTCDate(localNoon.getUTCDate() - ((localNoon.getUTCDay() + 6) % 7));
  const start = new Date(`${localNoon.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

/** Every published booking rule is evaluated server-side; eligibility is never inferred from the UI. */
export async function precheck(actor: Actor, r: Resource, start: Date, end: Date, teamCode: string | null) {
  const blocks: Reason[] = [];
  const warnings: Reason[] = [];
  const now = new Date();
  const hours = (end.getTime() - start.getTime()) / 3_600_000;

  if (actor.suspended_until && asDate(actor.suspended_until) > now) blocks.push({ code: "SUSPENDED", message: `Your booking access is suspended until ${fmt(actor.suspended_until)} after an incident review. You can appeal from the booking page.`, fix: { label: "My bookings", href: "/bookings" } });
  if (actor.role === "external" && actor.identity_status !== "VERIFIED") blocks.push({ code: "IDENTITY_UNVERIFIED", message: "External users must have their college or incubator ID verified by a lab manager before booking.", fix: { label: "Upload ID", href: "/me" } });
  if (actor.role === "external" && !r.open_to_externals) blocks.push({ code: "NOT_OPEN_TO_EXTERNALS", message: "The owner has made this resource available to host-college students only." });
  if (r.status !== "ACTIVE") blocks.push({ code: "UNAVAILABLE", message: `This resource is currently ${r.status.toLowerCase()}.` });
  for (const c of await missingCredentials(actor.id, r.id)) blocks.push({ code: "NOT_ELIGIBLE", message: `You need the “${c.name}” credential.${c.pending ? " Your certificate is under review." : ""}`, fix: c.pending ? undefined : { label: "Upload certificate", href: "/me" } });

  if (!(end > start)) blocks.push({ code: "BAD_TIME", message: "End time must be after start time." });
  if (start < now) blocks.push({ code: "IN_PAST", message: "Start time is in the past." });
  if (start.getTime() > now.getTime() + r.advance_days * 86_400_000) blocks.push({ code: "TOO_FAR_AHEAD", message: `Bookings open at most ${r.advance_days} days ahead.` });
  if (hours * 60 > r.max_duration_min) blocks.push({ code: "TOO_LONG", message: `Maximum booking length is ${r.max_duration_min / 60} h.` });
  if (istDateKey(start) !== istDateKey(end) || istMinutes(start) < toMin(r.open_from) || istMinutes(end) > toMin(r.open_to)) blocks.push({ code: "OUTSIDE_HOURS", message: `Open ${r.open_from.slice(0, 5)}–${r.open_to.slice(0, 5)}, same-day bookings only.` });
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || !(end > start)) return { ok: false, blocks, warnings };

  const db = getFirebaseDb();
  const ownBookings = (await db.collection("bookings").where("user_id", "==", actor.id).get()).docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const active = ownBookings.filter((row) => ACTIVE.includes(String(row.status))).length;
  if (active >= MAX_ACTIVE_BOOKINGS) blocks.push({ code: "QUOTA_ACTIVE", message: `You already have ${active} active bookings (limit ${MAX_ACTIVE_BOOKINGS}). Finish or cancel one first.`, fix: { label: "My bookings", href: "/bookings" } });

  const resourceBookings = (await db.collection("bookings").where("resource_id", "==", r.id).get()).docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const relevant = resourceBookings.filter((row) => HISTORY.includes(String(row.status)));
  if (r.high_demand) {
    const { start: weekStart, end: weekEnd } = weekBounds(start);
    const weekly = relevant.filter((row) => asDate(row.start_at) >= weekStart && asDate(row.start_at) < weekEnd);
    const userRows = weekly.filter((row) => row.user_id === actor.id);
    const userHours = userRows.reduce((sum, row) => sum + (asDate(row.end_at).getTime() - asDate(row.start_at).getTime()) / 3_600_000, 0);
    const teamHours = weekly.filter((row) => teamCode && row.team_code === teamCode).reduce((sum, row) => sum + (asDate(row.end_at).getTime() - asDate(row.start_at).getTime()) / 3_600_000, 0);
    const externalIds = new Set((await db.collection("profiles").where("role", "==", "external").get()).docs.map((doc) => doc.id));
    const externalHours = weekly.filter((row) => externalIds.has(String(row.user_id))).reduce((sum, row) => sum + (asDate(row.end_at).getTime() - asDate(row.start_at).getTime()) / 3_600_000, 0);
    const open = openHoursPerWeek(r);
    if (userRows.length >= MAX_WEEKLY_HIGH_DEMAND_BOOKINGS) blocks.push({ code: "QUOTA_BOOKINGS", message: `High-demand resources are limited to ${MAX_WEEKLY_HIGH_DEMAND_BOOKINGS} bookings per person per week; you have already used that limit.` });
    if (userHours + hours > r.max_hours_week) blocks.push({ code: "QUOTA_HOURS", message: `Weekly limit is ${r.max_hours_week} h per person on this high-demand resource; you have ${userHours.toFixed(1)} h that week.` });
    if (teamCode && teamHours + hours > open * 0.3) blocks.push({ code: "GROUP_CAP", message: `Team “${teamCode}” would hold more than 30% of this week's hours (${(open * 0.3).toFixed(0)} h).` });
    if (actor.role === "external" && externalHours + hours > open * r.external_max_pct / 100) blocks.push({ code: "EXTERNAL_SHARE_FULL", message: `External users may hold at most ${r.external_max_pct}% of this week's hours (${(open * r.external_max_pct / 100).toFixed(0)} h), and that share is used up. Try another week.` });
    if (r.cooldown_hours > 0 && relevant.some((row) => row.user_id === actor.id && ["PENDING_REVIEW", "APPROVED", "OFFERED", "IN_USE", "OVERDUE", "RETURNED", "CLOSED"].includes(String(row.status)) && overlaps(asDate(row.start_at), asDate(row.end_at), new Date(start.getTime() - r.cooldown_hours * 3_600_000), new Date(end.getTime() + r.cooldown_hours * 3_600_000))))
      blocks.push({ code: "COOLDOWN", message: `Leave ${r.cooldown_hours} h between your bookings of this resource so others get a turn.` });
  }

  const slotEnd = new Date(end.getTime() + r.turnaround_min * 60_000);
  const contested = relevant.filter((row) => row.status === "PENDING_REVIEW" && row.user_id !== actor.id && overlaps(asDate(row.start_at), new Date(asDate(row.end_at).getTime() + r.turnaround_min * 60_000), start, slotEnd)).length;
  const { bookings, carts } = await capacityRows(r.id);
  const activeCarts = carts.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((row) => asDate(row.hold_expires_at) > now).map((row) => ({
    start: asDate(row.start_at), end: new Date(asDate(row.end_at).getTime() + Number(row.turnaround_min ?? 0) * 60_000), quantity: Number(row.quantity),
  }));
  const allocated = peakUsage([...bookings, ...activeCarts], start, slotEnd);
  const free = Math.max(0, r.units_available - allocated);
  if (allocated > 0) warnings.push({ code: "CAPACITY", message: free ? `${allocated} of ${r.units_available} units are allocated by confirmed bookings or active carts; ${free} unit(s) remain.` : `All ${r.units_available} unit(s) are allocated by confirmed bookings or active carts. You can still request the time, but the owner may waitlist you.` });
  if (contested) warnings.push({ code: "CONTESTED", message: `${contested} other request(s) overlap this time. The owner decides using the published Fair-Share Score shown on your request.` });
  return { ok: blocks.length === 0, blocks, warnings };
}

export async function scoreFor(userId: string, resourceId: string, purpose: Purpose) {
  const rows = (await getFirebaseDb().collection("bookings").where("user_id", "==", userId).get()).docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const now = Date.now();
  const resourceRows = rows.filter((row) => row.resource_id === resourceId && ["IN_USE", "OVERDUE", "RETURNED", "CLOSED", "DISPUTED"].includes(String(row.status)));
  const hours = resourceRows.filter((row) => asDate(row.start_at).getTime() > now - 30 * 86_400_000).reduce((sum, row) => sum + (asDate(row.end_at).getTime() - asDate(row.start_at).getTime()) / 3_600_000, 0);
  const noShows = rows.filter((row) => row.status === "NO_SHOW" && asDate(row.start_at).getTime() > now - 60 * 86_400_000).length;
  return fairShare({ purpose, hoursUsed30d: hours, firstUse: resourceRows.length === 0, noShows60d: noShows });
}

/** Offers freed capacity to the highest-scoring eligible waitlisted request. */
export async function offerNext(_tx: unknown, resourceId: string) {
  const db = getFirebaseDb();
  const minutes = process.env.DEMO_MODE === "true" ? 3 : 30;
  const candidates = (await db.collection("bookings").where("resource_id", "==", resourceId).where("status", "==", "WAITLISTED").get()).docs
    .map((doc) => fromFirestore(doc.id, doc.data())).filter((row) => asDate(row.start_at) > new Date())
    .sort((a, b) => Number(b.score ?? -Infinity) - Number(a.score ?? -Infinity) || asDate(a.created_at).getTime() - asDate(b.created_at).getTime()).slice(0, 10);
  const resourceRef = db.collection("resources").doc(resourceId);

  for (const candidate of candidates) {
    const bookingRef = db.collection("bookings").doc(candidate.id);
    const userBookingsQuery = db.collection("bookings").where("user_id", "==", candidate.user_id);
    const resourceBookingsQuery = db.collection("bookings").where("resource_id", "==", resourceId);
    const cartQuery = db.collection("cart_items").where("resource_id", "==", resourceId);
    const offered = await db.runTransaction(async (tx) => {
      const [resourceSnap, bookingSnap, userSnap, bookingSnapAll, cartSnap] = await Promise.all([
        tx.get(resourceRef), tx.get(bookingRef), tx.get(userBookingsQuery), tx.get(resourceBookingsQuery), tx.get(cartQuery),
      ]);
      if (!resourceSnap.exists || !bookingSnap.exists || bookingSnap.get("status") !== "WAITLISTED") return false;
      const userActive = userSnap.docs.filter((doc) => ACTIVE.includes(String(doc.get("status")))).length;
      if (userActive >= MAX_ACTIVE_BOOKINGS) return false;
      const start = asDate(bookingSnap.get("start_at"));
      const end = asDate(bookingSnap.get("end_at"));
      const resource = resourceSnap.data()!;
      const slotEnd = new Date(end.getTime() + Number(resource.turnaround_min ?? 0) * 60_000);
      const booked = bookingSnapAll.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((row) => row.id !== candidate.id && HOLDING.includes(row.status)).map((row) => ({ start: asDate(row.start_at), end: new Date(asDate(row.end_at).getTime() + Number(resource.turnaround_min ?? 0) * 60_000), quantity: Number(row.quantity ?? 1) }));
      const carts = cartSnap.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((row) => asDate(row.hold_expires_at) > new Date()).map((row) => ({ start: asDate(row.start_at), end: new Date(asDate(row.end_at).getTime() + Number(row.turnaround_min ?? 0) * 60_000), quantity: Number(row.quantity) }));
      if (peakUsage([...booked, ...carts], start, slotEnd) + Number(bookingSnap.get("quantity") ?? 1) > Number(resource.units_available)) return false;
      tx.update(resourceRef, { availability_version: Number(resource.availability_version ?? 0) + 1 });
      tx.update(bookingRef, { status: "OFFERED", offer_expires_at: new Date(Date.now() + minutes * 60_000) });
      return true;
    });
    if (!offered) continue;
    const reason = `A slot freed up. Offered to the highest-scoring waitlisted request; accept within ${minutes} min.`;
    await audit(null, null, "booking.offered", "booking", candidate.id, reason);
    await notify(null, String(candidate.user_id), "A waitlisted slot is now yours to claim", `Accept within ${minutes} minutes or it passes to the next person.`, `/bookings/${candidate.id}`);
    return candidate.id;
  }
  return null;
}
