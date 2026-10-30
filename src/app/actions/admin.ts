"use server";

import { redirect } from "next/navigation";
import { attempt, need, type ActionResult } from "@/lib/action";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import { audit, notify } from "@/lib/log";
import { seed } from "@/lib/seed";
import { tick } from "@/lib/tick";

export async function runScheduler() {
  return attempt(async () => {
    await requireActor("admin");
    const r = await tick();
    return `Scheduler ran: ${r.overdue} overdue, ${r.noShows} no-shows, ${r.expiredOffers} expired offers, ${r.reminded} reminders.`;
  });
}

export async function verifyChain() {
  return attempt(async () => {
    await requireActor("admin");
    const [v] = await sql`select * from audit_verify()`;
    if (!v.ok) throw new Error(`Chain broken at entry #${v.broken_id}: that record was altered after it was written.`);
    return `Audit chain intact: all ${v.checked} entries verified.`;
  });
}

export async function resetDemo() {
  await requireActor("admin");
  if (process.env.DEMO_MODE !== "true") throw new Error("Reset is only available in demo mode.");
  await seed(sql);
  redirect("/login");
}

export async function decideAppeal(incidentId: string, uphold: boolean, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("admin");
    const reason = need(fd, "reason", "a reason");
    await sql.begin(async (tx) => {
      const [i] = await tx`update incidents set appeal_status = ${uphold ? "UPHELD" : "OVERTURNED"}, penalty = case when ${uphold} then penalty else 'NONE' end
        where id = ${incidentId} and appeal_status = 'PENDING' returning booking_id, penalty`;
      if (!i) throw new Error("Already decided.");
      const [b] = await tx`select user_id from bookings where id = ${i.booking_id}`;
      if (!uphold) await tx`update profiles set suspended_until = null where id = ${b.user_id}`;
      await audit(tx, actor, uphold ? "incident.appeal_upheld" : "incident.appeal_overturned", "booking", i.booking_id, reason, { incident: incidentId });
      await notify(tx, b.user_id, uphold ? "Appeal reviewed: decision stands" : "Appeal accepted: penalty removed", reason, `/bookings/${i.booking_id}`);
    });
    return "Appeal decided.";
  });
}

export async function togglePartner(orgId: string) {
  const actor = await requireActor("admin");
  await sql.begin(async (tx) => {
    const [o] = await tx`update organizations set agreement_active = not agreement_active where id = ${orgId} and kind <> 'HOST' returning name, agreement_active`;
    await audit(tx, actor, o.agreement_active ? "partner.activated" : "partner.suspended", "organization", orgId, o.name);
  });
  redirect("/admin");
}
