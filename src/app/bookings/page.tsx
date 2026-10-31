import Link from "next/link";
import { Status } from "@/components/bits";
import { requireActor } from "@/lib/auth";
import { fromFirestore, getFirebaseDb } from "@/lib/firebase";
import { fmt, fmtTime } from "@/lib/format";

export default async function MyBookings({ searchParams }: PageProps<"/bookings">) {
  const actor = await requireActor();
  const query = await searchParams;
  const requestId = typeof query.request === "string" && /^[0-9a-f-]{36}$/i.test(query.request) ? query.request : null;
  const snapshot = await getFirebaseDb().collection("bookings").where("user_id", "==", actor.id).get();
  const rows = (await Promise.all(snapshot.docs.map(async (doc) => {
    const booking = fromFirestore(doc.id, doc.data());
    if (requestId && booking.request_group_id !== requestId) return null;
    const resource = await getFirebaseDb().collection("resources").doc(String(booking.resource_id)).get();
    return { ...booking, name: resource.get("name") ?? "Unavailable resource" };
  }))).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const activeFirst = new Set(["OFFERED", "OVERDUE", "IN_USE", "APPROVED", "PENDING_REVIEW", "WAITLISTED"]);
  rows.sort((a, b) => requestId
    ? new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    : Number(activeFirst.has(String(b.status))) - Number(activeFirst.has(String(a.status))) || new Date(b.start_at).getTime() - new Date(a.start_at).getTime());
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My bookings</h1>
      {requestId && rows.length > 0 && <p role="status" className="rounded-lg border p-3 text-sm">Combined cart request submitted. Each resource item is listed below and will be reviewed by its department.</p>}
      {rows.length === 0 && <p>No bookings yet. <Link href="/" className="underline">Find a resource</Link>.</p>}
      <ul className="divide-y rounded-lg border">
        {rows.map((b) => (
          <li key={b.id}>
            <Link href={`/bookings/${b.id}`} className="flex flex-wrap items-center gap-3 p-3 hover:bg-muted">
              <Status s={b.status} />
              <span className="font-medium">{b.name}</span>
              <span className="text-sm">× {b.quantity ?? 1} unit{Number(b.quantity ?? 1) === 1 ? "" : "s"}</span>
              {b.request_group_id && <span className="rounded-full border px-2 py-0.5 text-xs">Combined request</span>}
              <span className="text-sm text-muted-foreground">{fmt(b.start_at)}–{fmtTime(b.end_at)}</span>
              {b.status === "OFFERED" && <span className="text-sm font-semibold">Accept before {fmtTime(b.offer_expires_at)}</span>}
              {b.decision_reason && <span className="w-full text-sm text-muted-foreground">Why: {b.decision_reason}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
