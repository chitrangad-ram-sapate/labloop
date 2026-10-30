import Link from "next/link";
import { notFound } from "next/navigation";
import { requestBooking } from "@/app/actions/booking";
import { ActionForm } from "@/components/action-form";
import { Field, ReasonList, selectCls } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { canManage, requireActor } from "@/lib/auth";
import { getResource, isSupervised, openHoursPerWeek, type Reason } from "@/lib/booking";
import { sql } from "@/lib/db";
import { fmtDay, fmtTime, istDateKey } from "@/lib/format";
import { PURPOSES } from "@/lib/rules";

export default async function ResourcePage({ params }: PageProps<"/resources/[id]">) {
  const actor = await requireActor();
  const r = await getResource((await params).id);
  if (!r) notFound();

  const [dept] = await sql`select name from departments where id = ${r.department_id}`;
  const [owner] = await sql`select full_name from profiles where id = ${r.owner_id}`;
  const reqs = await sql<{ name: string; description: string; status: string | null; expires_at: Date | null }[]>`
    select ct.name, ct.description, uc.status, uc.expires_at
    from resource_requirements rr join credential_types ct on ct.id = rr.credential_type_id
    left join lateral (select status, expires_at from user_credentials where profile_id = ${actor.id} and credential_type_id = ct.id
                       order by (status = 'VERIFIED') desc, created_at desc limit 1) uc on true
    where rr.resource_id = ${r.id}`;
  const busy = await sql<{ start_at: Date; end_at: Date; status: string }[]>`
    select start_at, end_at, status from bookings where resource_id = ${r.id} and status in ('APPROVED','OFFERED','IN_USE','OVERDUE')
      and end_at > now() and start_at < now() + interval '7 days' order by start_at`;

  const blocks: Reason[] = [];
  if (actor.role === "external" && actor.identity_status !== "VERIFIED")
    blocks.push({ code: "IDENTITY", message: "Your ID has not been verified yet.", fix: { label: "Upload or check ID", href: "/me" } });
  if (actor.role === "external" && !r.open_to_externals) blocks.push({ code: "HOST_ONLY", message: "This resource is for host-college students only." });
  for (const q of reqs)
    if (q.status !== "VERIFIED" || (q.expires_at && new Date(q.expires_at) < new Date()))
      blocks.push({ code: "CRED", message: `Missing “${q.name}”${q.status === "PENDING" ? " (under review)" : ""}.`, fix: q.status === "PENDING" ? undefined : { label: "Upload certificate", href: "/me" } });

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
        </div>

        <div className="space-y-1 text-sm">
          <h2 className="font-semibold">Conditions of use</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Open {r.open_from.slice(0, 5)}–{r.open_to.slice(0, 5)} daily; up to {r.max_duration_min / 60} h per booking; book up to {r.advance_days} days ahead.</li>
            {supervised && <li>Supervised: a lab manager confirms check-out in person.</li>}
            {r.deposit_note && <li>Deposit: {r.deposit_note}.</li>}
            {r.high_demand && (
              <li>
                Fair-share rules: at most {r.max_hours_week} h per person per week{r.cooldown_hours ? `, ${r.cooldown_hours} h gap between your bookings` : ""},
                a team may hold at most 30% of weekly hours, and external users together at most {r.external_max_pct}% ({((openHoursPerWeek(r) * r.external_max_pct) / 100).toFixed(0)} h).
              </li>
            )}
            <li>Rules: {r.usage_rules || "none listed"}</li>
            <li>Condition checklist at check-out and return: {r.checklist.join(", ") || "none"}.</li>
          </ul>
        </div>

        <div className="space-y-2">
          <h2 className="font-semibold">Booked times, next 7 days</h2>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {days.map((d) => {
              const today = busy.filter((b) => istDateKey(new Date(b.start_at)) === d);
              return (
                <li key={d} className="rounded border px-2 py-1">
                  <span className="font-medium">{fmtDay(d + "T12:00:00+05:30")}:</span>{" "}
                  {today.length ? today.map((b) => `${fmtTime(b.start_at)}–${fmtTime(b.end_at)}`).join(", ") : "free all day"}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <aside className="space-y-3 rounded-lg border p-4 lg:sticky lg:top-4 lg:self-start">
        <h2 className="font-semibold">Request a slot</h2>
        <ReasonList items={blocks} tone="block" />
        {blocks.length === 0 && (
          <ActionForm action={requestBooking.bind(null, r.id)} submit="Submit request">
            <Field label="Date"><Input type="date" name="date" required min={days[0]} defaultValue={days[1]} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From"><Input type="time" name="from" required defaultValue="10:00" step={900} /></Field>
              <Field label="To"><Input type="time" name="to" required defaultValue="12:00" step={900} /></Field>
            </div>
            <Field label="Purpose" hint="Coursework counts most when requests compete">
              <select name="purpose" className={selectCls} required>
                {Object.entries(PURPOSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="What will you do?" hint="Seen only by the owner and lab staff">
              <Textarea name="purpose_text" required rows={2} />
            </Field>
            <Field label="Team / club code (optional)"><Input name="team_code" defaultValue={actor.team_code ?? ""} /></Field>
          </ActionForm>
        )}
        <p className="text-xs text-muted-foreground">
          Every request is checked against the published rules, then reviewed by the department. You&apos;ll always see why it was approved, waitlisted or declined.
        </p>
      </aside>
    </div>
  );
}
