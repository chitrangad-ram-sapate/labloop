import { after } from "next/server";
import { checkDocument, compareCondition, summariseComplaint, summariseIncident } from "./ai";
import { sql } from "./db";
import { notifyDepartment } from "./log";

// Background AI passes, scheduled after the user's action has committed. Results are stored
// next to the record they describe and shown to staff as advisory notes.

export function aiCheckIdentity(profileId: string) {
  after(async () => {
    const [p] = await sql`select p.id_doc, p.full_name, o.name as org from profiles p join organizations o on o.id = p.org_id where p.id = ${profileId}`;
    const r = await checkDocument(p?.id_doc, { kind: "identity", name: p.full_name, organisation: p.org });
    if (r) await sql`update profiles set id_ai_check = ${sql.json(r as never)} where id = ${profileId}`;
  });
}

export function aiCheckCredential(credentialId: string) {
  after(async () => {
    const [c] = await sql`select uc.evidence, p.full_name, ct.name from user_credentials uc join profiles p on p.id = uc.profile_id
                          join credential_types ct on ct.id = uc.credential_type_id where uc.id = ${credentialId}`;
    const r = await checkDocument(c?.evidence, { kind: "credential", name: c.full_name, credential: c.name });
    if (r) await sql`update user_credentials set ai_check = ${sql.json(r as never)} where id = ${credentialId}`;
  });
}

export function aiCompareReturn(bookingId: string) {
  after(async () => {
    const reports = await sql`select phase, checklist, notes, photo from condition_reports where booking_id = ${bookingId}`;
    const out = reports.find((x) => x.phase === "CHECKOUT");
    const back = reports.find((x) => x.phase === "RETURN");
    if (!out || !back) return;
    const r = await compareCondition(out as never, back as never);
    if (!r) return;
    await sql`update condition_reports set ai_diff = ${sql.json(r as never)} where booking_id = ${bookingId} and phase = 'RETURN'`;
    if (r.possible_issues.length) {
      const [b] = await sql`select r.department_id, r.name from bookings b join resources r on r.id = b.resource_id where b.id = ${bookingId}`;
      await notifyDepartment(sql, b.department_id, `AI note: possible issue with ${b.name}`, `${r.summary} (advisory; please inspect)`, `/bookings/${bookingId}`);
    }
  });
}

export function aiSummariseIncident(incidentId: string) {
  after(async () => {
    const [i] = await sql`select i.type, i.severity, i.description, r.name, c.checklist, c.notes, c.ai_diff
      from incidents i join resources r on r.id = i.resource_id
      left join condition_reports c on c.booking_id = i.booking_id and c.phase = 'RETURN' where i.id = ${incidentId}`;
    if (!i) return;
    const r = await summariseIncident(`Resource: ${i.name}\nType: ${i.type}, severity ${i.severity}\nReport: ${i.description}\nReturn checklist: ${JSON.stringify(i.checklist ?? {})}\nReturn notes: ${i.notes ?? ""}\nCondition comparison: ${i.ai_diff?.summary ?? "n/a"}`);
    if (r) await sql`update incidents set ai_summary = ${`${r.summary} Suggested follow-up: ${r.suggested_follow_up}`} where id = ${incidentId}`;
  });
}

export function aiSummariseComplaint(ticketId: string) {
  after(async () => {
    const messages = await sql`
      select t.issue_type, m.status, m.body from complaint_tickets t
      join complaint_messages m on m.ticket_id = t.id
      where t.id = ${ticketId} order by m.created_at`;
    if (!messages.length) return;
    const context = messages.map((m) => `${m.status ? `Status ${m.status}. ` : ""}${m.body}`).join("\n");
    const result = await summariseComplaint(`Issue type: ${messages[0].issue_type}\nComplaint history:\n${context}`);
    if (!result) return;
    await sql`update complaint_tickets set ai_summary = ${`${result.summary} Suggested next step: ${result.next_step}`}, updated_at = now() where id = ${ticketId}`;
  });
}
