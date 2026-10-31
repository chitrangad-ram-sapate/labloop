"use server";

import { redirect } from "next/navigation";
import { attempt, need, photo, str, type ActionResult } from "@/lib/action";
import { canManage, requireActor } from "@/lib/auth";
import { getResource } from "@/lib/booking";
import { sql } from "@/lib/db";
import { audit } from "@/lib/log";

const num = (fd: FormData, k: string, min: number, max: number) => {
  const n = Number(str(fd, k));
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${k.replace(/_/g, " ")} must be a whole number between ${min} and ${max}.`);
  return n;
};

export async function saveResource(id: string | null, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "admin");
    const existing = id ? await getResource(id) : null;
    if (id && (!existing || !canManage(actor, existing.department_id))) throw new Error("You can only edit your department's listings.");
    if (!id && !actor.department_id) throw new Error("Only department owners can list resources.");
    const open_from = need(fd, "open_from", "an opening time");
    const open_to = need(fd, "open_to", "a closing time");
    if (open_to <= open_from) throw new Error("Closing time must be after opening time.");
    const data = {
      name: need(fd, "name", "a name"),
      category: need(fd, "category"),
      description: str(fd, "description"),
      location: need(fd, "location", "a location"),
      usage_rules: str(fd, "usage_rules"),
      checklist: str(fd, "checklist").split("\n").map((s) => s.trim()).filter(Boolean),
      open_from, open_to,
      max_duration_min: num(fd, "max_duration_min", 15, 720),
      turnaround_min: num(fd, "turnaround_min", 0, 120),
      advance_days: num(fd, "advance_days", 1, 60),
      units_available: num(fd, "units_available", 1, 1000),
      max_hours_week: num(fd, "max_hours_week", 1, 80),
      cooldown_hours: num(fd, "cooldown_hours", 0, 168),
      external_max_pct: num(fd, "external_max_pct", 0, 100),
      requires_supervision: fd.get("requires_supervision") === "on",
      supervise_externals: fd.get("supervise_externals") === "on",
      open_to_externals: fd.get("open_to_externals") === "on",
      high_demand: fd.get("high_demand") === "on",
      deposit_note: str(fd, "deposit_note") || null,
      status: str(fd, "status") || "ACTIVE",
      ...(photo(fd) ? { photo: photo(fd) } : {}),
    };
    const creds = fd.getAll("credentials").map(String);

    const rid = await sql.begin(async (tx) => {
      const [row] = id
        ? await tx`update resources set ${tx(data as never)} where id = ${id} returning id`
        : await tx`insert into resources ${tx({ ...data, department_id: actor.department_id, owner_id: actor.id } as never)} returning id`;
      await tx`delete from resource_requirements where resource_id = ${row.id}`;
      for (const c of creds) await tx`insert into resource_requirements (resource_id, credential_type_id) values (${row.id}, ${c})`;
      await audit(tx, actor, id ? "resource.updated" : "resource.listed", "resource", row.id, id ? "Listing updated" : "New resource listed",
        { name: data.name, status: data.status, requirements: creds.length });
      return row.id as string;
    });
    redirect(`/resources/${rid}`);
  });
}
