"use server";

import { redirect } from "next/navigation";
import { attempt, need, str, type ActionResult } from "@/lib/action";
import { requireActor, type Actor } from "@/lib/auth";
import { getResource, offerNext, openHoursPerWeek, precheck, scoreFor, type Resource } from "@/lib/booking";
import { sql, type Tx } from "@/lib/db";
import { istToDate } from "@/lib/format";
import { audit, notifyDepartment } from "@/lib/log";
import { MAX_ACTIVE_BOOKINGS, MAX_WEEKLY_HIGH_DEMAND_BOOKINGS, PURPOSES, type Purpose } from "@/lib/rules";

const HOLD_MINUTES = 12;
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

type CartFairLine = { resource_id: string; start_at: Date; end_at: Date; team_code: string | null };
type CartHoldLine = CartFairLine & {
  id: string; quantity: number; turnaround_min: number; slot: unknown; purpose_category: string; purpose_text: string;
  hold_expires_at: Date;
};
type CartDisplayLine = CartHoldLine & { name: string; department_id: string; resource_status: string };

async function validateWeeklyLimits(db: Tx, actor: Actor, cart: CartFairLine[], resources: Map<string, Resource>) {
  const weekly = new Map<string, CartFairLine[]>();
  for (const line of cart) {
    const resource = resources.get(line.resource_id)!;
    if (!resource.high_demand) continue;
    const week = istWeekStart(new Date(line.start_at));
    const key = `${resource.id}:${week}`;
    weekly.set(key, [...(weekly.get(key) ?? []), line]);
  }
  for (const lines of weekly.values()) {
    const resource = resources.get(lines[0].resource_id)!;
    const week = istWeekStart(new Date(lines[0].start_at));
    const weekStart = new Date(`${week}T00:00:00+05:30`);
    const [existing] = await db`
      select
        count(*) filter (where b.user_id = ${actor.id})::int as user_bookings,
        coalesce(sum(extract(epoch from b.end_at - b.start_at) / 3600) filter (where b.user_id = ${actor.id}), 0) as user_hours,
        coalesce(sum(extract(epoch from b.end_at - b.start_at) / 3600) filter (where p.role = 'external'), 0) as external_hours
      from bookings b join profiles p on p.id = b.user_id
      where b.resource_id = ${resource.id} and b.start_at >= ${weekStart}::timestamptz
        and b.start_at < ${weekStart}::timestamptz + interval '7 days'
        and b.status in ('PENDING_REVIEW','APPROVED','OFFERED','IN_USE','OVERDUE','RETURNED','CLOSED','DISPUTED')`;
    if (Number(existing.user_bookings) + lines.length > MAX_WEEKLY_HIGH_DEMAND_BOOKINGS)
      throw new Error(`${resource.name}: this combined request exceeds the limit of ${MAX_WEEKLY_HIGH_DEMAND_BOOKINGS} bookings per person per week.`);
    const proposedHours = lines.reduce((sum, line) => sum + (new Date(line.end_at).getTime() - new Date(line.start_at).getTime()) / 3_600_000, 0);
    if (Number(existing.user_hours) + proposedHours > resource.max_hours_week)
      throw new Error(`${resource.name}: this combined request exceeds the weekly ${resource.max_hours_week}-hour limit.`);
    if (actor.role === "external" && Number(existing.external_hours) + proposedHours > (openHoursPerWeek(resource) * resource.external_max_pct) / 100)
      throw new Error(`${resource.name}: this combined request exceeds the external-user weekly share.`);

    const teams = new Map<string, number>();
    for (const line of lines) if (line.team_code) {
      const hours = (new Date(line.end_at).getTime() - new Date(line.start_at).getTime()) / 3_600_000;
      teams.set(line.team_code, (teams.get(line.team_code) ?? 0) + hours);
    }
    for (const [teamCode, hours] of teams) {
      const [team] = await db`
        select coalesce(sum(extract(epoch from end_at - start_at) / 3600), 0) as hours from bookings
        where resource_id = ${resource.id} and team_code = ${teamCode} and start_at >= ${weekStart}::timestamptz
          and start_at < ${weekStart}::timestamptz + interval '7 days'
          and status in ('PENDING_REVIEW','APPROVED','OFFERED','IN_USE','OVERDUE','RETURNED','CLOSED','DISPUTED')`;
      if (Number(team.hours) + hours > openHoursPerWeek(resource) * 0.3)
        throw new Error(`${resource.name}: team ${teamCode} would exceed the 30% weekly allocation cap.`);
    }
  }
}

function bookingWindow(fd: FormData) {
  const date = need(fd, "date", "a date");
  const from = need(fd, "from", "a start time");
  const to = need(fd, "to", "an end time");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to))
    throw new Error("Choose a valid date and time.");
  const validTime = (value: string) => Number(value.slice(0, 2)) < 24 && Number(value.slice(3, 5)) < 60;
  if (!validTime(from) || !validTime(to)) throw new Error("Choose a valid 24-hour time.");
  const start = istToDate(date, from);
  const end = istToDate(date, to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
    throw new Error("End time must be after start time.");
  if (start.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) !== date)
    throw new Error("Choose a valid calendar date.");
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

    await sql.begin(async (tx) => {
      const [current] = await tx`select id, units_available, turnaround_min from resources where id = ${resource.id} for update`;
      if (!current || current.id !== resource.id) throw new Error("Resource is no longer available.");
      const [existing] = await tx`
        select id, quantity from cart_items
        where user_id = ${actor.id} and resource_id = ${resource.id} and start_at = ${start} and end_at = ${end}
          and purpose_category = ${purpose} and hold_expires_at > now()
        for update`;
      const [usage] = await tx`
        select labloop_resource_peak(${resource.id}::uuid,
          tstzrange(${start}::timestamptz, ${end}::timestamptz + make_interval(mins => ${current.turnaround_min}), '[)'),
          null::uuid, ${existing?.id ?? null}::uuid, false, false, null::uuid) as allocated`;
      if (Number(usage.allocated) + quantity > Number(current.units_available)) {
        const free = Math.max(0, Number(current.units_available) - Number(usage.allocated));
        throw new Error(`Only ${free} unit(s) are available for that time; other bookings or active cart holds use the rest.`);
      }

      const [line] = existing
        ? await tx`update cart_items set quantity = ${quantity}, start_at = ${start}, end_at = ${end},
            turnaround_min = ${current.turnaround_min}, slot = tstzrange(${start}::timestamptz, ${end}::timestamptz + make_interval(mins => ${current.turnaround_min}), '[)'), purpose_text = ${purposeText}, team_code = ${team},
            hold_expires_at = now() + make_interval(mins => ${HOLD_MINUTES})
            where id = ${existing.id} returning id`
        : await tx`insert into cart_items
            (user_id, resource_id, quantity, start_at, end_at, turnaround_min, slot, purpose_category, purpose_text, team_code, hold_expires_at)
            values (${actor.id}, ${resource.id}, ${quantity}, ${start}, ${end}, ${current.turnaround_min},
              tstzrange(${start}::timestamptz, ${end}::timestamptz + make_interval(mins => ${current.turnaround_min}), '[)'),
              ${purpose}, ${purposeText}, ${team}, now() + make_interval(mins => ${HOLD_MINUTES})) returning id`;
      await audit(tx, actor, "cart.hold_created", "resource", resource.id, `Held ${quantity} unit(s) for ${HOLD_MINUTES} minutes.`, { cart_item: line.id, start, end });
    });
    return `Added to your cart. This hold expires in ${HOLD_MINUTES} minutes.`;
  });
}

export async function changeCartQuantity(id: string, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const delta = Number(str(fd, "delta"));
    if (delta !== -1 && delta !== 1) throw new Error("Invalid quantity change.");
    const [row] = await sql`select resource_id from cart_items where id = ${id} and user_id = ${actor.id}`;
    if (!row) throw new Error("Cart hold not found or already expired.");
    await sql.begin(async (tx) => {
      const [resource] = await tx`select units_available from resources where id = ${row.resource_id} for update`;
      const [line] = await tx`select * from cart_items where id = ${id} and user_id = ${actor.id} for update`;
      if (!resource || !line || new Date(line.hold_expires_at) <= new Date()) throw new Error("This cart hold expired. Remove it and add the resource again.");
      const quantity = Number(line.quantity) + delta;
      if (quantity < 1 || quantity > Number(resource.units_available)) throw new Error("Quantity must stay between 1 and the resource's available unit count.");
      const [usage] = await tx`select labloop_resource_peak(${line.resource_id}::uuid,
        tstzrange(${line.start_at}::timestamptz, ${line.end_at}::timestamptz + make_interval(mins => ${line.turnaround_min}), '[)'),
        null::uuid, ${line.id}::uuid, false, false, null::uuid) as allocated`;
      if (Number(usage.allocated) + quantity > Number(resource.units_available))
        throw new Error(`Only ${Math.max(0, Number(resource.units_available) - Number(usage.allocated))} unit(s) remain for that time.`);
      await tx`update cart_items set quantity = ${quantity}, hold_expires_at = now() + make_interval(mins => ${HOLD_MINUTES}) where id = ${line.id}`;
      await audit(tx, actor, "cart.quantity_changed", "resource", line.resource_id, `Cart quantity set to ${quantity}.`, { cart_item: line.id });
      if (delta < 0) await offerNext(tx, line.resource_id);
    });
    return "Cart quantity updated; the 12-minute hold has been renewed.";
  });
}

export async function removeCartItem(id: string, _: ActionResult, _fd: FormData) {
  void _;
  void _fd;
  return attempt(async () => {
    const actor = await requireActor();
    const [line] = await sql`select resource_id from cart_items where id = ${id} and user_id = ${actor.id}`;
    if (!line) throw new Error("Cart item not found.");
    await sql.begin(async (tx) => {
      await tx`select id from resources where id = ${line.resource_id} for update`;
      const [removed] = await tx`delete from cart_items where id = ${id} and user_id = ${actor.id} returning resource_id`;
      if (removed) {
        await audit(tx, actor, "cart.hold_released", "resource", removed.resource_id, "Removed from cart.", { cart_item: id });
        await offerNext(tx, removed.resource_id);
      }
    });
    return "Resource removed from your cart and its hold released.";
  });
}

export async function submitCart(_: ActionResult, _fd: FormData) {
  void _;
  void _fd;
  return attempt(async () => {
    const actor = await requireActor();
    const cart = await sql<CartDisplayLine[]>`
      select c.*, r.name, r.department_id, r.status as resource_status
      from cart_items c join resources r on r.id = c.resource_id
      where c.user_id = ${actor.id} order by c.resource_id, c.start_at`;
    if (!cart.length) throw new Error("Your cart is empty.");
    if (cart.some((line) => new Date(line.hold_expires_at) <= new Date()))
      throw new Error("At least one cart hold expired. Remove expired items and add them again before submitting.");
    const resources = new Map<string, NonNullable<Awaited<ReturnType<typeof getResource>>>>();
    for (const line of cart) {
      const resource = await getResource(line.resource_id);
      if (!resource || resource.status !== "ACTIVE") throw new Error(`${line.name} is no longer available.`);
      resources.set(line.resource_id, resource);
      const check = await precheck(actor, resource, new Date(line.start_at), new Date(line.end_at), line.team_code ?? null);
      if (!check.ok) throw new Error(`${line.name}: ${check.blocks.map((x) => x.message).join(" ")}`);
    }

    await validateWeeklyLimits(sql, actor, cart, resources);
    for (const resource of resources.values()) {
      if (!resource.cooldown_hours) continue;
      const chronological = cart.filter((line) => line.resource_id === resource.id)
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
      for (let i = 1; i < chronological.length; i++) {
        if (new Date(chronological[i].start_at).getTime() < new Date(chronological[i - 1].end_at).getTime() + resource.cooldown_hours * 3_600_000)
          throw new Error(`${resource.name}: cart items must leave a ${resource.cooldown_hours}-hour cooldown.`);
      }
    }

    const requestId = await sql.begin(async (tx) => {
      const resourceIds = [...resources.keys()].sort();
      await tx`select id from resources where id = any(${tx.array(resourceIds, 2950)}) order by id for update`;
      await tx`select id from profiles where id = ${actor.id} for update`;
      const latest = await tx<CartHoldLine[]>`select * from cart_items where user_id = ${actor.id} order by resource_id, start_at for update`;
      if (latest.length !== cart.length || latest.some((line) => new Date(line.hold_expires_at) <= new Date()))
        throw new Error("Your cart changed or a hold expired. Refresh the cart and try again.");
      await validateWeeklyLimits(tx, actor, latest, resources);

      const [{ active }] = await tx`
        select count(*)::int as active from bookings
        where user_id = ${actor.id} and status in ('PENDING_REVIEW','APPROVED','OFFERED','IN_USE','OVERDUE')`;
      if (Number(active) + latest.length > MAX_ACTIVE_BOOKINGS)
        throw new Error(`This combined request would exceed your limit of ${MAX_ACTIVE_BOOKINGS} active bookings.`);

      const [request] = await tx`insert into booking_requests (user_id) values (${actor.id}) returning id`;
      // Drop the user's holds only after all validation and locks are in place.
      // If any insert fails, the transaction restores them with the request.
      await tx`delete from cart_items where id = any(${tx.array(latest.map((x) => x.id), 2950)}) and user_id = ${actor.id}`;

      for (const line of latest) {
        const resource = resources.get(line.resource_id)!;
        const score = await scoreFor(actor.id, resource.id, line.purpose_category as Purpose);
        const [booking] = await tx`
          insert into bookings (resource_id, user_id, start_at, end_at, slot, purpose_category, purpose_text,
            team_code, status, score, score_breakdown, quantity, request_group_id)
          values (${resource.id}, ${actor.id}, ${line.start_at}, ${line.end_at},
            tstzrange(${line.start_at}::timestamptz, ${line.end_at}::timestamptz + make_interval(mins => ${line.turnaround_min}), '[)'), ${line.purpose_category},
            ${line.purpose_text}, ${line.team_code}, 'PENDING_REVIEW', ${score.score}, ${tx.json(score.breakdown as never)},
            ${line.quantity}, ${request.id}) returning id`;
        await tx`insert into booking_items (request_id, booking_id, resource_id, quantity, user_id)
          values (${request.id}, ${booking.id}, ${resource.id}, ${line.quantity}, ${actor.id})`;
        await audit(tx, actor, "booking.requested", "booking", booking.id,
          `${line.quantity} unit(s) of ${resource.name}: ${PURPOSES[line.purpose_category as Purpose].label} — ${line.purpose_text}`,
          { request_id: request.id, quantity: line.quantity, start: line.start_at, end: line.end_at });
        await notifyDepartment(tx, resource.department_id, "New booking request",
          `${actor.full_name} (${actor.org_name}) requested ${line.quantity} unit(s) of ${resource.name}`, "/manage");
      }
      await audit(tx, actor, "booking.request_group_submitted", "booking_request", request.id,
        `Submitted ${latest.length} booking item(s) from cart.`, { items: latest.length });
      return request.id as string;
    });
    redirect(`/bookings?request=${requestId}`);
  });
}
