"use server";

import { redirect } from "next/navigation";
import { attempt, need, photo, str, type ActionResult } from "@/lib/action";
import { checkPassword, endSession, hashPassword, startSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { audit } from "@/lib/log";

export async function login(_: ActionResult, fd: FormData) {
  return attempt(async () => {
    const [p] = await sql`select id, password_hash from profiles where email = ${need(fd, "email", "your email").toLowerCase()}`;
    if (!p || !checkPassword(str(fd, "password"), p.password_hash)) throw new Error("Email or password is incorrect.");
    await startSession(p.id);
    redirect("/");
  });
}

export async function demoLogin(email: string) {
  if (process.env.DEMO_MODE !== "true") throw new Error("Demo sign-in is disabled.");
  const [p] = await sql`select id from profiles where email = ${email}`;
  if (!p) throw new Error("Demo data missing. Ask an admin to reset it.");
  await startSession(p.id);
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

/** Host students sign up with the host domain; partner users with an approved partner domain plus an ID for manual verification. */
export async function signup(_: ActionResult, fd: FormData) {
  return attempt(async () => {
    const email = need(fd, "email", "your institutional email").toLowerCase();
    const password = need(fd, "password", "a password");
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    const domain = email.split("@")[1] ?? "";
    const [org] = await sql`select id, kind, agreement_active from organizations where email_domain = ${domain}`;
    if (!org) throw new Error(`“${domain}” is not an approved partner domain. Ask your college to sign an agreement with the host.`);
    if (!org.agreement_active) throw new Error("Your organisation's partnership is currently suspended.");
    const external = org.kind !== "HOST";
    const idDoc = photo(fd, "id_doc");
    if (external && !idDoc) throw new Error("Please attach a photo of your college ID or incubator letter.");

    const id = await sql.begin(async (tx) => {
      const [p] = await tx`insert into profiles (email, password_hash, full_name, role, org_id, identity_status, id_doc, team_code)
        values (${email}, ${hashPassword(password)}, ${need(fd, "full_name", "your name")}, ${external ? "external" : "user"}, ${org.id},
                ${external ? "PENDING" : "NOT_REQUIRED"}, ${idDoc}, ${str(fd, "team_code").toUpperCase() || null}) returning id`;
      await audit(tx, null, "profile.signup", "profile", p.id, external ? "External sign-up; identity awaiting manager verification" : "Host student sign-up");
      if (external)
        await tx`insert into notifications (user_id, title, body, link)
                 select id, 'New external user to verify', ${email}, '/manage' from profiles where role = 'manager'`;
      return p.id as string;
    }).catch((e) => {
      if (e.code === "23505") throw new Error("An account with this email already exists.");
      throw e;
    });
    await startSession(id);
    redirect("/");
  });
}
