import { createHash } from "node:crypto";
import type { Actor } from "./auth";
import { getFirebaseDb, newRecordId } from "./firebase";

type FirestoreTx = FirebaseFirestore.Transaction;
const auditHeads = new WeakMap<object, { hash: string; sequence: number }>();

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function computeAuditHash(entry: { prev_hash: string; at: Date | string; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; reason: string | null; data: object }) {
  const at = entry.at instanceof Date ? entry.at.toISOString() : new Date(entry.at).toISOString();
  return createHash("sha256").update(`${entry.prev_hash}|${at}|${entry.actor_id ?? ""}|${entry.action}|${entry.entity_type}|${entry.entity_id ?? ""}|${entry.reason ?? ""}|${stableJson(entry.data)}`).digest("hex");
}

/** A tamper-evident audit chain stored in Firestore; the head update and entry are atomic. */
async function appendAudit(tx: FirestoreTx, actor: Actor | null, action: string, entityType: string, entityId: string | null, reason: string | null, data: object) {
  const db = getFirebaseDb();
  const entryId = newRecordId();
  const headRef = db.collection("_system").doc("audit_head");
  const entryRef = db.collection("audit_log").doc(entryId);
  let chain = auditHeads.get(tx);
  if (!chain) {
    const head = await tx.get(headRef);
    chain = { hash: String(head.get("hash") ?? "GENESIS"), sequence: Number(head.get("sequence") ?? 0) };
  }
  const previousHash = chain.hash;
  const sequence = chain.sequence + 1;
  const at = new Date();
  const payload = {
    id: entryId, sequence, at, actor_id: actor?.id ?? null, actor_role: actor?.role ?? "system",
    action, entity_type: entityType, entity_id: entityId, reason, data, prev_hash: previousHash,
  };
  const hash = computeAuditHash(payload);
  tx.create(entryRef, { ...payload, hash });
  tx.set(headRef, { hash, entry_id: entryId, sequence, at });
  auditHeads.set(tx, { hash, sequence });
}

/** Pass the domain transaction to keep the audit entry atomic with its state change. */
export async function audit(transaction: unknown, actor: Actor | null, action: string, entityType: string, entityId: string | null, reason: string | null, data: object = {}) {
  const candidate = transaction as Partial<FirestoreTx> | null;
  if (candidate && typeof candidate.get === "function" && typeof candidate.create === "function" && typeof candidate.set === "function") {
    await appendAudit(candidate as FirestoreTx, actor, action, entityType, entityId, reason, data);
    return;
  }
  await getFirebaseDb().runTransaction((tx) => appendAudit(tx, actor, action, entityType, entityId, reason, data));
}

export async function notify(_tx: unknown, userId: string, title: string, body: string, link: string | null = null) {
  await getFirebaseDb().collection("notifications").add({ user_id: userId, title, body, link, read_at: null, created_at: new Date() });
}

/** Notifies every owner/manager of a department. */
export async function notifyDepartment(tx: unknown, departmentId: string, title: string, body: string, link: string | null = null) {
  const profiles = await getFirebaseDb().collection("profiles").where("department_id", "==", departmentId).get();
  await Promise.all(profiles.docs
    .filter((profile) => ["owner", "manager"].includes(String(profile.get("role"))))
    .map((profile) => notify(tx, profile.id, title, body, link)));
}
