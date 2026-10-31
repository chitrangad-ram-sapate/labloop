"use server";

import { revalidatePath } from "next/cache";
import { attempt, need, type ActionResult } from "@/lib/action";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import { audit, notify } from "@/lib/log";

export async function requestOwnerAccess(_: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("user");
    const departmentId = need(fd, "department_id", "a department");
    const reason = need(fd, "reason", "a short explanation");
    if (reason.length < 20 || reason.length > 1000) throw new Error("Please write 20 to 1,000 characters about your connection to this department.");

    try {
      await sql.begin(async (tx) => {
        const [profile] = await tx`select p.role, o.kind from profiles p join organizations o on o.id = p.org_id where p.id = ${actor.id} for update of p`;
        if (!profile || profile.role !== "user" || profile.kind !== "HOST") {
          throw new Error("Owner access requests are available to host-institution users only.");
        }
        const [department] = await tx`select id from departments where id = ${departmentId}`;
        if (!department) throw new Error("Choose a department from the list.");
        const [request] = await tx`insert into owner_access_requests (profile_id, department_id, reason)
          values (${actor.id}, ${departmentId}, ${reason}) returning id`;
        await audit(tx, actor, "owner_access.requested", "owner_access_request", request.id, reason, { department_id: departmentId });
        await tx`insert into notifications (user_id, title, body, link)
          select id, 'Owner access request to review', ${actor.full_name}, '/admin' from profiles where role = 'admin'`;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new Error("You already have a pending owner access request.");
      throw error;
    }
    revalidatePath("/owner-access");
    return "Your request was sent to a LabLoop administrator for review.";
  });
}

export async function reviewOwnerAccess(requestId: string, approve: boolean, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("admin");
    const decisionReason = need(fd, "reason", "a decision note");
    await sql.begin(async (tx) => {
      const [request] = await tx`
        select r.profile_id, r.department_id, p.role, o.kind, p.full_name
        from owner_access_requests r
        join profiles p on p.id = r.profile_id
        join organizations o on o.id = p.org_id
        where r.id = ${requestId} and r.status = 'PENDING'
        for update of r, p`;
      if (!request) throw new Error("This request has already been reviewed.");
      if (approve && (request.role !== "user" || request.kind !== "HOST")) {
        throw new Error("This account is no longer eligible for host owner access.");
      }

      if (approve) {
        await tx`update profiles set role = 'owner', department_id = ${request.department_id} where id = ${request.profile_id}`;
      }
      await tx`update owner_access_requests
        set status = ${approve ? "APPROVED" : "REJECTED"}, reviewed_by = ${actor.id}, reviewed_at = now(), decision_reason = ${decisionReason}
        where id = ${requestId}`;
      await audit(tx, actor, approve ? "owner_access.approved" : "owner_access.rejected", "owner_access_request", requestId, decisionReason,
        { profile_id: request.profile_id, department_id: request.department_id });
      await notify(tx, request.profile_id,
        approve ? "Owner access approved" : "Owner access request reviewed",
        approve ? `You can now list resources for the approved department. ${decisionReason}` : decisionReason,
        approve ? "/resources/new" : "/owner-access");
    });
    revalidatePath("/admin");
    revalidatePath("/owner-access");
    return approve ? "Owner access approved." : "Owner access request declined.";
  });
}
