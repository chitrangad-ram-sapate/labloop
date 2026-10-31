import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const email = process.env.LABLOOP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.LABLOOP_ADMIN_PASSWORD;
const fullName = process.env.LABLOOP_ADMIN_NAME?.trim();
const emailDomain = process.env.LABLOOP_HOST_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, "");
if (!projectId || !email || !password || !fullName || !emailDomain) {
  throw new Error("Set FIREBASE_PROJECT_ID, LABLOOP_ADMIN_EMAIL, LABLOOP_ADMIN_PASSWORD, LABLOOP_ADMIN_NAME, and LABLOOP_HOST_EMAIL_DOMAIN in the private .env.local file first.");
}
if (password.length < 12) throw new Error("Use a unique admin password of at least 12 characters.");
if (email.split("@")[1] !== emailDomain) throw new Error("LABLOOP_ADMIN_EMAIL must use the configured host email domain.");

const [{ getFirebaseDb, newRecordId }, { hashPassword }] = await Promise.all([
  import("../src/lib/firebase"), import("../src/lib/auth"),
]);
const db = getFirebaseDb();
const hosts = await db.collection("organizations").where("email_domain", "==", emailDomain).get();
const matchingHosts = hosts.docs.filter((doc) => doc.get("kind") === "HOST");
if (matchingHosts.length !== 1 || matchingHosts[0].get("agreement_active") !== true) {
  throw new Error("Expected exactly one active HOST organization for LABLOOP_HOST_EMAIL_DOMAIN. No documents were changed.");
}

const host = matchingHosts[0];
const emailRef = db.collection("email_lookup").doc(createHash("sha256").update(email).digest("hex"));
const adminQuery = db.collection("profiles").where("role", "==", "admin");
const profileRef = db.collection("profiles").doc(newRecordId());
await db.runTransaction(async (tx) => {
  const [existingEmail, existingAdmins] = await Promise.all([tx.get(emailRef), tx.get(adminQuery)]);
  if (existingEmail.exists) throw new Error("That email already has an account. No documents were changed.");
  if (!existingAdmins.empty) throw new Error("An admin account already exists. No documents were changed.");
  tx.create(profileRef, {
    email,
    password_hash: hashPassword(password),
    full_name: fullName,
    role: "admin",
    org_id: host.id,
    org_name: String(host.get("name") ?? ""),
    org_kind: "HOST",
    department_id: null,
    identity_status: "NOT_REQUIRED",
    team_code: null,
    suspended_until: null,
    trust_id: `LL-${createHash("sha256").update(profileRef.id).digest("hex").slice(0, 10).toUpperCase()}`,
    created_at: new Date(),
  });
  tx.create(emailRef, { profile_id: profileRef.id });
});
console.log(`Admin account created in Firebase project ${projectId}. Sign in with the configured admin email.`);
