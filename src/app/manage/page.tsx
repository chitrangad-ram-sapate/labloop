import Link from "next/link";
import { decideCredential, decideIdentity } from "@/app/actions/verify";
import { ActionForm } from "@/components/action-form";
import { AiNote, Status } from "@/components/bits";
import { Input } from "@/components/ui/input";
import type { AiMeta, DocCheck } from "@/lib/ai";
import { aiEnabled } from "@/lib/ai";
import { requireActor } from "@/lib/auth";
import { fromFirestore, getFirebaseDb } from "@/lib/firebase";
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

  const db = getFirebaseDb();
  const [bookingSnap, resourceSnap, profileSnap, orgSnap, incidentSnap, credentialSnap, typeSnap] = await Promise.all([
    db.collection("bookings").get(), db.collection("resources").get(), db.collection("profiles").get(),
    db.collection("organizations").get(), db.collection("incidents").get(), db.collection("user_credentials").get(),
    db.collection("credential_types").get(),
  ]);
  const bookings = bookingSnap.docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const resources = resourceSnap.docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const profiles = profileSnap.docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const organizations = orgSnap.docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
  const orgById = new Map(organizations.map((org) => [org.id, org]));
  const now = Date.now();
  const bookingView = bookings.flatMap((booking) => {
    const resource = resourceById.get(String(booking.resource_id));
    const profile = profileById.get(String(booking.user_id));
    if (!resource || !profile || (!all && resource.department_id !== dept)) return [];
    const org = orgById.get(String(profile.org_id));
    if (!(["PENDING_REVIEW", "RETURNED", "OVERDUE", "DISPUTED"].includes(String(booking.status)) || booking.requested_end_at || (booking.status === "APPROVED" && new Date(booking.start_at).getTime() < now + 86_400_000))) return [];
    const conflicts = bookings.filter((other) => other.id !== booking.id && other.resource_id === booking.resource_id && ["PENDING_REVIEW", "APPROVED", "OFFERED", "IN_USE", "OVERDUE"].includes(String(other.status)) && new Date(other.start_at) < new Date(booking.end_at) && new Date(other.end_at) > new Date(booking.start_at)).length;
    return [{ ...booking, name: resource.name, full_name: profile.full_name, role: profile.role, org: org?.name ?? "Unknown organisation", conflicts }];
  }).sort((a, b) => ({ OVERDUE: 0, RETURNED: 1, PENDING_REVIEW: 2 }[String(a.status) as "OVERDUE" | "RETURNED" | "PENDING_REVIEW"] ?? 3) - ({ OVERDUE: 0, RETURNED: 1, PENDING_REVIEW: 2 }[String(b.status) as "OVERDUE" | "RETURNED" | "PENDING_REVIEW"] ?? 3) || new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  const incidents = incidentSnap.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((incident) => incident.status === "OPEN" && (all || resourceById.get(String(incident.resource_id))?.department_id === dept)).map((incident) => ({ ...incident, name: resourceById.get(String(incident.resource_id))?.name ?? "Resource" })).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const idQueue = profiles.filter((profile) => profile.identity_status === "PENDING" && profile.id_doc).map((profile) => ({ ...profile, org: orgById.get(String(profile.org_id))?.name ?? "Unknown organisation", agreement_active: orgById.get(String(profile.org_id))?.agreement_active ?? false })).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const credentialTypes = new Map(typeSnap.docs.map((doc) => [doc.id, fromFirestore(doc.id, doc.data())]));
  const credQueue = credentialSnap.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((credential) => credential.status === "PENDING").flatMap((credential) => {
    const profile = profileById.get(String(credential.profile_id));
    if (!profile) return [];
    return [{ ...credential, name: credentialTypes.get(String(credential.credential_type_id))?.name ?? "Training certificate", full_name: profile.full_name, email: profile.email }];
  }).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const mine = resources.filter((resource) => all || resource.department_id === dept).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const queue = bookingView;

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
