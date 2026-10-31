import { ResourceForm } from "@/components/resource-form";
import { requireActor } from "@/lib/auth";
import { getFirebaseDb } from "@/lib/firebase";

export default async function NewResource() {
  const actor = await requireActor("owner", "admin");
  const db = getFirebaseDb();
  const [snapshot, departmentSnapshot] = await Promise.all([
    db.collection("credential_types").get(), actor.role === "admin" ? db.collection("departments").get() : Promise.resolve(null),
  ]);
  const credentials = snapshot.docs.map((doc) => ({ id: doc.id, name: String(doc.get("name")) })).sort((a, b) => a.name.localeCompare(b.name));
  const departments = departmentSnapshot?.docs.map((doc) => ({ id: doc.id, name: String(doc.get("name")) })) ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">List a resource</h1>
      <ResourceForm credentials={credentials} selected={[]} departments={departments} allowDepartment={actor.role === "admin"} />
    </div>
  );
}
