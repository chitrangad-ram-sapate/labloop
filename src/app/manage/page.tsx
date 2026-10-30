import Link from "next/link";
import { decideCredential, decideIdentity } from "@/app/actions/verify";
import { ActionForm } from "@/components/action-form";
import { AiNote, Status } from "@/components/bits";
import { Input } from "@/components/ui/input";
import type { AiMeta, DocCheck } from "@/lib/ai";
import { aiEnabled } from "@/lib/ai";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import { fmt, fmtTime } from "@/lib/format";

function DocCheckNote({ check }: { check: (DocCheck & AiMeta) | null }) {
  if (!check) return aiEnabled() ? <p className="text-xs text-muted-foreground">✦ AI document check pending or unavailable for this file. Review it manually.</p> : null;
  return (
    <AiNote title="Document check" model={check._model}>
      <ul className="text-xs">
        <li>{check.readable ? "✓ Readable" : "✗ Hard to read"}</li>
        <li>{check.name_matches ? "✓" : "✗"} Name on document: {check.name_on_document || "not found"}</li>
        <li>{check.matches_expected ? "✓" : "✗"} Issuer / title: {check.issuer_or_title || "not found"}</li>
        {check.date_on_document && <li>Date: {check.date_on_document}</li>}
        {check.issues.map((i) => <li key={i}>! {i}</li>)}
      </ul>
      <p className="text-xs">{check.summary}</p>
    </AiNote>
  );
}

export default async function Manage() {
  const actor = await requireActor("owner", "manager", "admin");
  const all = actor.role === "admin";
  const dept = actor.department_id;

  const queue = await sql`
    select b.id, b.status, b.start_at, b.end_at, b.score, b.purpose_category, b.requested_end_at, r.name, p.full_name, p.role, o.name as org,
      (select count(*)::int from bookings b2 where b2.resource_id = b.resource_id and b2.id <> b.id and b2.slot && b.slot
         and b2.status in ('PENDING_REVIEW','APPROVED','OFFERED','IN_USE','OVERDUE')) as conflicts
    from bookings b join resources r on r.id = b.resource_id join profiles p on p.id = b.user_id join organizations o on o.id = p.org_id
    where (${all} or r.department_id = ${dept})
      and (b.status in ('PENDING_REVIEW','RETURNED','OVERDUE','DISPUTED') or b.requested_end_at is not null
           or (b.status = 'APPROVED' and b.start_at < now() + interval '1 day'))
    order by case b.status when 'OVERDUE' then 0 when 'RETURNED' then 1 when 'PENDING_REVIEW' then 2 else 3 end, b.start_at`;
  const incidents = await sql`select i.id, i.type, i.severity, i.description, i.ai_summary, i.booking_id, i.appeal_status, r.name from incidents i join resources r on r.id = i.resource_id
    where i.status = 'OPEN' and (${all} or r.department_id = ${dept}) order by i.created_at`;
  const idQueue = await sql`select p.id, p.full_name, p.email, p.id_doc, p.id_ai_check, o.name as org, o.agreement_active from profiles p join organizations o on o.id = p.org_id
    where p.identity_status = 'PENDING' and p.id_doc is not null order by p.created_at`;
  const credQueue = await sql`select uc.id, uc.evidence, uc.ai_check, uc.created_at, ct.name, p.full_name, p.email from user_credentials uc
    join credential_types ct on ct.id = uc.credential_type_id join profiles p on p.id = uc.profile_id where uc.status = 'PENDING' order by uc.created_at`;
  const mine = await sql`select id, name, status, high_demand from resources where ${all} or department_id = ${dept} order by name`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Manage</h1>
        {(actor.role === "owner" || all) && <Link href="/resources/new" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">+ List a resource</Link>}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Needs your attention ({queue.length})</h2>
        {queue.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
        <ul className="divide-y rounded-lg border">
          {queue.map((b) => (
            <li key={b.id}>
              <Link href={`/bookings/${b.id}`} className="flex flex-wrap items-center gap-3 p-3 hover:bg-muted">
                <Status s={b.status} />
                <span className="font-medium">{b.name}</span>
                <span className="text-sm">{b.full_name} ({b.org}{b.role === "external" ? ", external" : ""})</span>
                <span className="text-sm text-muted-foreground">{fmt(b.start_at)}–{fmtTime(b.end_at)}</span>
                {b.status === "PENDING_REVIEW" && <span className="text-sm">score {Number(b.score)}</span>}
                {b.conflicts > 0 && b.status === "PENDING_REVIEW" && <span className="rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">{b.conflicts} overlapping</span>}
                {b.requested_end_at && <span className="rounded bg-sky-100 px-1.5 text-xs font-semibold text-sky-900">extension requested</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">External users to verify ({idQueue.length})</h2>
        {idQueue.map((p) => (
          <div key={p.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[200px_1fr]">
            <img src={p.id_doc} alt={`ID document of ${p.full_name}`} className="w-full rounded border" />
            <div className="space-y-2 text-sm">
              <p><strong>{p.full_name}</strong> · {p.email} · {p.org}</p>
              <ul className="text-muted-foreground">
                <li>{p.agreement_active ? "✓" : "✗"} Partner agreement active</li>
                <li>✓ Email domain matches the partner organisation</li>
                <li>Check that the name and photo on the ID match this person.</li>
              </ul>
              <DocCheckNote check={p.id_ai_check} />
              <div className="grid gap-2 sm:grid-cols-2">
                <ActionForm action={decideIdentity.bind(null, p.id, true)} submit="Verify identity" className="space-y-2">
                  <Input name="reason" required aria-label="Reason" defaultValue="ID matches name and partner college" />
                </ActionForm>
                <ActionForm action={decideIdentity.bind(null, p.id, false)} submit="Reject" variant="outline" className="space-y-2">
                  <Input name="reason" required aria-label="Reason" placeholder="e.g. ID is unreadable, please re-upload" />
                </ActionForm>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Certificates to verify ({credQueue.length})</h2>
        {credQueue.map((c) => (
          <div key={c.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[200px_1fr]">
            {c.evidence ? <img src={c.evidence} alt={`Certificate from ${c.full_name}`} className="w-full rounded border" /> : <p>No file</p>}
            <div className="space-y-2 text-sm">
              <p><strong>{c.name}</strong> for {c.full_name} ({c.email}) · uploaded {fmt(c.created_at)}</p>
              <DocCheckNote check={c.ai_check} />
              <div className="grid gap-2 sm:grid-cols-2">
                <ActionForm action={decideCredential.bind(null, c.id, true)} submit="Verify" className="space-y-2">
                  <Input name="reason" required aria-label="Reason" defaultValue="Certificate checked against induction register" />
                </ActionForm>
                <ActionForm action={decideCredential.bind(null, c.id, false)} submit="Reject" variant="outline" className="space-y-2">
                  <Input name="reason" required aria-label="Reason" placeholder="e.g. Name doesn't match; book an induction" />
                </ActionForm>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Open incidents ({incidents.length})</h2>
        <ul className="divide-y rounded-lg border text-sm">
          {incidents.map((i) => (
            <li key={i.id} className="p-3">
              <Link href={i.booking_id ? `/bookings/${i.booking_id}` : "#"} className="underline">{i.name}</Link>: <strong>{i.type}</strong> ({i.severity.toLowerCase()}) {i.description}
              {i.ai_summary && <div className="mt-1"><AiNote title="Incident summary">{i.ai_summary}</AiNote></div>}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Listings</h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {mine.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded border p-2">
              <Link href={`/resources/${r.id}`} className="underline">{r.name}</Link>
              <span className="text-muted-foreground">{r.status.toLowerCase()}{r.high_demand ? " · high demand" : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
