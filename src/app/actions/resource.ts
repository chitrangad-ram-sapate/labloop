"use server";

import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { attempt, need, photo, str, type ActionResult } from "@/lib/action";
import { canManage, requireActor } from "@/lib/auth";
import { getResource } from "@/lib/booking";
import { getFirebaseDb, newRecordId } from "@/lib/firebase";
import { audit } from "@/lib/log";

const num = (fd: FormData, k: string, min: number, max: number) => {
  const n = Number(str(fd, k));
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${k.replace(/_/g, " ")} must be a whole number between ${min} and ${max}.`);
  return n;
};
const asDate = (value: unknown) => value instanceof Date ? value : new Date((value as { toDate?: () => Date })?.toDate?.() ?? value as string | number);

function peakCommitted(rows: Array<{ start: Date; end: Date; quantity: number }>) {
  return Math.max(0, ...rows.map((row) => row.start).map((time) => rows.filter((other) => other.start <= time && other.end > time).reduce((sum, other) => sum + other.quantity, 0)));
}

export async function saveResource(id: string | null, _: ActionResult, fd: FormData) {
  return attempt(async () => {
    const actor = await requireActor("owner", "admin");
    const existing = id ? await getResource(id) : null;
    if (id && (!existing || !canManage(actor, existing.department_id))) throw new Error("You can only edit your department's listings.");
    if (!id && actor.role !== "admin" && !actor.department_id) throw new Error("Only department owners can list resources.");
    const open_from = need(fd, "open_from", "an opening time");
    const open_to = need(fd, "open_to", "a closing time");
    if (open_to <= open_from) throw new Error("Closing time must be after opening time.");
    const category = need(fd, "category");
    if (!["space", "equipment", "computing", "media"].includes(category)) throw new Error("Choose a valid resource category.");
    const status = str(fd, "status") || "ACTIVE";
    if (!["ACTIVE", "MAINTENANCE", "RETIRED"].includes(status)) throw new Error("Choose a valid resource status.");
    const uploadedPhoto = photo(fd);
    const data = {
      name: need(fd, "name", "a name"), category,
      description: str(fd, "description"), location: need(fd, "location", "a location"),
      usage_rules: str(fd, "usage_rules"), checklist: str(fd, "checklist").split("\n").map((s) => s.trim()).filter(Boolean),
      open_from, open_to, max_duration_min: num(fd, "max_duration_min", 15, 720),
      turnaround_min: num(fd, "turnaround_min", 0, 120), advance_days: num(fd, "advance_days", 1, 60),
      units_available: num(fd, "units_available", 1, 1000), max_hours_week: num(fd, "max_hours_week", 1, 80),
      cooldown_hours: num(fd, "cooldown_hours", 0, 168), external_max_pct: num(fd, "external_max_pct", 0, 100),
      requires_supervision: fd.get("requires_supervision") === "on", supervise_externals: fd.get("supervise_externals") === "on",
      open_to_externals: fd.get("open_to_externals") === "on", high_demand: fd.get("high_demand") === "on",
      deposit_note: str(fd, "deposit_note") || null, status,
      ...(uploadedPhoto ? { photo: uploadedPhoto } : {}),
    };
    const credentials = [...new Set(fd.getAll("credentials").map(String))];
    const db = getFirebaseDb();
    const resourceId = id ?? newRecordId();
    const resourceRef = db.collection("resources").doc(resourceId);
    const departmentId = existing?.department_id ?? (actor.role === "admin" ? need(fd, "department_id", "a department") : actor.department_id!);
    const departmentRef = db.collection("departments").doc(departmentId);
    const requirementQuery = db.collection("resource_requirements").where("resource_id", "==", resourceId);
    const credentialRefs = credentials.map((credentialId) => db.collection("credential_types").doc(credentialId));
    await db.runTransaction(async (tx) => {
      const [resourceSnap, requirementSnapshot, departmentSnapshot, ...credentialSnapshots] = await Promise.all([
        tx.get(resourceRef), tx.get(requirementQuery), tx.get(departmentRef), ...credentialRefs.map((ref) => tx.get(ref)),
      ]);
      if (id && !resourceSnap.exists) throw new Error("Resource no longer exists.");
      if (!departmentSnapshot.exists) throw new Error("The selected department does not exist.");
      if (credentialSnapshots.some((snapshot) => !snapshot.exists)) throw new Error("One selected training requirement is no longer available.");
      const oldUnits = Number(resourceSnap.get("units_available") ?? data.units_available);
      if (data.units_available < oldUnits) {
        const [bookingSnapshot, cartSnapshot] = await Promise.all([
          tx.get(db.collection("bookings").where("resource_id", "==", resourceId)),
          tx.get(db.collection("cart_items").where("resource_id", "==", resourceId)),
        ]);
        const occupied = [
          ...bookingSnapshot.docs.map((doc) => doc.data()).filter((row) => ["APPROVED", "OFFERED", "IN_USE", "OVERDUE"].includes(String(row.status)))
            .map((row) => ({ start: asDate(row.start_at), end: new Date(asDate(row.end_at).getTime() + data.turnaround_min * 60_000), quantity: Number(row.quantity ?? 1) })),
          ...cartSnapshot.docs.map((doc) => doc.data()).filter((row) => asDate(row.hold_expires_at) > new Date())
            .map((row) => ({ start: asDate(row.start_at), end: new Date(asDate(row.end_at).getTime() + data.turnaround_min * 60_000), quantity: Number(row.quantity ?? 1) })),
        ];
        if (peakCommitted(occupied) > data.units_available) throw new Error("Unit count cannot be reduced below the overlapping quantity already held by bookings or active carts.");
      }
      await audit(tx, actor, id ? "resource.updated" : "resource.listed", "resource", resourceId, id ? "Listing updated" : "New resource listed", { name: data.name, status: data.status, requirements: credentials.length });
      const resourceData = {
        ...data,
        department_id: departmentId,
        owner_id: existing?.owner_id ?? actor.id,
        qr_token: existing?.qr_token ?? randomBytes(18).toString("base64url"),
        availability_version: Number(resourceSnap.get("availability_version") ?? 0) + 1,
        created_at: resourceSnap.get("created_at") ?? new Date(),
      };
      tx.set(resourceRef, resourceData, { merge: true });
      requirementSnapshot.docs.forEach((doc) => tx.delete(doc.ref));
      credentials.forEach((credentialId) => {
        const ref = db.collection("resource_requirements").doc(`${resourceId}_${credentialId}`);
        tx.set(ref, { resource_id: resourceId, credential_type_id: credentialId });
      });
    });
    redirect(`/resources/${resourceId}`);
  });
}
