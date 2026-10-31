import { fromFirestore, getFirebaseDb } from "@/lib/firebase";
import { trustStars, type TrustInputs } from "@/lib/rules";

export type TrustSummary = TrustInputs & {
  trustId: string;
  verificationStatus: string;
  onTimeRate: number;
  conditionRate: number;
  stars: number;
};

/** Call only for the signed-in profile or for an owner reviewing that user's booking. */
export async function getTrustSummary(profileId: string): Promise<TrustSummary> {
  const db = getFirebaseDb();
  const profile = await db.collection("profiles").doc(profileId).get();
  if (!profile.exists) throw new Error("Trust profile not found.");
  const [credentials, bookings, incidents, reports] = await Promise.all([
    db.collection("user_credentials").where("profile_id", "==", profileId).get(),
    db.collection("bookings").where("user_id", "==", profileId).get(),
    db.collection("incidents").where("user_id", "==", profileId).get(),
    db.collection("condition_reports").get(),
  ]);
  const completed = bookings.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((booking) => ["RETURNED", "CLOSED", "DISPUTED"].includes(String(booking.status)));
  const completedIds = new Set(completed.map((booking) => booking.id));
  const onTimeReturns = completed.filter((booking) => booking.returned_at && new Date(booking.returned_at).getTime() <= new Date(booking.end_at).getTime()).length;
  const reportsForUser = reports.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((report) => completedIds.has(String(report.booking_id)) && report.phase === "RETURN");
  const cleanConditionReturns = reportsForUser.filter((report) => Object.values(report.checklist as Record<string, string>).every((value) => value !== "issue")).length;
  const now = Date.now();
  const verifiedTrainings = credentials.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((credential) => credential.status === "VERIFIED" && (!credential.expires_at || new Date(credential.expires_at).getTime() > now)).length;
  const incidentCount = incidents.docs.filter((doc) => doc.get("status") !== "RESOLVED" || doc.get("penalty") !== "NONE").length;
  const inputs = { completedBookings: completed.length, onTimeReturns, cleanConditionReturns, verifiedTrainings, incidents: incidentCount };
  return {
    ...inputs,
    trustId: String(profile.get("trust_id") ?? ""),
    verificationStatus: String(profile.get("identity_status") ?? "NOT_REQUIRED"),
    onTimeRate: completed.length ? onTimeReturns / completed.length : 1,
    conditionRate: completed.length ? cleanConditionReturns / completed.length : 1,
    stars: trustStars(inputs),
  };
}
