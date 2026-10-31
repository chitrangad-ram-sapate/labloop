import Link from "next/link";
import { notFound } from "next/navigation";
import {
  answerOffer, appeal, cancelBooking, checkOut, decide, decideExtension, inspect, reportIncident, requestExtension, resolveIncident, returnItem,
} from "@/app/actions/booking";
import { addComplaintMessage, escalateComplaint, openComplaint, updateComplaintStatus } from "@/app/actions/complaint";
import { ActionForm } from "@/components/action-form";
import { AiNote, Field, selectCls, Status } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PhotoInput } from "@/components/photo-input";
import type { AiMeta, ConditionDiff } from "@/lib/ai";
import { canManage, requireActor } from "@/lib/auth";
import { getResource, isSupervised } from "@/lib/booking";
import { sql } from "@/lib/db";
import { fmt, fmtTime } from "@/lib/format";
import { PURPOSES, type ScoreLine } from "@/lib/rules";
import { getTrustSummary } from "@/lib/trust";
import { COMPLAINT_ISSUES, COMPLAINT_TRANSITIONS, complaintStatusLabel, type ComplaintStatus } from "@/lib/complaints";
import { aiEnabled, explainConflicts } from "@/lib/ai";

type Report = { phase: "CHECKOUT" | "RETURN"; checklist: Record<string, string>; photo: string | null; notes: string; created_at: Date; by: string; ai_diff: (ConditionDiff & AiMeta) | null };

function Checklist({ items }: { items: string[] }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">Condition checklist</legend>
      {items.map((item) => (
        <div key={item} className="flex flex-wrap items-center gap-3 text-sm">
          <span className="min-w-48">{item}</span>
          <label><input type="radio" name={`item:${item}`} value="ok" defaultChecked /> OK</label>
          <label><input type="radio" name={`item:${item}`} value="issue" /> Issue</label>
        </div>
      ))}
    </fieldset>
  );
}

function Score({ lines, total }: { lines: ScoreLine[]; total: number }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {lines.map((l) => (
          <tr key={l.label} className="border-b last:border-0">
            <td className="py-0.5 pr-2 font-medium">{l.label}</td>
            <td className="pr-2 text-right tabular-nums">{l.points > 0 ? `+${l.points}` : l.points}</td>
            <td className="text-muted-foreground">{l.explanation}</td>
          </tr>
        ))}
        <tr><td className="pt-1 font-semibold">Total</td><td className="pt-1 text-right font-semibold tabular-nums">{total}</td><td /></tr>
      </tbody>
    </table>
  );
}

export default async function BookingPage({ params }: PageProps<"/bookings/[id]">) {
  const actor = await requireActor();
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [b] = await sql`
    select b.*, p.full_name, p.role as user_role, p.email, o.name as org_name, d.full_name as decided_by_name
    from bookings b join profiles p on p.id = b.user_id join organizations o on o.id = p.org_id
    left join profiles d on d.id = b.decided_by where b.id = ${id}`;
  if (!b) notFound();
  const r = (await getResource(b.resource_id))!;
  const staff = canManage(actor, r.department_id);
  const mine = b.user_id === actor.id;
  if (!staff && !mine) notFound();
  const trust = staff ? await getTrustSummary(b.user_id) : null;

  const reports = await sql<Report[]>`select c.phase, c.checklist, c.photo, c.notes, c.created_at, c.ai_diff, p.full_name as by
    from condition_reports c join profiles p on p.id = c.recorded_by where booking_id = ${id}`;
  const out = reports.find((x) => x.phase === "CHECKOUT");
  const back = reports.find((x) => x.phase === "RETURN");
  const incidents = await sql`select i.*, p.full_name as reporter from incidents i join profiles p on p.id = i.reported_by where booking_id = ${id} order by created_at`;
  const complaints = await sql`select id, issue_type, status, ai_summary, created_at from complaint_tickets where booking_id = ${id} order by created_at desc`;
  const complaintMessages = complaints.length ? await sql`
    select m.id, m.ticket_id, m.author_id, m.body, m.status, m.evidence, m.created_at, p.full_name as author_name
    from complaint_messages m left join profiles p on p.id = m.author_id
    where m.ticket_id = any(${sql.array(complaints.map((x) => x.id as string), 2950)}) order by m.created_at` : [];
  const timeline = await sql`select a.*, p.full_name from audit_log a left join profiles p on p.id = a.actor_id
    where entity_type = 'booking' and entity_id = ${id} order by id`;
  const rivals = staff && ["PENDING_REVIEW", "WAITLISTED"].includes(b.status)
    ? await sql`select b2.id, b2.status, b2.score, b2.start_at, b2.end_at, b2.quantity, p.full_name from bookings b2 join profiles p on p.id = b2.user_id
        where b2.resource_id = ${b.resource_id} and b2.id <> ${id} and b2.slot && ${b.slot}
          and b2.status in ('PENDING_REVIEW','WAITLISTED','APPROVED','OFFERED','IN_USE','OVERDUE') order by b2.score desc nulls last`
    : [];
  const conflictAdvice = rivals.length && aiEnabled() ? await explainConflicts(rivals.map((x) => ({
    status: String(x.status), start: new Date(x.start_at).toISOString(), end: new Date(x.end_at).toISOString(),
    quantity: Number(x.quantity ?? 1), score: x.score == null ? null : Number(x.score),
  }))) : null;
  const blockedByApproved = rivals.some((x) => ["APPROVED", "OFFERED", "IN_USE", "OVERDUE"].includes(x.status));
  const supervised = isSupervised(r, b.user_role);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground"><Link href={`/resources/${r.id}`} className="underline">{r.name}</Link> · {r.location}</p>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
            {fmt(b.start_at)} – {fmtTime(b.end_at)} <Status s={b.status} />
          </h1>
          <p className="text-sm">Quantity: {b.quantity ?? 1} unit{Number(b.quantity ?? 1) === 1 ? "" : "s"}</p>
          <p className="text-sm">
            {b.full_name} ({b.org_name}{b.user_role === "external" ? ", external" : ""}) ·{" "}
            {PURPOSES[b.purpose_category as keyof typeof PURPOSES].label}: {b.purpose_text}
            {b.team_code && ` · team ${b.team_code}`}
          </p>
          {b.decision_reason && (
            <p className="rounded-md bg-muted p-2 text-sm"><span className="font-semibold">Why:</span> {b.decision_reason}{b.decided_by_name && ` (${b.decided_by_name})`}</p>
          )}
          {b.status === "OVERDUE" && <p role="alert" className="font-semibold text-destructive">Overdue: this was due back at {fmt(b.end_at)}.</p>}
        </div>

        {/* Owner review */}
        {staff && ["PENDING_REVIEW", "WAITLISTED"].includes(b.status) && (
          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">Review this request</h2>
            {trust && <div className="rounded-lg border p-3 text-sm" aria-label="Privacy-preserving customer trust summary">
              <p><strong>Trust:</strong> {"★".repeat(trust.stars)}{"☆".repeat(5 - trust.stars)} · {trust.trustId}</p>
              <p className="text-xs text-muted-foreground">Verification {trust.verificationStatus.replaceAll("_", " ").toLowerCase()} · {trust.verifiedTrainings} current training(s) · {trust.completedBookings} completed booking(s) · {Math.round(trust.onTimeRate * 100)}% on time · {Math.round(trust.conditionRate * 100)}% clean condition reports · {trust.incidents} incident(s)</p>
              <p className="text-xs text-muted-foreground">Trust metrics inform review; they do not decide the request. Sensitive identity documents are not shown here.</p>
            </div>}
            {rivals.length > 0 && (
              <div className="text-sm">
                {conflictAdvice && <AiNote title="AI schedule conflict explanation (advisory)">{conflictAdvice.explanation}</AiNote>}
                <p className="font-medium">Overlapping bookings and requests (ranked by Fair-Share Score):</p>
                <ul className="list-disc pl-5">
                  <li><strong>This request: {b.full_name}, score {Number(b.score)}</strong></li>
                  {rivals.map((x) => (
                    <li key={x.id}><Link href={`/bookings/${x.id}`} className="underline">{x.full_name}</Link>: {x.status.replace("_", " ").toLowerCase()}, score {x.score ?? "—"}, {fmtTime(x.start_at)}–{fmtTime(x.end_at)}</li>
                  ))}
                </ul>
                <p className="mt-1 text-muted-foreground">
                  {rivals.some((x) => x.status === "PENDING_REVIEW" && Number(x.score) > Number(b.score))
                    ? "Recommendation: another request has a higher score. Approving this one is allowed, but explain why."
                    : "Recommendation: this request has the highest score for this time."}
                  {" "}Approving checks live unit capacity; pending requests are waitlisted with an explanation only when they cannot fit the remaining stock.
                </p>
              </div>
            )}
            <ActionForm action={decide.bind(null, id, "APPROVED")} submit={blockedByApproved ? "Approve (slot already taken)" : "Approve"} className="space-y-2">
              <Field label="Reason shown to the requester"><Input name="reason" required defaultValue="Eligible, and highest priority for this slot." /></Field>
            </ActionForm>
            <div className="grid gap-3 sm:grid-cols-2">
              {b.status === "PENDING_REVIEW" && (
                <ActionForm action={decide.bind(null, id, "WAITLISTED")} submit="Waitlist" variant="outline" className="space-y-2">
                  <Input name="reason" required aria-label="Waitlist reason" defaultValue="Slot is contested; you'll be offered it if it frees." />
                </ActionForm>
              )}
              <ActionForm action={decide.bind(null, id, "REJECTED")} submit="Reject" variant="destructive" className="space-y-2">
                <Input name="reason" required aria-label="Rejection reason" placeholder="Explain the rejection" />
              </ActionForm>
            </div>
          </section>
        )}

        {/* Waitlist offer */}
        {mine && b.status === "OFFERED" && (
          <section className="space-y-2 rounded-lg border border-amber-400 p-4">
            <h2 className="font-semibold">This slot is yours if you want it</h2>
            <p className="text-sm">Accept before {fmt(b.offer_expires_at)}, or it passes to the next person on the waitlist.</p>
            <div className="flex gap-2">
              <form action={answerOffer.bind(null, id, true)}><Button>Accept</Button></form>
              <form action={answerOffer.bind(null, id, false)}><Button variant="outline">Decline</Button></form>
            </div>
          </section>
        )}

        {/* Check-out */}
        {b.status === "APPROVED" && (mine || staff) && (
          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">Check out: record the starting condition</h2>
            {supervised && !staff ? (
              <p className="text-sm">This resource is supervised. Go to {r.location}; the lab manager confirms the check-out with you in person.</p>
            ) : (
              <ActionForm action={checkOut.bind(null, id)} submit="Confirm check-out">
                <Checklist items={r.checklist} />
                <PhotoInput label="Photo of the item now" required />
                <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
                {r.deposit_note && staff && (
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="deposit" /> Deposit collected ({r.deposit_note})</label>
                )}
                {process.env.DEMO_MODE === "true" && <p className="text-xs text-muted-foreground">Demo mode: check-out is allowed before the start time.</p>}
              </ActionForm>
            )}
          </section>
        )}

        {/* Return + extension */}
        {["IN_USE", "OVERDUE"].includes(b.status) && (mine || staff) && (
          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">Return: record the final condition</h2>
            <ActionForm action={returnItem.bind(null, id)} submit="Confirm return">
              <Checklist items={r.checklist} />
              <PhotoInput label="Photo of the item now" required />
              <Field label="Notes (anything that changed?)"><Textarea name="notes" rows={2} /></Field>
            </ActionForm>
            {mine && !b.requested_end_at && b.status === "IN_USE" && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Need more time?</summary>
                <ActionForm action={requestExtension.bind(null, id)} submit="Request extension" variant="outline" className="mt-2 space-y-2">
                  <Field label="New end time (same day)"><Input type="time" name="to" required step={900} /></Field>
                  <Field label="Why?"><Input name="reason" required /></Field>
                </ActionForm>
              </details>
            )}
          </section>
        )}
        {b.requested_end_at && (
          <section className="space-y-2 rounded-lg border p-4 text-sm">
            <h2 className="font-semibold">Extension requested to {fmtTime(b.requested_end_at)}</h2>
            {staff ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <ActionForm action={decideExtension.bind(null, id, true)} submit="Approve extension" className="space-y-2">
                  <Input name="reason" required aria-label="Reason" defaultValue="No conflicting booking." />
                </ActionForm>
                <ActionForm action={decideExtension.bind(null, id, false)} submit="Decline" variant="outline" className="space-y-2">
                  <Input name="reason" required aria-label="Reason" placeholder="Why not?" />
                </ActionForm>
              </div>
            ) : <p>Waiting for the owner. If someone else has booked the next slot, it will be declined.</p>}
          </section>
        )}

        {/* Condition before/after */}
        {(out || back) && (
          <section className="space-y-2">
            <h2 className="font-semibold">Condition Vault: before and after</h2>
            <p className="text-xs text-muted-foreground">Only the borrower and staff for this resource department can access these reports and photos.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left"><th className="py-1">Item</th><th>At check-out</th><th>At return</th></tr></thead>
                <tbody>
                  {r.checklist.map((item) => {
                    const changed = out?.checklist[item] === "ok" && back?.checklist[item] === "issue";
                    return (
                      <tr key={item} className={`border-b ${changed ? "bg-red-50 font-semibold text-red-950" : ""}`}>
                        <td className="py-1">{item}</td>
                        <td>{out?.checklist[item] ?? "—"}</td>
                        <td>{back?.checklist[item] ?? "—"}{changed && " ← new issue"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {back?.ai_diff && (
              <AiNote title="Condition comparison" model={back.ai_diff._model}>
                <p>{back.ai_diff.summary}</p>
                {back.ai_diff.possible_issues.length > 0 && (
                  <ul className="list-disc pl-5 text-xs">
                    {back.ai_diff.possible_issues.map((p) => <li key={p.item + p.description}><strong>{p.item}</strong> ({p.confidence} confidence): {p.description}</li>)}
                  </ul>
                )}
              </AiNote>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {[out, back].map((rep, i) => rep && (
                <figure key={i} className="space-y-1 text-sm">
                  {rep.photo ? <img src={rep.photo} alt={`${rep.phase.toLowerCase()} photo`} className="h-40 w-full rounded border object-cover" /> : <p className="text-muted-foreground">No photo</p>}
                  <figcaption>{rep.phase === "CHECKOUT" ? "Check-out" : "Return"} · {fmt(rep.created_at)} · {rep.by}{rep.notes && ` · “${rep.notes}”`}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* Inspection */}
        {staff && b.status === "RETURNED" && (
          <section className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Inspect the returned item</h2>
            <ActionForm action={inspect.bind(null, id, "CLOSED")} submit="Pass and close" className="space-y-2">
              <Input name="reason" required aria-label="Inspection note" defaultValue="Inspected, condition matches check-out." />
            </ActionForm>
            <ActionForm action={inspect.bind(null, id, "DISPUTED")} submit="Open an incident" variant="destructive" className="space-y-2">
              <select name="type" className={selectCls} aria-label="Type"><option>DAMAGE</option><option>DELAY</option><option>MISUSE</option><option>SAFETY</option></select>
              <select name="severity" className={selectCls} aria-label="Severity"><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select>
              <Input name="reason" required aria-label="What is wrong" placeholder="What is wrong?" />
            </ActionForm>
          </section>
        )}

        {/* Incidents */}
        {incidents.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-semibold">Incidents</h2>
            {incidents.map((i) => (
              <div key={i.id} className="space-y-2 rounded-lg border p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2"><Status s={i.status} /> <strong>{i.type}</strong> · {i.severity} · reported by {i.reporter}, {fmt(i.created_at)}</p>
                <p>{i.description}</p>
                {i.ai_summary && staff && <AiNote title="Incident summary">{i.ai_summary}</AiNote>}
                {i.status === "RESOLVED" && <p><strong>Resolution:</strong> {i.resolution} · <strong>Outcome:</strong> {String(i.penalty).replace("_", " ").toLowerCase()}</p>}
                {i.appeal_status && <p><strong>Appeal ({i.appeal_status.toLowerCase()}):</strong> {i.appeal_text}</p>}
                {staff && i.status === "OPEN" && (
                  <ActionForm action={resolveIncident.bind(null, i.id)} submit="Resolve" className="space-y-2">
                    <Field label="Resolution"><Input name="resolution" required placeholder="e.g. Probe tip replaced from spares" /></Field>
                    <Field label="Outcome (a person decides; nothing is automatic)">
                      <select name="penalty" className={selectCls}>
                        <option value="NONE">No penalty</option><option value="WARNING">Warning</option>
                        <option value="STRIKE">Strike on record</option><option value="SUSPEND_7D">Suspend bookings for 7 days</option>
                      </select>
                    </Field>
                  </ActionForm>
                )}
                {mine && i.status === "RESOLVED" && i.penalty !== "NONE" && !i.appeal_status && (
                  <ActionForm action={appeal.bind(null, i.id)} submit="Appeal (once)" variant="outline" className="space-y-2">
                    <Textarea name="appeal" required rows={2} aria-label="Appeal" placeholder="Why should this be reconsidered?" />
                  </ActionForm>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Booking-linked customer complaint tickets and private evidence history. */}
        {(mine || staff) && (
          <section className="space-y-4">
            <div>
              <h2 className="font-semibold">Customer complaint tickets</h2>
              <p className="text-xs text-muted-foreground">Messages and evidence are visible only to this booking&apos;s customer and the resource department.</p>
            </div>
            {complaints.map((ticket) => {
              const status = ticket.status as ComplaintStatus;
              const transitions = COMPLAINT_TRANSITIONS[status] ?? [];
              return <article key={ticket.id} className="space-y-3 rounded-xl border p-4">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{COMPLAINT_ISSUES[ticket.issue_type as keyof typeof COMPLAINT_ISSUES] ?? ticket.issue_type}</h3>
                  <span className="rounded-full border px-2 py-1 text-xs">{complaintStatusLabel(status)}</span>
                </header>
                {staff && ticket.ai_summary && <AiNote title="AI complaint summary (advisory)">{ticket.ai_summary}</AiNote>}
                <ol className="space-y-3 border-l pl-4">
                  {complaintMessages.filter((message) => message.ticket_id === ticket.id).map((message) => (
                    <li key={message.id} className="space-y-1 text-sm">
                      <p className="text-xs text-muted-foreground">{message.author_name ?? "LabLoop"} · {fmt(message.created_at)}{message.status ? ` · ${complaintStatusLabel(message.status as ComplaintStatus)}` : ""}</p>
                      <p className="whitespace-pre-wrap">{message.body}</p>
                      {message.evidence && <a href={message.evidence} target="_blank" rel="noreferrer"><img src={message.evidence} alt="Complaint evidence" className="max-h-48 rounded-lg border object-contain" /></a>}
                    </li>
                  ))}
                </ol>
                {staff && transitions.length > 0 && <div className="grid gap-2 sm:grid-cols-2">
                  {transitions.map((to) => <ActionForm key={to} action={updateComplaintStatus.bind(null, ticket.id, to)} submit={`Set ${complaintStatusLabel(to)}`} className="space-y-2">
                    <Input name="message" required aria-label={`Customer message for status ${complaintStatusLabel(to)}`} placeholder="Update for the customer" />
                  </ActionForm>)}
                </div>}
                {ticket.status !== "CLOSED" && <ActionForm action={addComplaintMessage.bind(null, ticket.id)} submit="Add message" className="space-y-2">
                  <Textarea name="message" required rows={2} aria-label="Complaint message" placeholder="Add a message to the history" />
                  <PhotoInput name="evidence" label="Attach complaint evidence (optional)" />
                </ActionForm>}
                {mine && transitions.includes("ESCALATED") && <ActionForm action={escalateComplaint.bind(null, ticket.id)} submit="Escalate complaint" variant="outline" className="space-y-2">
                  <Input name="message" required aria-label="Escalation reason" placeholder="Why should this be escalated?" />
                </ActionForm>}
              </article>;
            })}
            {mine && <details className="rounded-xl border p-4">
              <summary className="cursor-pointer font-semibold">Open a complaint for this booking</summary>
              <ActionForm action={openComplaint.bind(null, id)} submit="Open complaint ticket" className="mt-3 space-y-3">
                <Field label="Issue type">
                  <select name="issue_type" className={selectCls} required>
                    {Object.entries(COMPLAINT_ISSUES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Describe the issue"><Textarea name="message" required rows={3} maxLength={5000} /></Field>
                <PhotoInput name="evidence" label="Attach evidence (optional)" />
              </ActionForm>
            </details>}
          </section>
        )}

        {/* Timeline */}
        <section className="space-y-2">
          <h2 className="font-semibold">Complete history</h2>
          <ol className="space-y-2 border-l pl-4 text-sm">
            {timeline.map((t) => (
              <li key={t.id}>
                <p><span className="font-medium">{t.action.replace("booking.", "").replace(/_/g, " ")}</span> · {fmt(t.at)} · {t.full_name ?? "LabLoop (automatic)"}{t.actor_role && t.actor_role !== "system" ? ` (${t.actor_role})` : ""}</p>
                {t.reason && <p className="text-muted-foreground">{t.reason}</p>}
                <p className="font-mono text-[10px] text-muted-foreground" title="Tamper-evident hash chain">#{t.id} · {t.hash.slice(0, 16)}…</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        {b.score_breakdown && (
          <section className="space-y-2 rounded-lg border p-4">
            <h2 className="font-semibold">Fair-Share Score</h2>
            <p className="text-xs text-muted-foreground">Used only to rank requests that compete for the same time. The owner makes the final call.</p>
            <Score lines={b.score_breakdown} total={Number(b.score)} />
          </section>
        )}
        {(mine || staff) && ["PENDING_REVIEW", "WAITLISTED", "OFFERED", "APPROVED"].includes(b.status) && (
          <section className="rounded-lg border p-4">
            <ActionForm action={cancelBooking.bind(null, id)} submit="Cancel booking" variant="outline" className="space-y-2">
              <Input name="reason" required aria-label="Cancellation reason" placeholder="Reason for cancelling" />
            </ActionForm>
          </section>
        )}
        {(mine || staff) && !["PENDING_REVIEW", "REJECTED", "CANCELLED"].includes(b.status) && (
          <details className="rounded-lg border p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Report damage, delay or a problem</summary>
            <ActionForm action={reportIncident.bind(null, id)} submit="Report" className="mt-2 space-y-2">
              <select name="type" className={selectCls} aria-label="Type"><option>DAMAGE</option><option>DELAY</option><option>CONFLICT</option><option>MISUSE</option><option>SAFETY</option></select>
              <select name="severity" className={selectCls} aria-label="Severity"><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select>
              <Textarea name="description" required rows={3} aria-label="What happened" placeholder="What happened?" />
            </ActionForm>
          </details>
        )}
      </aside>
    </div>
  );
}
