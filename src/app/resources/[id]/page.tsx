import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ResourceCartForm } from "@/components/resource-cart-form";
import { AiNote, ReasonList } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { canManage, getActor } from "@/lib/auth";
import { aiEnabled, explainEligibility } from "@/lib/ai";
import { getResource, isSupervised, openHoursPerWeek, type Reason } from "@/lib/booking";
import { sql } from "@/lib/db";
import { fmtDay, fmtTime, istDateKey } from "@/lib/format";
import { MAX_WEEKLY_HIGH_DEMAND_BOOKINGS } from "@/lib/rules";

export default function ResourcePage({ params }: PageProps<"/resources/[id]">) {
  return (
    <Suspense fallback={<div className="resource-loading" role="status">Loading resource details…</div>}>
      <ResourceContent params={params} />
    </Suspense>
  );
}

async function ResourceContent({ params }: { params: PageProps<"/resources/[id]">["params"] }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?redirectTo=${encodeURIComponent(`/resources/${id}`)}`);
  const r = await getResource(id);
  if (!r) notFound();

  const [dept] = await sql`select name from departments where id = ${r.department_id}`;
  const [owner] = await sql`select full_name from profiles where id = ${r.owner_id}`;
  const reqs = await sql<{ name: string; description: string; status: string | null; expires_at: Date | null }[]>`
    select ct.name, ct.description, uc.status, uc.expires_at
    from resource_requirements rr join credential_types ct on ct.id = rr.credential_type_id
    left join lateral (select status, expires_at from user_credentials where profile_id = ${actor.id} and credential_type_id = ct.id
                       order by (status = 'VERIFIED') desc, created_at desc limit 1) uc on true
    where rr.resource_id = ${r.id}`;
  const busy = await sql<{ start_at: Date; end_at: Date; status: string; quantity: number }[]>`
    select start_at, end_at, status, quantity from bookings where resource_id = ${r.id} and status in ('APPROVED','OFFERED','IN_USE','OVERDUE')
      and end_at > now() and start_at < now() + interval '7 days' order by start_at`;

  const blocks: Reason[] = [];
  if (actor.role === "external" && actor.identity_status !== "VERIFIED")
    blocks.push({ code: "IDENTITY", message: "Your ID has not been verified yet.", fix: { label: "Upload or check ID", href: "/me" } });
  if (actor.role === "external" && !r.open_to_externals) blocks.push({ code: "HOST_ONLY", message: "This resource is for host-college students only." });
  for (const q of reqs)
    if (q.status !== "VERIFIED" || (q.expires_at && new Date(q.expires_at) < new Date()))
      blocks.push({ code: "CRED", message: `Missing “${q.name}”${q.status === "PENDING" ? " (under review)" : ""}.`, fix: q.status === "PENDING" ? undefined : { label: "Upload certificate", href: "/me" } });
  const eligibilityAid = blocks.length && aiEnabled() ? await explainEligibility(blocks.map(({ code, message }) => ({ code, message }))) : null;

  const days = Array.from({ length: 7 }, (_, i) => istDateKey(new Date(Date.now() + i * 86_400_000)));
  const supervised = isSupervised(r, actor.role);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section className="space-y-5">
        <div>
          <p className="text-sm text-muted-foreground">{dept.name} · listed by {owner.full_name}</p>
          <h1 className="text-2xl font-bold">{r.name}</h1>
          <p className="text-sm">{r.location}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge variant="outline">{r.category}</Badge>
            <Badge variant="secondary">{r.units_available} unit{r.units_available === 1 ? "" : "s"}</Badge>
            {r.status !== "ACTIVE" && <Badge variant="destructive">{r.status.toLowerCase()}</Badge>}
            {r.high_demand && <Badge variant="secondary">High demand</Badge>}
          </div>
          {canManage(actor, r.department_id) && (
            <p className="mt-2 text-sm">
              <Link className="underline" href={`/resources/${r.id}/edit`}>Edit listing</Link> ·{" "}
              <Link className="underline" href={`/r/${r.qr_token}/poster`}>Print QR poster</Link>
            </p>
          )}
        </div>
        {r.photo && <img src={r.photo} alt={r.name} className="max-h-72 rounded-lg border object-cover" />}
        <p>{r.description}</p>

        <div className="space-y-2">
          <h2 className="font-semibold">Eligibility for you</h2>
          {reqs.length === 0 && actor.role !== "external" && <p className="text-sm">No training required.</p>}
          <ul className="space-y-1 text-sm">
            {actor.role === "external" && (
              <li>{actor.identity_status === "VERIFIED" ? "✓" : "✗"} Identity verified by a host lab manager</li>
            )}
            {reqs.map((q) => (
              <li key={q.name}>
                {q.status === "VERIFIED" ? "✓" : "✗"} {q.name} <span className="text-muted-foreground">— {q.description}</span>
              </li>
            ))}
          </ul>
          {eligibilityAid && <AiNote title="AI eligibility guidance (advisory)">{eligibilityAid.guidance}</AiNote>}
        </div>

        <div className="space-y-1 text-sm">
          <h2 className="font-semibold">Conditions of use</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Open {r.open_from.slice(0, 5)}–{r.open_to.slice(0, 5)} daily; up to {r.max_duration_min / 60} h per booking; book up to {r.advance_days} days ahead.</li>
            {supervised && <li>Supervised: a lab manager confirms check-out in person.</li>}
            {r.deposit_note && <li>Deposit: {r.deposit_note}.</li>}
            {r.high_demand && (
              <li>
                Fair-share rules: at most {MAX_WEEKLY_HIGH_DEMAND_BOOKINGS} bookings and {r.max_hours_week} h per person per week{r.cooldown_hours ? `, ${r.cooldown_hours} h gap between your bookings` : ""},
                a team may hold at most 30% of weekly hours, and external users together at most {r.external_max_pct}% ({((openHoursPerWeek(r) * r.external_max_pct) / 100).toFixed(0)} h).
              </li>
            )}
            <li>Rules: {r.usage_rules || "none listed"}</li>
            <li>Condition checklist at check-out and return: {r.checklist.join(", ") || "none"}.</li>
          </ul>
        </div>

        <div className="space-y-2">
          <h2 className="font-semibold">Confirmed booking activity, next 7 days</h2>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {days.map((d) => {
              const today = busy.filter((b) => istDateKey(new Date(b.start_at)) === d);
              return (
                <li key={d} className="rounded border px-2 py-1">
                  <span className="font-medium">{fmtDay(d + "T12:00:00+05:30")}:</span>{" "}
                  {today.length ? today.map((b) => `${fmtTime(b.start_at)}–${fmtTime(b.end_at)} (${b.quantity} unit${b.quantity === 1 ? "" : "s"})`).join(", ") : "no confirmed bookings"}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <aside className="space-y-3 rounded-lg border p-4 lg:sticky lg:top-4 lg:self-start">
        <h2 className="font-semibold">Add to your booking cart</h2>
        <ReasonList items={blocks} tone="block" />
        {blocks.length === 0 && (
          <ResourceCartForm resourceId={r.id} date={days[1]} units={r.units_available} teamCode={actor.team_code} />
        )}
        <p className="text-xs text-muted-foreground">
          Every request is checked against the published rules, then reviewed by the department. You&apos;ll always see why it was approved, waitlisted or declined.
        </p>
      </aside>
    </div>
  );
}
