"use server";

import { attempt, need, photo, type ActionResult } from "@/lib/action";
import { aiCheckCredential, aiCheckIdentity } from "@/lib/ai-jobs";
import { requireActor } from "@/lib/auth";
import { getFirebaseDb, newRecordId } from "@/lib/firebase";
import { audit, notify } from "@/lib/log";

export async function submitCredential(_: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor();
    const evidence = photo(fd, "evidence");
    if (!evidence) throw new Error("Attach a photo of your certificate.");
    const typeId = need(fd, "credential_type_id", "which credential");
    const db = getFirebaseDb();
    const query = db.collection("user_credentials").where("profile_id", "==", actor.id).where("credential_type_id", "==", typeId);
    const old = await query.get();
    const id = newRecordId();
    const batch = db.batch();
    old.docs.filter((doc) => doc.get("status") !== "VERIFIED").forEach((doc) => batch.delete(doc.ref));
    batch.create(db.collection("user_credentials").doc(id), { profile_id: actor.id, credential_type_id: typeId, status: "PENDING", evidence, ai_check: null, decided_by: null, decision_reason: null, decided_at: null, expires_at: null, created_at: new Date() });
    await batch.commit();
    await audit(null, actor, "credential.submitted", "credential", id, "Evidence uploaded for verification");
    const managers = await db.collection("profiles").where("role", "==", "manager").get();
    await Promise.all(managers.docs.map((manager) => notify(null, manager.id, "Certificate to verify", actor.full_name, "/manage")));
    aiCheckCredential(id);
    return "Uploaded. A lab manager will verify it.";
  });
}

export async function submitIdentity(_: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("external");
    const doc = photo(fd, "id_doc");
    if (!doc) throw new Error("Attach a photo of your ID.");
    await getFirebaseDb().collection("profiles").doc(actor.id).update({ id_doc: doc, identity_status: "PENDING", identity_reason: null });
    await audit(null, actor, "identity.submitted", "profile", actor.id, "ID uploaded for verification");
    const managers = await getFirebaseDb().collection("profiles").where("role", "==", "manager").get();
    await Promise.all(managers.docs.map((manager) => notify(null, manager.id, "External user to verify", actor.full_name, "/manage")));
    aiCheckIdentity(actor.id);
    return "Uploaded. A lab manager will verify it.";
  });
}

export async function decideCredential(id: string, ok: boolean, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("manager", "owner", "admin");
    const reason = need(fd, "reason", "a reason");
    const db = getFirebaseDb();
    const credentialRef = db.collection("user_credentials").doc(id);
    const credential = await credentialRef.get();
    if (!credential.exists || credential.get("status") !== "PENDING") throw new Error("Already decided.");
    const type = await db.collection("credential_types").doc(String(credential.get("credential_type_id"))).get();
    const expires = ok ? new Date(Date.now() + Number(type.get("validity_days") ?? 3650) * 86_400_000) : null;
    await db.runTransaction(async (tx) => {
      const current = await tx.get(credentialRef);
      if (!current.exists || current.get("status") !== "PENDING") throw new Error("Already decided.");
      tx.update(credentialRef, { status: ok ? "VERIFIED" : "REJECTED", decided_by: actor.id, decision_reason: reason, decided_at: new Date(), expires_at: expires });
    });
    const profileId = String(credential.get("profile_id"));
    const name = String(type.get("name") ?? "Training");
    await audit(null, actor, ok ? "credential.verified" : "credential.rejected", "credential", id, reason, { credential: name });
    await notify(null, profileId, `${name}: ${ok ? "verified" : "not accepted"}`, reason, "/me");
    return "Decision recorded.";
  });
}

export async function decideIdentity(profileId: string, ok: boolean, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("manager", "owner", "admin");
    const reason = need(fd, "reason", "a reason");
    const profileRef = getFirebaseDb().collection("profiles").doc(profileId);
    await getFirebaseDb().runTransaction(async (tx) => {
      const profile = await tx.get(profileRef);
      if (!profile.exists || profile.get("identity_status") !== "PENDING") throw new Error("Already decided.");
      tx.update(profileRef, { identity_status: ok ? "VERIFIED" : "REJECTED", identity_reason: reason });
    });
    await audit(null, actor, ok ? "identity.verified" : "identity.rejected", "profile", profileId, reason);
    await notify(null, profileId, ok ? "Identity verified, you can now book" : "Identity not accepted", reason, ok ? "/" : "/me");
    return "Decision recorded.";
  });
}

export async function markAllRead() {
  const actor = await requireActor();
  const rows = await getFirebaseDb().collection("notifications").where("user_id", "==", actor.id).get();
  const unread = rows.docs.filter((doc) => !doc.get("read_at"));
  for (let offset = 0; offset < unread.length; offset += 450) {
    const batch = getFirebaseDb().batch();
    unread.slice(offset, offset + 450).forEach((doc) => batch.update(doc.ref, { read_at: new Date() }));
    await batch.commit();
  }
}
