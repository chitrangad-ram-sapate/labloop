import { notFound, redirect } from "next/navigation";
import { canManage, requireActor } from "@/lib/auth";
import { getFirebaseDb, fromFirestore } from "@/lib/firebase";

/** Target of the QR code stuck on each resource: jumps straight to the booking to check out or return. */
export default async function Scan({ params }: PageProps<"/r/[token]">) {
  const actor = await requireActor();
  const resources = await getFirebaseDb().collection("resources").where("qr_token", "==", (await params).token).limit(1).get();
  const resourceDoc = resources.docs[0];
  if (!resourceDoc) notFound();
  const r = fromFirestore(resourceDoc.id, resourceDoc.data());
  const staff = canManage(actor, r.department_id);
  const bookings = await getFirebaseDb().collection("bookings").where("resource_id", "==", r.id).get();
  const eligible = bookings.docs.map((doc) => fromFirestore(doc.id, doc.data())).filter((booking) =>
    ["APPROVED", "IN_USE", "OVERDUE", "RETURNED"].includes(String(booking.status)) && (staff || booking.user_id === actor.id));
  eligible.sort((a, b) => Math.abs(new Date(a.start_at).getTime() - Date.now()) - Math.abs(new Date(b.start_at).getTime() - Date.now()));
  redirect(eligible[0] ? `/bookings/${eligible[0].id}` : `/resources/${r.id}`);
}
