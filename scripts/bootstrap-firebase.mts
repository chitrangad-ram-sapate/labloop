import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const email = process.env.LABLOOP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.LABLOOP_ADMIN_PASSWORD;
const fullName = process.env.LABLOOP_ADMIN_NAME?.trim();
const organizationName = process.env.LABLOOP_HOST_ORG_NAME?.trim();
const emailDomain = process.env.LABLOOP_HOST_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, "");
if (!projectId || !email || !password || !fullName || !organizationName || !emailDomain) {
  throw new Error("Set FIREBASE_PROJECT_ID, LABLOOP_ADMIN_EMAIL, LABLOOP_ADMIN_PASSWORD, LABLOOP_ADMIN_NAME, LABLOOP_HOST_ORG_NAME, and LABLOOP_HOST_EMAIL_DOMAIN in the private .env.local file first.");
}
if (password.length < 12) throw new Error("Use a unique bootstrap admin password of at least 12 characters.");
if (email.split("@")[1] !== emailDomain) throw new Error("LABLOOP_ADMIN_EMAIL must use the configured host email domain.");

const [{ getFirebaseDb, newRecordId }, { hashPassword }] = await Promise.all([
  import("../src/lib/firebase"), import("../src/lib/auth"),
]);
const db = getFirebaseDb();
const protectedCollections = ["profiles", "organizations", "departments", "resources", "credential_types", "resource_requirements", "user_credentials", "bookings", "booking_items", "booking_requests", "cart_items", "condition_reports", "incidents", "complaint_tickets", "complaint_messages", "owner_access_requests", "notifications", "audit_log"];
const [existingCollections, emailLookup] = await Promise.all([
  Promise.all(protectedCollections.map((name) => db.collection(name).limit(1).get())),
  db.collection("email_lookup").doc(createHash("sha256").update(email).digest("hex")).get(),
]);
if (existingCollections.some((snapshot) => !snapshot.empty) || emailLookup.exists) {
  throw new Error("Bootstrap refused: this Firestore project already contains LabLoop business data. No documents were changed.");
}

const adminId = newRecordId();
const now = new Date();
const batch = db.batch();
batch.create(db.collection("organizations").doc("host"), {
  name: organizationName, kind: "HOST", email_domain: emailDomain, agreement_active: true, created_at: now,
});
for (const [id, code, name] of [
  ["mech", "MECH", "Mechanical Makerspace"], ["ece", "ECE", "Electronics Lab"],
  ["cse", "CSE", "Computing Lab"], ["media", "MEDIA", "Media Studio"],
]) {
  batch.create(db.collection("departments").doc(id), { code, name, created_at: now });
}
batch.create(db.collection("profiles").doc(adminId), {
  email, password_hash: hashPassword(password), full_name: fullName, role: "admin", org_id: "host",
  org_name: organizationName, org_kind: "HOST", department_id: null, identity_status: "NOT_REQUIRED",
  team_code: null, suspended_until: null, trust_id: `LL-${createHash("sha256").update(adminId).digest("hex").slice(0, 10).toUpperCase()}`,
  created_at: now,
});
batch.create(db.collection("email_lookup").doc(createHash("sha256").update(email).digest("hex")), { profile_id: adminId });
await batch.commit();
console.log(`Initial LabLoop administrator and host organization created in Firebase project ${projectId}. Sign in using the admin email you configured.`);
