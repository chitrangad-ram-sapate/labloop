import "server-only";

import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";

/* Firestore records are schema-less documents; callers validate/normalize fields at each domain boundary. */
/* eslint @typescript-eslint/no-explicit-any: "off" */

const APP_NAME = "labloop-admin";
let cachedDb: Firestore | undefined;

/** Initialize Firebase Admin only at request time so a build does not need project credentials. */
export function getFirebaseDb(): Firestore {
  if (cachedDb) return cachedDb;

  let app = getApps().find((candidate) => candidate.name === APP_NAME);
  if (!app) {
    const inlineCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    const options = inlineCredentials
      ? {
          credential: cert(parseServiceAccount(inlineCredentials)),
          ...(projectId ? { projectId } : {}),
        }
      : process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
        ? { credential: applicationDefault(), ...(projectId ? { projectId } : {}) }
        : null;

    if (!options) {
      throw new Error(
        "Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_PROJECT_ID in the hosting environment, or use GOOGLE_APPLICATION_CREDENTIALS locally.",
      );
    }

    app = initializeApp(options, APP_NAME);
  }

  cachedDb = getFirestore(app);
  return cachedDb;
}

function parseServiceAccount(raw: string): ServiceAccount {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") throw new Error();
    const account = value as Record<string, unknown>;
    if (
      typeof account.project_id !== "string" ||
      typeof account.client_email !== "string" ||
      typeof account.private_key !== "string"
    ) {
      throw new Error();
    }
    return {
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain a valid Firebase service-account JSON object.");
  }
}

export type LabLoopRecord = Record<string, any> & { id: string };

export function newRecordId() {
  return randomUUID();
}

export function fromFirestore(id: string, data: DocumentData): any {
  const convert = (value: unknown): unknown => {
    if (value instanceof Timestamp) return value.toDate();
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, convert(child)]));
    }
    return value;
  };
  return { ...convert(data) as Record<string, any>, id };
}

export async function getRecord(collection: string, id: string): Promise<LabLoopRecord | null> {
  const snap = await getFirebaseDb().collection(collection).doc(id).get();
  return snap.exists ? fromFirestore(snap.id, snap.data()!) : null;
}

export async function listRecords(collection: string): Promise<LabLoopRecord[]> {
  const snap = await getFirebaseDb().collection(collection).get();
  return snap.docs.map((doc) => fromFirestore(doc.id, doc.data()));
}

export function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as Partial<T>;
}
