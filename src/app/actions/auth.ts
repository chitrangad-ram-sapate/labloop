"use server";

import { redirect } from "next/navigation";
import { attempt, need, photo, str, type ActionResult } from "@/lib/action";
import { aiCheckIdentity } from "@/lib/ai-jobs";
import { checkPassword, endSession, hashPassword, startSession } from "@/lib/auth";
import { createHash } from "node:crypto";
import { fromFirestore, getFirebaseDb, newRecordId } from "@/lib/firebase";
import { audit } from "@/lib/log";

function safeReturnPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const target = new URL(value, "https://labloop.invalid");
    return target.origin === "https://labloop.invalid" ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch {
    return "/";
  }
}

export async function login(_: ActionResult, fd: FormData) {
  return attempt(async () => {
    const email = need(fd, "email", "your email").toLowerCase();
    const db = getFirebaseDb();
    const emailRef = db.collection("email_lookup").doc(emailKey(email));
    const lookup = await emailRef.get();
    const profileId = lookup.get("profile_id");
    let p = typeof profileId === "string" ? await db.collection("profiles").doc(profileId).get() : null;
    // Older imports may contain profiles without the companion email_lookup document.
    // Search by their normalized email and repair the index only after password proof.
    if (!p?.exists || String(p.get("email") ?? "").toLowerCase() !== email) {
      const matches = await db.collection("profiles").where("email", "==", email).limit(2).get();
      p = matches.size === 1 ? matches.docs[0] : null;
    }
    const data = p?.exists ? p.data() : null;
    if (!data || !checkPassword(str(fd, "password"), String(data.password_hash ?? ""))) throw new Error("Email or password is incorrect.");
    await db.runTransaction(async (tx) => {
      const currentLookup = await tx.get(emailRef);
      if (!currentLookup.exists) tx.create(emailRef, { profile_id: p!.id });
      else if (currentLookup.get("profile_id") !== p!.id) throw new Error("Account lookup needs administrator review.");
    });
    await startSession(p!.id);
    redirect(safeReturnPath(str(fd, "redirectTo")));
  });
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
    const organizations = await getFirebaseDb().collection("organizations").where("email_domain", "==", domain).limit(1).get();
    const org = organizations.docs[0] ? fromFirestore(organizations.docs[0].id, organizations.docs[0].data()) : null;
    if (!org) throw new Error(`“${domain}” is not an approved partner domain. Ask your college to sign an agreement with the host.`);
    if (!org.agreement_active) throw new Error("Your organisation's partnership is currently suspended.");
    const external = org.kind !== "HOST";
    const idDoc = photo(fd, "id_doc");
    if (external && !idDoc) throw new Error("Please attach a photo of your college ID or incubator letter.");

    const db = getFirebaseDb();
    const id = newRecordId();
    const emailRef = db.collection("email_lookup").doc(emailKey(email));
    const profileRef = db.collection("profiles").doc(id);
    try {
      await db.runTransaction(async (tx) => {
        const [duplicate, matchingProfiles] = await Promise.all([
          tx.get(emailRef),
          tx.get(db.collection("profiles").where("email", "==", email).limit(1)),
        ]);
        if (duplicate.exists || !matchingProfiles.empty) throw new Error("An account with this email already exists.");
        tx.create(profileRef, {
          email,
          password_hash: hashPassword(password),
          full_name: need(fd, "full_name", "your name"),
          role: external ? "external" : "user",
          org_id: org.id,
          org_name: org.name,
          org_kind: org.kind,
          department_id: null,
          identity_status: external ? "PENDING" : "NOT_REQUIRED",
          id_doc: idDoc,
          id_ai_check: null,
          identity_reason: null,
          team_code: str(fd, "team_code").toUpperCase() || null,
          suspended_until: null,
          trust_id: `LL-${createHash("sha256").update(id).digest("hex").slice(0, 10).toUpperCase()}`,
          created_at: new Date(),
        });
        tx.create(emailRef, { profile_id: id });
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) throw error;
      throw error;
    }
    await audit(null, null, "profile.signup", "profile", id, external ? "External sign-up; identity awaiting manager verification" : "Host student sign-up");
    if (external) {
      const managers = await db.collection("profiles").where("role", "==", "manager").get();
      await Promise.all(managers.docs.map((manager) => getFirebaseDb().collection("notifications").add({
        user_id: manager.id, title: "New external user to verify", body: email, link: "/manage", read_at: null, created_at: new Date(),
      })));
    }
    if (external) aiCheckIdentity(id);
    await startSession(id);
    redirect("/");
  });
}

function emailKey(email: string) {
  return createHash("sha256").update(email.toLowerCase()).digest("hex");
}
