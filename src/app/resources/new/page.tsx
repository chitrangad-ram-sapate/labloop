import { ResourceForm } from "@/components/resource-form";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";

export default async function NewResource() {
  await requireActor("owner", "admin");
  const credentials = await sql<{ id: string; name: string }[]>`select id, name from credential_types order by name`;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">List a resource</h1>
      <ResourceForm credentials={credentials} selected={[]} />
    </div>
  );
}
