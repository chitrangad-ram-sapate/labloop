import Link from "next/link";
import { redirect } from "next/navigation";
import { requestOwnerAccess } from "@/app/actions/owner-access";
import { ActionForm } from "@/components/action-form";
import { getActor } from "@/lib/auth";
import { sql } from "@/lib/db";

export default async function OwnerAccessPage() {
  const actor = await getActor();
  if (!actor) redirect("/login?redirectTo=%2Fowner-access");
  if (actor.role === "owner") redirect("/resources/new");
  if (actor.role === "manager") redirect("/manage");
  if (actor.role === "admin") redirect("/admin");

  const [organization] = await sql`select kind from organizations where id = ${actor.org_id}`;
  if (actor.role === "external" || organization?.kind !== "HOST") {
    return (
      <div className="mx-auto max-w-2xl space-y-5 rounded-2xl border bg-white p-6 shadow-sm sm:p-9">
        <p className="market-eyebrow">RESOURCE OWNERS</p>
        <h1 className="text-3xl font-semibold tracking-tight">Owner access is for host campus staff</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          Partner college and startup accounts can discover resources and request access, but they cannot own campus listings. Your current account remains able to browse according to its existing access rules.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link className="button-primary" href="/">Explore resources</Link>
          <Link className="button-text self-center" href="/me">View your account</Link>
        </div>
      </div>
    );
  }

  const [latest] = await sql`
    select r.status, r.reason, r.decision_reason, r.created_at, d.name as department
    from owner_access_requests r join departments d on d.id = r.department_id
    where r.profile_id = ${actor.id} order by r.created_at desc limit 1`;
  const departments = await sql`select id, name from departments order by name`;

  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-2xl border bg-white p-6 shadow-sm sm:p-9">
      <div className="space-y-2">
        <p className="market-eyebrow">FOR HOST CAMPUS STAFF</p>
        <h1 className="text-3xl font-semibold tracking-tight">Request resource owner access</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          Tell an administrator which department you represent and why you need to manage shared listings. An administrator reviews the request; submitting it does not grant owner permissions.
        </p>
      </div>

      {latest?.status === "PENDING" ? (
        <div role="status" className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <h2 className="font-semibold">Your request is awaiting review</h2>
          <p>Department: {latest.department}</p>
          <p>{latest.reason}</p>
        </div>
      ) : (
        <>
          {latest?.status === "REJECTED" && (
            <div role="status" className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <h2 className="font-semibold">Your previous request was not approved</h2>
              <p>{latest.decision_reason || "No decision note was provided."}</p>
              <p>You can submit a new request if your circumstances have changed.</p>
            </div>
          )}
          <ActionForm action={requestOwnerAccess} submit="Send for administrator review" className="space-y-4">
            <label className="grid gap-2 text-sm font-medium">
              Department
              <select name="department_id" required defaultValue="" className="min-h-11 rounded-lg border bg-background px-3">
                <option value="" disabled>Choose your department</option>
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Your role and why you need access
              <textarea name="reason" required minLength={20} maxLength={1000} rows={5} className="rounded-lg border bg-background px-3 py-2 font-normal leading-6" placeholder="Describe your connection to the department and the resources you will manage." />
            </label>
          </ActionForm>
        </>
      )}
      <p className="text-xs text-muted-foreground">Signed in as {actor.full_name} · {actor.org_name}</p>
    </div>
  );
}
