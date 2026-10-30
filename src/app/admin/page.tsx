import Link from "next/link";
import { decideAppeal, resetDemo, runScheduler, togglePartner, verifyChain } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import { fmt } from "@/lib/format";

export default async function Admin() {
  await requireActor("admin");
  const demo = process.env.DEMO_MODE === "true";

  // Rule-based usage flags: each one is explainable and only prompts a human to look.
  const flags = [
    ...(await sql`select p.full_name as who, count(*)::int as n from bookings b join profiles p on p.id = b.user_id
        where b.status = 'CANCELLED' and b.created_at > now() - interval '14 days' group by p.full_name having count(*) >= 3`)
      .map((f) => `${f.who}: ${f.n} cancellations in 14 days`),
    ...(await sql`select p.full_name as who, count(*)::int as n from audit_log a join bookings b on b.id = a.entity_id join profiles p on p.id = b.user_id
        where a.action = 'booking.overdue' and a.at > now() - interval '30 days' group by p.full_name having count(*) >= 2`)
      .map((f) => `${f.who}: ${f.n} late returns in 30 days`),
    ...(await sql`select b.team_code, r.name, count(distinct b.user_id)::int as users, round(sum(extract(epoch from b.end_at - b.start_at) / 3600)::numeric, 1) as h
        from bookings b join resources r on r.id = b.resource_id
        where r.high_demand and b.team_code is not null and b.start_at > now() - interval '7 days' and b.start_at < now() + interval '7 days'
          and b.status not in ('REJECTED','CANCELLED') group by b.team_code, r.name having count(distinct b.user_id) >= 2`)
      .map((f) => `Team ${f.team_code}: ${f.users} members hold ${f.h} h of ${f.name} this fortnight (possible proxy booking)`),
  ];
  const appeals = await sql`select i.id, i.booking_id, i.appeal_text, i.resolution, i.penalty, r.name from incidents i join resources r on r.id = i.resource_id where i.appeal_status = 'PENDING'`;
  const partners = await sql`select id, name, kind, email_domain, agreement_active from organizations where kind <> 'HOST' order by name`;
  const [stats] = await sql`select
      (select count(*)::int from resources where status = 'ACTIVE') as resources,
      (select count(*)::int from bookings where status in ('CLOSED','RETURNED')) as completed,
      (select coalesce(round(sum(extract(epoch from end_at - start_at) / 3600)), 0)::int from bookings where status in ('CLOSED','RETURNED','IN_USE','OVERDUE')) as hours,
      (select count(distinct user_id)::int from bookings where status in ('CLOSED','RETURNED','IN_USE','OVERDUE','APPROVED')) as people,
      (select count(*)::int from bookings b join profiles p on p.id = b.user_id where p.role = 'external' and b.status in ('CLOSED','RETURNED','IN_USE','APPROVED')) as external`;
  const log = await sql`select a.id, a.at, a.action, a.entity_type, a.entity_id, a.reason, a.actor_role, a.hash, p.full_name from audit_log a
    left join profiles p on p.id = a.actor_id order by a.id desc limit 60`;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Admin</h1>

      <section className="grid gap-3 sm:grid-cols-5">
        {[["Active resources", stats.resources], ["Completed loans", stats.completed], ["Hours of idle kit used", stats.hours], ["People served", stats.people], ["Loans to external users", stats.external]].map(([k, v]) => (
          <div key={k} className="rounded-lg border p-3"><p className="text-2xl font-bold tabular-nums">{v}</p><p className="text-xs text-muted-foreground">{k}</p></div>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Scheduler</h2>
          <p className="text-xs text-muted-foreground">Runs every few minutes automatically. Flags overdue returns and no-shows, and expires offers.</p>
          <ActionForm action={runScheduler} submit="Run scheduler now" />
        </div>
        <div className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Audit integrity</h2>
          <p className="text-xs text-muted-foreground">Recomputes the hash chain to prove no history entry was edited or deleted.</p>
          <ActionForm action={verifyChain} submit="Verify integrity" />
        </div>
        {demo && (
          <div className="space-y-2 rounded-lg border p-4">
            <h2 className="font-semibold">Demo data</h2>
            <p className="text-xs text-muted-foreground">Restores the fictional demo world. Signs everyone out.</p>
            <form action={resetDemo}><Button variant="destructive">Reset demo data</Button></form>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Usage flags ({flags.length})</h2>
        <p className="text-xs text-muted-foreground">Rule-based signals for a person to review. They never block or penalise anyone by themselves.</p>
        <ul className="list-disc pl-5 text-sm">{flags.length ? flags.map((f) => <li key={f}>{f}</li>) : <li>No flags.</li>}</ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Appeals ({appeals.length})</h2>
        {appeals.map((a) => (
          <div key={a.id} className="space-y-2 rounded-lg border p-3 text-sm">
            <p><Link href={`/bookings/${a.booking_id}`} className="underline">{a.name}</Link> · outcome {a.penalty.replace("_", " ").toLowerCase()} · “{a.resolution}”</p>
            <p><strong>Appeal:</strong> {a.appeal_text}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <ActionForm action={decideAppeal.bind(null, a.id, false)} submit="Overturn" className="space-y-2"><Input name="reason" required aria-label="Reason" placeholder="Why it is overturned" /></ActionForm>
              <ActionForm action={decideAppeal.bind(null, a.id, true)} submit="Uphold" variant="outline" className="space-y-2"><Input name="reason" required aria-label="Reason" placeholder="Why it stands" /></ActionForm>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Partner organisations</h2>
        <ul className="divide-y rounded-lg border text-sm">
          {partners.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span>{o.name} · @{o.email_domain} · {o.agreement_active ? "agreement active" : "suspended"}</span>
              <form action={togglePartner.bind(null, o.id)}><Button size="sm" variant="outline">{o.agreement_active ? "Suspend" : "Re-activate"}</Button></form>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Activity history (latest 60)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b text-left"><th className="py-1">#</th><th>When</th><th>Who</th><th>Action</th><th>Reason</th><th>Hash</th></tr></thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id} className="border-b align-top">
                  <td className="py-1">{l.id}</td><td className="whitespace-nowrap">{fmt(l.at)}</td>
                  <td>{l.full_name ?? "system"} {l.actor_role && `(${l.actor_role})`}</td>
                  <td>{l.entity_type === "booking" ? <Link href={`/bookings/${l.entity_id}`} className="underline">{l.action}</Link> : l.action}</td>
                  <td>{l.reason}</td><td className="font-mono">{l.hash.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
