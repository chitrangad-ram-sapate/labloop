import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
const credentialsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
if (!projectId) throw new Error("FIREBASE_PROJECT_ID is missing. Set it in the private .env.local file.");
if (!serviceAccount && !credentialsFile) throw new Error("Firebase Admin credentials are missing. Set GOOGLE_APPLICATION_CREDENTIALS to a private local key-file path, or configure FIREBASE_SERVICE_ACCOUNT_JSON.");
if (!process.env.SESSION_SECRET?.trim()) throw new Error("SESSION_SECRET is missing. Set a unique session-signing secret in .env.local.");

const { getFirebaseDb } = await import("../src/lib/firebase");
const db = getFirebaseDb();
const collections = await db.listCollections();
const names = collections.map((collection) => collection.id).sort();
console.log(`Connected to Firestore project ${projectId}.`);
console.log(`Collections found: ${names.length ? names.join(", ") : "none yet"}.`);
for (const name of ["organizations", "departments", "profiles", "resources", "resource_requirements", "credential_types"]) {
  if (!names.includes(name)) console.log(`Setup required: create/populate the ${name} collection before using the app.`);
}
