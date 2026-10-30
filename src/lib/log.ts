import type { Actor } from "./auth";
import type { Tx } from "./db";

/** Writes one row to the hash-chained audit log (the chain itself is computed by a DB trigger). */
export async function audit(tx: Tx, actor: Actor | null, action: string, entityType: string, entityId: string | null, reason: string | null, data: object = {}) {
  await tx`insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, reason, data)
           values (${actor?.id ?? null}, ${actor?.role ?? "system"}, ${action}, ${entityType}, ${entityId}, ${reason}, ${tx.json(data as never)})`;
}

export async function notify(tx: Tx, userId: string, title: string, body: string, link: string | null = null) {
  await tx`insert into notifications (user_id, title, body, link) values (${userId}, ${title}, ${body}, ${link})`;
}

/** Notifies every owner/manager of a department. */
export async function notifyDepartment(tx: Tx, departmentId: string, title: string, body: string, link: string | null = null) {
  await tx`insert into notifications (user_id, title, body, link)
           select id, ${title}, ${body}, ${link} from profiles
           where department_id = ${departmentId} and role in ('owner','manager')`;
}
