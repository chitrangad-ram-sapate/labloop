import { notFound } from "next/navigation";
import { ResourceForm } from "@/components/resource-form";
import { canManage, requireActor } from "@/lib/auth";
import { getResource } from "@/lib/booking";
import { sql } from "@/lib/db";

export default async function EditResource({ params }: PageProps<"/resources/[id]/edit">) {
  const actor = await requireActor("owner", "admin");
  const r = await getResource((await params).id);
  if (!r || !canManage(actor, r.department_id)) notFound();
  const credentials = await sql<{ id: string; name: string }[]>`select id, name from credential_types order by name`;
  const selected = (await sql`select credential_type_id from resource_requirements where resource_id = ${r.id}`).map((x) => x.credential_type_id as string);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Edit {r.name}</h1>
      <ResourceForm r={r} credentials={credentials} selected={selected} />
    </div>
  );
}
