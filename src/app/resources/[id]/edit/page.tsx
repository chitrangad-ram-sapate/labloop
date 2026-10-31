import { notFound } from "next/navigation";
import { ResourceForm } from "@/components/resource-form";
import { canManage, requireActor } from "@/lib/auth";
import { getResource } from "@/lib/booking";
import { getFirebaseDb } from "@/lib/firebase";

export default async function EditResource({ params }: PageProps<"/resources/[id]/edit">) {
  const actor = await requireActor("owner", "admin");
  const r = await getResource((await params).id);
  if (!r || !canManage(actor, r.department_id)) notFound();
  const [credentialSnapshot, requirementSnapshot] = await Promise.all([
    getFirebaseDb().collection("credential_types").get(),
    getFirebaseDb().collection("resource_requirements").where("resource_id", "==", r.id).get(),
  ]);
  const credentials = credentialSnapshot.docs.map((doc) => ({ id: doc.id, name: String(doc.get("name")) })).sort((a, b) => a.name.localeCompare(b.name));
  const selected = requirementSnapshot.docs.map((doc) => String(doc.get("credential_type_id")));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Edit {r.name}</h1>
      <ResourceForm r={r} credentials={credentials} selected={selected} />
    </div>
  );
}
