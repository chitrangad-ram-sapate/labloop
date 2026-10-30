import type postgres from "postgres";
import type { Actor } from "./auth";
import { sql } from "./db";
import { fmt, istDateKey, istMinutes } from "./format";
import { audit, notify } from "./log";
import { fairShare, MAX_ACTIVE_BOOKINGS, type Purpose } from "./rules";

export type Resource = {
  id: string; department_id: string; owner_id: string; name: string;
  category: "space" | "equipment" | "computing" | "media";
  description: string; location: string; photo: string | null; usage_rules: string; checklist: string[];
  open_from: string; open_to: string; max_duration_min: number; turnaround_min: number; advance_days: number;
  requires_supervision: boolean; supervise_externals: boolean; open_to_externals: boolean;
  deposit_note: string | null; high_demand: boolean; max_hours_week: number; cooldown_hours: number;
  external_max_pct: number; status: "ACTIVE" | "MAINTENANCE" | "RETIRED"; qr_token: string;
};

export type Reason = { code: string; message: string; fix?: { label: string; href: string } };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const openHoursPerWeek = (r: Resource) => ((toMin(r.open_to) - toMin(r.open_from)) / 60) * 7;
export const isSupervised = (r: Resource, role: string) => r.requires_supervision || (role === "external" && r.supervise_externals);

export async function getResource(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [r] = await sql<Resource[]>`select * from resources where id = ${id}`;
  return r ?? null;
}

export async function missingCredentials(userId: string, resourceId: string) {
  return sql<{ id: string; name: string; description: string; pending: boolean }[]>`
    select ct.id, ct.name, ct.description,
      exists (select 1 from user_credentials uc where uc.profile_id = ${userId}
              and uc.credential_type_id = ct.id and uc.status = 'PENDING') as pending
    from resource_requirements rr join credential_types ct on ct.id = rr.credential_type_id
    where rr.resource_id = ${resourceId}
      and not exists (select 1 from user_credentials uc where uc.profile_id = ${userId}
                      and uc.credential_type_id = ct.id and uc.status = 'VERIFIED'
                      and (uc.expires_at is null or uc.expires_at > now()))`;
}

/** Every published rule a request must pass. Blocks stop submission; warnings are shown but allowed. */
export async function precheck(actor: Actor, r: Resource, start: Date, end: Date, teamCode: string | null) {
  const blocks: Reason[] = [];
  const warnings: Reason[] = [];
  const now = new Date();
  const hours = (end.getTime() - start.getTime()) / 3_600_000;

  if (actor.suspended_until && new Date(actor.suspended_until) > now)
    blocks.push({ code: "SUSPENDED", message: `Your booking access is suspended until ${fmt(actor.suspended_until)} after an incident review. You can appeal from the booking page.`, fix: { label: "My bookings", href: "/bookings" } });
  if (actor.role === "external" && actor.identity_status !== "VERIFIED")
    blocks.push({ code: "IDENTITY_UNVERIFIED", message: "External users must have their college or incubator ID verified by a lab manager before booking.", fix: { label: "Upload ID", href: "/me" } });
  if (actor.role === "external" && !r.open_to_externals)
    blocks.push({ code: "NOT_OPEN_TO_EXTERNALS", message: "The owner has made this resource available to host-college students only." });
  if (r.status !== "ACTIVE")
    blocks.push({ code: "UNAVAILABLE", message: `This resource is currently ${r.status.toLowerCase()}.` });
  for (const c of await missingCredentials(actor.id, r.id))
    blocks.push({ code: "NOT_ELIGIBLE", message: `You need the “${c.name}” credential.${c.pending ? " Your certificate is under review." : ""}`, fix: c.pending ? undefined : { label: "Upload certificate", href: "/me" } });

  if (!(end > start)) blocks.push({ code: "BAD_TIME", message: "End time must be after start time." });
  if (start < now) blocks.push({ code: "IN_PAST", message: "Start time is in the past." });
  if (start.getTime() > now.getTime() + r.advance_days * 86_400_000)
    blocks.push({ code: "TOO_FAR_AHEAD", message: `Bookings open at most ${r.advance_days} days ahead.` });
  if (hours * 60 > r.max_duration_min)
    blocks.push({ code: "TOO_LONG", message: `Maximum booking length is ${r.max_duration_min / 60} h.` });
  if (istDateKey(start) !== istDateKey(end) || istMinutes(start) < toMin(r.open_from) || istMinutes(end) > toMin(r.open_to))
    blocks.push({ code: "OUTSIDE_HOURS", message: `Open ${r.open_from.slice(0, 5)}–${r.open_to.slice(0, 5)}, same-day bookings only.` });

  const [{ active }] = await sql<{ active: number }[]>`
    select count(*)::int as active from bookings
    where user_id = ${actor.id} and status in ('PENDING_REVIEW','APPROVED','OFFERED','IN_USE','OVERDUE')`;
  if (active >= MAX_ACTIVE_BOOKINGS)
    blocks.push({ code: "QUOTA_ACTIVE", message: `You already have ${active} active bookings (limit ${MAX_ACTIVE_BOOKINGS}). Finish or cancel one first.`, fix: { label: "My bookings", href: "/bookings" } });

  if (r.high_demand) {
    const [w] = await sql<{ user_h: string; team_h: string; ext_h: string }[]>`
      with wk as (select date_trunc('week', ${start}::timestamptz at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as s)
      select
        coalesce(sum(extract(epoch from b.end_at - b.start_at) / 3600) filter (where b.user_id = ${actor.id}), 0) as user_h,
        coalesce(sum(extract(epoch from b.end_at - b.start_at) / 3600) filter (where b.team_code = ${teamCode}), 0) as team_h,
        coalesce(sum(extract(epoch from b.end_at - b.start_at) / 3600) filter (where p.role = 'external'), 0) as ext_h
      from bookings b join profiles p on p.id = b.user_id cross join wk
      where b.resource_id = ${r.id} and b.start_at >= wk.s and b.start_at < wk.s + interval '7 days'
        and b.status in ('PENDING_REVIEW','APPROVED','OFFERED','IN_USE','OVERDUE','RETURNED','CLOSED','DISPUTED')`;
    const open = openHoursPerWeek(r);
    if (Number(w.user_h) + hours > r.max_hours_week)
      blocks.push({ code: "QUOTA_HOURS", message: `Weekly limit is ${r.max_hours_week} h per person on this high-demand resource; you have ${Number(w.user_h).toFixed(1)} h that week.` });
    if (teamCode && Number(w.team_h) + hours > open * 0.3)
      blocks.push({ code: "GROUP_CAP", message: `Team “${teamCode}” would hold more than 30% of this week's hours (${(open * 0.3).toFixed(0)} h).` });
    if (actor.role === "external" && Number(w.ext_h) + hours > (open * r.external_max_pct) / 100)
      blocks.push({ code: "EXTERNAL_SHARE_FULL", message: `External users may hold at most ${r.external_max_pct}% of this week's hours (${((open * r.external_max_pct) / 100).toFixed(0)} h), and that share is used up. Try another week.` });
    if (r.cooldown_hours > 0) {
      const [cd] = await sql`
        select 1 from bookings where user_id = ${actor.id} and resource_id = ${r.id}
          and status in ('PENDING_REVIEW','APPROVED','OFFERED','IN_USE','OVERDUE','RETURNED','CLOSED')
          and end_at > ${start}::timestamptz - make_interval(hours => ${r.cooldown_hours})
          and start_at < ${end}::timestamptz + make_interval(hours => ${r.cooldown_hours}) limit 1`;
      if (cd) blocks.push({ code: "COOLDOWN", message: `Leave ${r.cooldown_hours} h between your bookings of this resource so others get a turn.` });
    }
  }

  const [ov] = await sql<{ taken: number; contested: number }[]>`
    select count(*) filter (where status in ('APPROVED','OFFERED','IN_USE','OVERDUE'))::int as taken,
           count(*) filter (where status = 'PENDING_REVIEW')::int as contested
    from bookings where resource_id = ${r.id} and user_id <> ${actor.id}
      and slot && tstzrange(${start}::timestamptz, ${end}::timestamptz + make_interval(mins => ${r.turnaround_min}))`;
  if (ov.taken) warnings.push({ code: "SLOT_TAKEN", message: "This time is already booked. You can still request it: the owner may waitlist you, and you will be offered the slot automatically if it frees up." });
  if (ov.contested) warnings.push({ code: "CONTESTED", message: `${ov.contested} other request(s) overlap this time. The owner decides using the published Fair-Share Score shown on your request.` });

  return { ok: blocks.length === 0, blocks, warnings };
}

export async function scoreFor(userId: string, resourceId: string, purpose: Purpose) {
  const [s] = await sql<{ h: string; uses: number; ns: number }[]>`
    select
      coalesce(sum(extract(epoch from end_at - start_at) / 3600) filter (where resource_id = ${resourceId}
        and status in ('IN_USE','OVERDUE','RETURNED','CLOSED','DISPUTED') and start_at > now() - interval '30 days'), 0) as h,
      count(*) filter (where resource_id = ${resourceId} and status in ('IN_USE','OVERDUE','RETURNED','CLOSED','DISPUTED'))::int as uses,
      count(*) filter (where status = 'NO_SHOW' and start_at > now() - interval '60 days')::int as ns
    from bookings where user_id = ${userId}`;
  return fairShare({ purpose, hoursUsed30d: Number(s.h), firstUse: s.uses === 0, noShows60d: s.ns });
}

/** When a slot frees, offer it to the best-scoring waitlisted request that now fits. */
export async function offerNext(tx: postgres.TransactionSql, resourceId: string) {
  const minutes = process.env.DEMO_MODE === "true" ? 3 : 30;
  const candidates = await tx<{ id: string; user_id: string }[]>`
    select id, user_id from bookings where resource_id = ${resourceId} and status = 'WAITLISTED' and start_at > now()
    order by score desc nulls last, created_at limit 10`;
  for (const c of candidates) {
    try {
      await tx.savepoint((sp) => sp`update bookings set status = 'OFFERED', offer_expires_at = now() + make_interval(mins => ${minutes}) where id = ${c.id}`);
    } catch (e) {
      if ((e as { code?: string }).code === "23P01") continue; // still overlaps another booking
      throw e;
    }
    await audit(tx, null, "booking.offered", "booking", c.id, `A slot freed up. Offered to the highest-scoring waitlisted request; accept within ${minutes} min.`);
    await notify(tx, c.user_id, "A waitlisted slot is now yours to claim", `Accept within ${minutes} minutes or it passes to the next person.`, `/bookings/${c.id}`);
    return c.id;
  }
  return null;
}
