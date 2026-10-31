"use server";

import { revalidatePath } from "next/cache";
import { attempt, need, type ActionResult } from "@/lib/action";
import { requireActor } from "@/lib/auth";
import { getFirebaseDb, newRecordId } from "@/lib/firebase";
import { audit, notify } from "@/lib/log";

export async function requestOwnerAccess(_: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("user");
    const departmentId = need(fd, "department_id", "a department");
    const reason = need(fd, "reason", "a short explanation");
    if (reason.length < 20 || reason.length > 1000) throw new Error("Please write 20 to 1,000 characters about your connection to this department.");
    const db = getFirebaseDb();
    const profileRef = db.collection("profiles").doc(actor.id);
    const departmentRef = db.collection("departments").doc(departmentId);
    const requestId = newRecordId();
    const requestRef = db.collection("owner_access_requests").doc(requestId);
    const lockRef = db.collection("_system").doc(`owner_access_${actor.id}`);
    await db.runTransaction(async (tx) => {
      const [profile, department, lock] = await Promise.all([tx.get(profileRef), tx.get(departmentRef), tx.get(lockRef)]);
      const pending = await tx.get(db.collection("owner_access_requests").where("profile_id", "==", actor.id).where("status", "==", "PENDING"));
      if (!profile.exists || profile.get("role") !== "user" || profile.get("org_kind") !== "HOST") throw new Error("Owner access requests are available to host-institution users only.");
      if (!department.exists) throw new Error("Choose a department from the list.");
      if (!pending.empty) throw new Error("You already have a pending owner access request.");
      tx.set(lockRef, { version: Number(lock.get("version") ?? 0) + 1 });
      tx.create(requestRef, { profile_id: actor.id, department_id: departmentId, reason, status: "PENDING", reviewed_by: null, reviewed_at: null, decision_reason: null, created_at: new Date() });
    });
    await audit(null, actor, "owner_access.requested", "owner_access_request", requestId, reason, { department_id: departmentId });
    const admins = await db.collection("profiles").where("role", "==", "admin").get();
    await Promise.all(admins.docs.map((admin) => notify(null, admin.id, "Owner access request to review", actor.full_name, "/admin")));
    revalidatePath("/owner-access");
    return "Your request was sent to a LabLoop administrator for review.";
  });
}

export async function reviewOwnerAccess(requestId: string, approve: boolean, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("admin");
    const decisionReason = need(fd, "reason", "a decision note");
    const db = getFirebaseDb();
    const requestRef = db.collection("owner_access_requests").doc(requestId);
    const initial = await requestRef.get();
    if (!initial.exists) throw new Error("This request has already been reviewed.");
    const profileRef = db.collection("profiles").doc(String(initial.get("profile_id")));
    const reviewedAt = new Date();
    let profileId = "";
    let departmentId = "";
    let name = "User";
    await db.runTransaction(async (tx) => {
      const [request, profile] = await Promise.all([tx.get(requestRef), tx.get(profileRef)]);
      if (!request.exists || request.get("status") !== "PENDING" || !profile.exists) throw new Error("This request has already been reviewed.");
      if (approve && (profile.get("role") !== "user" || profile.get("org_kind") !== "HOST")) throw new Error("This account is no longer eligible for host owner access.");
      profileId = profile.id;
      departmentId = String(request.get("department_id"));
      name = String(profile.get("full_name"));
      if (approve) tx.update(profileRef, { role: "owner", department_id: departmentId });
      tx.update(requestRef, { status: approve ? "APPROVED" : "REJECTED", reviewed_by: actor.id, reviewed_at: reviewedAt, decision_reason: decisionReason });
    });
    await audit(null, actor, approve ? "owner_access.approved" : "owner_access.rejected", "owner_access_request", requestId, decisionReason, { profile_id: profileId, department_id: departmentId });
    await notify(null, profileId, approve ? "Owner access approved" : "Owner access request reviewed", approve ? `You can now list resources for the approved department. ${decisionReason}` : decisionReason, approve ? "/resources/new" : "/owner-access");
    revalidatePath("/admin");
    revalidatePath("/owner-access");
    return approve ? `${name}'s owner access approved.` : "Owner access request declined.";
  });
}
