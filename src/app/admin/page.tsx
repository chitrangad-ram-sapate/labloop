import Link from "next/link";
import { decideAppeal, runScheduler, togglePartner, verifyChain } from "@/app/actions/admin";
import { reviewOwnerAccess } from "@/app/actions/owner-access";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireActor } from "@/lib/auth";
import { fromFirestore, getFirebaseDb } from "@/lib/firebase";
import { fmt } from "@/lib/format";

export default async function Admin() {
  await requireActor("admin");

  const db = getFirebaseDb();
  const [bookingSnap, profileSnap, resourceSnap, orgSnap, incidentSnap, requestSnap, departmentSnap, auditSnap] = await Promise.all([
    db.collection("bookings").get(), db.collection("profiles").get(), db.collection("resources").get(),
    db.collection("organizations").get(), db.collection("incidents").get(), db.collection("owner_access_requests").get(),
    db.collection("departments").get(), db.collection("audit_log").get(),
  ]);
  const bookings = bookingSnap.docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const profiles = profileSnap.docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const resources = resourceSnap.docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const orgs = orgSnap.docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const incidents = incidentSnap.docs.map((doc) => fromFirestore(doc.id, doc.data()));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
  const now = Date.now();
  const cancelled = new Map<string, number>();
  for (const booking of bookings.filter((row) => row.status === "CANCELLED" && now - new Date(row.created_at).getTime() <= 14 * 86_400_000)) cancelled.set(String(booking.user_id), (cancelled.get(String(booking.user_id)) ?? 0) + 1);
  const lateReturns = new Map<string, number>();
  for (const incident of incidents.filter((row) => row.type === "DELAY" && now - new Date(row.created_at).getTime() <= 30 * 86_400_000)) lateReturns.set(String(incident.user_id), (lateReturns.get(String(incident.user_id)) ?? 0) + 1);
  const flags = [
    ...[...cancelled].filter(([, count]) => count >= 3).map(([id, count]) => `${profileById.get(id)?.full_name ?? "A member"}: ${count} cancellations in 14 days`),
    ...[...lateReturns].filter(([, count]) => count >= 2).map(([id, count]) => `${profileById.get(id)?.full_name ?? "A member"}: ${count} late returns in 30 days`),
    ...(() => {
      const teams = new Map<string, { users: Set<string>; hours: number; name: string }>();
      for (const booking of bookings.filter((row) => row.team_code && !["REJECTED", "CANCELLED"].includes(String(row.status)) && new Date(row.start_at).getTime() > now - 7 * 86_400_000 && new Date(row.start_at).getTime() < now + 7 * 86_400_000)) {
        const resource = resourceById.get(String(booking.resource_id));
        if (!resource?.high_demand) continue;
        const key = `${booking.team_code}:${resource.id}`;
        const record = teams.get(key) ?? { users: new Set<string>(), hours: 0, name: String(resource.name) };
        record.users.add(String(booking.user_id));
        record.hours += (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 3_600_000;
        teams.set(key, record);
      }
      return [...teams.entries()].filter(([, value]) => value.users.size >= 2).map(([key, value]) => `Team ${key.split(":")[0]}: ${value.users.size} members hold ${value.hours.toFixed(1)} h of ${value.name} this fortnight (possible proxy booking)`);
    })(),
  ];
  const appeals = incidents.filter((incident) => incident.appeal_status === "PENDING").map((incident) => ({ ...incident, name: resourceById.get(String(incident.resource_id))?.name ?? "Resource" }));
  const partners = orgs.filter((org) => org.kind !== "HOST").sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const departments = new Map(departmentSnap.docs.map((doc) => [doc.id, fromFirestore(doc.id, doc.data())]));
  const ownerRequests = requestSnap.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((request) => request.status === "PENDING").flatMap((request) => {
    const profile = profileById.get(String(request.profile_id));
    if (!profile) return [];
    return [{ ...request, full_name: profile.full_name, email: profile.email, department: departments.get(String(request.department_id))?.name ?? "Department" }];
  }).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const completedStatuses = ["CLOSED", "RETURNED"];
  const servedStatuses = ["CLOSED", "RETURNED", "IN_USE", "OVERDUE", "APPROVED"];
  const hoursStatuses = ["CLOSED", "RETURNED", "IN_USE", "OVERDUE"];
  const stats = {
    resources: resources.filter((resource) => resource.status === "ACTIVE").length,
    completed: bookings.filter((booking) => completedStatuses.includes(String(booking.status))).length,
    hours: Math.round(bookings.filter((booking) => hoursStatuses.includes(String(booking.status))).reduce((sum, booking) => sum + (new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 3_600_000, 0)),
    people: new Set(bookings.filter((booking) => servedStatuses.includes(String(booking.status))).map((booking) => booking.user_id)).size,
    external: bookings.filter((booking) => profileById.get(String(booking.user_id))?.role === "external" && ["CLOSED", "RETURNED", "IN_USE", "APPROVED"].includes(String(booking.status))).length,
  };
  const log = await Promise.all(auditSnap.docs.map(async (doc) => {
    const entry = fromFirestore(doc.id, doc.data());
    const profile = entry.actor_id ? profileById.get(String(entry.actor_id)) : null;
    return { ...entry, full_name: profile?.full_name ?? null };
  }));
  log.sort((a, b) => Number(b.sequence ?? 0) - Number(a.sequence ?? 0));
  log.splice(60);

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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Owner access requests ({ownerRequests.length})</h2>
        {ownerRequests.length === 0 ? <p className="text-sm text-muted-foreground">No owner access requests are waiting for review.</p> : ownerRequests.map((request) => (
          <article key={request.id} className="space-y-3 rounded-lg border p-4 text-sm">
            <div>
              <h3 className="font-semibold">{request.full_name} · {request.department}</h3>
              <p className="text-muted-foreground">{request.email} · requested {fmt(request.created_at)}</p>
            </div>
            <p className="whitespace-pre-wrap leading-6">{request.reason}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <ActionForm action={reviewOwnerAccess.bind(null, request.id, true)} submit="Approve owner access" className="space-y-2">
                <Input name="reason" required aria-label="Approval note" placeholder="Approval note" />
              </ActionForm>
              <ActionForm action={reviewOwnerAccess.bind(null, request.id, false)} submit="Decline request" variant="outline" className="space-y-2">
                <Input name="reason" required aria-label="Decision note" placeholder="Why it is declined" />
              </ActionForm>
            </div>
          </article>
        ))}
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
