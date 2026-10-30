"use server";

import { attempt, need, photo, type ActionResult } from "@/lib/action";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import { audit, notify } from "@/lib/log";

/** Users submit evidence; only a manager/owner/admin can turn it into a verified credential. */
export async function submitCredential(_: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const evidence = photo(fd, "evidence");
    if (!evidence) throw new Error("Attach a photo of your certificate.");
    const typeId = need(fd, "credential_type_id", "which credential");
    await sql.begin(async (tx) => {
      await tx`delete from user_credentials where profile_id = ${actor.id} and credential_type_id = ${typeId} and status <> 'VERIFIED'`;
      const [c] = await tx`insert into user_credentials (profile_id, credential_type_id, status, evidence) values (${actor.id}, ${typeId}, 'PENDING', ${evidence}) returning id`;
      await audit(tx, actor, "credential.submitted", "credential", c.id, "Evidence uploaded for verification");
      await tx`insert into notifications (user_id, title, body, link)
               select id, 'Certificate to verify', ${actor.full_name}, '/manage' from profiles where role = 'manager'`;
    });
    return "Uploaded. A lab manager will verify it.";
  });
}

export async function submitIdentity(_: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("external");
    const doc = photo(fd, "id_doc");
    if (!doc) throw new Error("Attach a photo of your ID.");
    await sql.begin(async (tx) => {
      await tx`update profiles set id_doc = ${doc}, identity_status = 'PENDING', identity_reason = null where id = ${actor.id}`;
      await audit(tx, actor, "identity.submitted", "profile", actor.id, "ID uploaded for verification");
      await tx`insert into notifications (user_id, title, body, link)
               select id, 'External user to verify', ${actor.full_name}, '/manage' from profiles where role = 'manager'`;
    });
    return "Uploaded. A lab manager will verify it.";
  });
}

export async function decideCredential(id: string, ok: boolean, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("manager", "owner", "admin");
    const reason = need(fd, "reason", "a reason");
    await sql.begin(async (tx) => {
      const [c] = await tx`update user_credentials uc set status = ${ok ? "VERIFIED" : "REJECTED"}, decided_by = ${actor.id}, decision_reason = ${reason}, decided_at = now(),
          expires_at = case when ${ok} then now() + make_interval(days => coalesce(ct.validity_days, 3650)) end
        from credential_types ct where ct.id = uc.credential_type_id and uc.id = ${id} and uc.status = 'PENDING'
        returning uc.profile_id, ct.name`;
      if (!c) throw new Error("Already decided.");
      await audit(tx, actor, ok ? "credential.verified" : "credential.rejected", "credential", id, reason, { credential: c.name });
      await notify(tx, c.profile_id, `${c.name}: ${ok ? "verified" : "not accepted"}`, reason, "/me");
    });
    return "Decision recorded.";
  });
}

export async function decideIdentity(profileId: string, ok: boolean, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("manager", "owner", "admin");
    const reason = need(fd, "reason", "a reason");
    await sql.begin(async (tx) => {
      const [p] = await tx`update profiles set identity_status = ${ok ? "VERIFIED" : "REJECTED"}, identity_reason = ${reason}
                           where id = ${profileId} and identity_status = 'PENDING' returning id`;
      if (!p) throw new Error("Already decided.");
      await audit(tx, actor, ok ? "identity.verified" : "identity.rejected", "profile", profileId, reason);
      await notify(tx, profileId, ok ? "Identity verified, you can now book" : "Identity not accepted", reason, ok ? "/" : "/me");
    });
    return "Decision recorded.";
  });
}

export async function markAllRead() {
  const actor = await requireActor();
  await sql`update notifications set read_at = now() where user_id = ${actor.id} and read_at is null`;
}
