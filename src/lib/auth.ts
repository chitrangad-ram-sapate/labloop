import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fromFirestore, getFirebaseDb } from "./firebase";
export { checkPassword, hashPassword } from "./password";

export type Role = "user" | "external" | "manager" | "owner" | "admin";
export type Actor = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  org_id: string;
  org_name: string;
  department_id: string | null;
  identity_status: "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REJECTED";
  team_code: string | null;
  suspended_until: Date | null;
};

const COOKIE = "labloop_session";
const sessionSecretHint = process.env.NODE_ENV === "production"
  ? "Set SESSION_SECRET in the hosting service's environment settings, then redeploy or restart the service."
  : "Set it in .env.local, then restart the Next.js server.";

const sign = (id: string) => {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error(`SESSION_SECRET is not configured. ${sessionSecretHint}`);
  return createHmac("sha256", secret).update(id).digest("hex");
};

export async function startSession(id: string) {
  (await cookies()).set(COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 7,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function getActor(): Promise<Actor | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  const [id, sig] = raw?.split(".") ?? [];
  if (!id || !sig || sig !== sign(id)) return null;
  const snapshot = await getFirebaseDb().collection("profiles").doc(id).get();
  if (!snapshot.exists) return null;
  const profile = fromFirestore(snapshot.id, snapshot.data()!);
  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    role: profile.role,
    org_id: profile.org_id,
    org_name: profile.org_name ?? "",
    department_id: profile.department_id ?? null,
    identity_status: profile.identity_status,
    team_code: profile.team_code ?? null,
    suspended_until: profile.suspended_until ?? null,
  };
}

export async function requireActor(...roles: Role[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (roles.length && !roles.includes(actor.role)) redirect("/");
  return actor;
}

/** Owners/managers act only within their own department; admins everywhere. */
export function canManage(actor: Actor, departmentId: string) {
  return actor.role === "admin" || ((actor.role === "owner" || actor.role === "manager") && actor.department_id === departmentId);
}
