import { after } from "next/server";
import { checkDocument, compareCondition, summariseComplaint, summariseIncident } from "./ai";
import { fromFirestore, getFirebaseDb } from "./firebase";
import { notifyDepartment } from "./log";

// Background AI passes are advisory; people retain every verification and incident decision.
export function aiCheckIdentity(profileId: string) {
  after(async () => {
    const db = getFirebaseDb();
    const profile = await db.collection("profiles").doc(profileId).get();
    if (!profile.exists) return;
    const result = await checkDocument(profile.get("id_doc"), { kind: "identity", name: String(profile.get("full_name")), organisation: String(profile.get("org_name") ?? "") });
    if (result) await profile.ref.update({ id_ai_check: result });
  });
}

export function aiCheckCredential(credentialId: string) {
  after(async () => {
    const db = getFirebaseDb();
    const credential = await db.collection("user_credentials").doc(credentialId).get();
    if (!credential.exists) return;
    const [profile, type] = await Promise.all([
      db.collection("profiles").doc(String(credential.get("profile_id"))).get(),
      db.collection("credential_types").doc(String(credential.get("credential_type_id"))).get(),
    ]);
    const result = await checkDocument(credential.get("evidence"), { kind: "credential", name: String(profile.get("full_name") ?? ""), credential: String(type.get("name") ?? "") });
    if (result) await credential.ref.update({ ai_check: result });
  });
}

export function aiCompareReturn(bookingId: string) {
  after(async () => {
    const db = getFirebaseDb();
    const snapshot = await db.collection("condition_reports").where("booking_id", "==", bookingId).get();
    const reports = snapshot.docs.map((doc) => fromFirestore(doc.id, doc.data()));
    const before = reports.find((report) => report.phase === "CHECKOUT");
    const afterReport = reports.find((report) => report.phase === "RETURN");
    if (!before || !afterReport) return;
    const result = await compareCondition(before as never, afterReport as never);
    if (!result) return;
    await db.collection("condition_reports").doc(afterReport.id).update({ ai_diff: result });
    if (result.possible_issues.length) {
      const booking = await db.collection("bookings").doc(bookingId).get();
      const resource = await db.collection("resources").doc(String(booking.get("resource_id"))).get();
      if (resource.exists) await notifyDepartment(null, String(resource.get("department_id")), `AI note: possible issue with ${resource.get("name")}`, `${result.summary} (advisory; please inspect)`, `/bookings/${bookingId}`);
    }
  });
}

export function aiSummariseIncident(incidentId: string) {
  after(async () => {
    const db = getFirebaseDb();
    const incident = await db.collection("incidents").doc(incidentId).get();
    if (!incident.exists) return;
    const resource = await db.collection("resources").doc(String(incident.get("resource_id"))).get();
    const reports = incident.get("booking_id") ? await db.collection("condition_reports").where("booking_id", "==", incident.get("booking_id")).get() : null;
    const returnReport = reports?.docs.map((doc) => fromFirestore(doc.id, doc.data())).find((report) => report.phase === "RETURN");
    const result = await summariseIncident(`Resource: ${resource.get("name") ?? "Unknown"}\nType: ${incident.get("type")}, severity ${incident.get("severity")}\nReport: ${incident.get("description")}\nReturn checklist: ${JSON.stringify(returnReport?.checklist ?? {})}\nReturn notes: ${returnReport?.notes ?? ""}\nCondition comparison: ${returnReport?.ai_diff?.summary ?? "n/a"}`);
    if (result) await incident.ref.update({ ai_summary: `${result.summary} Suggested follow-up: ${result.suggested_follow_up}` });
  });
}

export function aiSummariseComplaint(ticketId: string) {
  after(async () => {
    const db = getFirebaseDb();
    const ticket = await db.collection("complaint_tickets").doc(ticketId).get();
    if (!ticket.exists) return;
    const messages = await db.collection("complaint_messages").where("ticket_id", "==", ticketId).get();
    const history = messages.docs.map((doc) => fromFirestore(doc.id, doc.data())).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (!history.length) return;
    const context = history.map((message) => `${message.status ? `Status ${message.status}. ` : ""}${message.body}`).join("\n");
    const result = await summariseComplaint(`Issue type: ${ticket.get("issue_type")}\nComplaint history:\n${context}`);
    if (result) await ticket.ref.update({ ai_summary: `${result.summary} Suggested next step: ${result.next_step}`, updated_at: new Date() });
  });
}
