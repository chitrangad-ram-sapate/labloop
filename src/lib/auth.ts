import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "./db";

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

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

export function checkPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(Buffer.from(hash, "hex"), scryptSync(pw, salt, 32));
}

const sign = (id: string) => {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("SESSION_SECRET is not configured. Set it in .env.local, then restart the Next.js server.");
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
  const [actor] = await sql<Actor[]>`
    select p.id, p.email, p.full_name, p.role, p.org_id, o.name as org_name, p.department_id,
           p.identity_status, p.team_code, p.suspended_until
    from profiles p join organizations o on o.id = p.org_id where p.id = ${id}`;
  return actor ?? null;
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
