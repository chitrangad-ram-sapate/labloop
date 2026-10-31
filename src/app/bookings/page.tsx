import Link from "next/link";
import { Status } from "@/components/bits";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import { fmt, fmtTime } from "@/lib/format";

export default async function MyBookings({ searchParams }: PageProps<"/bookings">) {
  const actor = await requireActor();
  const query = await searchParams;
  const requestId = typeof query.request === "string" && /^[0-9a-f-]{36}$/i.test(query.request) ? query.request : null;
  const rows = requestId
    ? await sql`
        select b.id, b.status, b.start_at, b.end_at, b.decision_reason, b.offer_expires_at, b.quantity, b.request_group_id, r.name
        from bookings b join resources r on r.id = b.resource_id
        where b.user_id = ${actor.id} and b.request_group_id = ${requestId}
        order by b.start_at`
    : await sql`
        select b.id, b.status, b.start_at, b.end_at, b.decision_reason, b.offer_expires_at, b.quantity, b.request_group_id, r.name
        from bookings b join resources r on r.id = b.resource_id where b.user_id = ${actor.id}
        order by (b.status in ('OFFERED','OVERDUE','IN_USE','APPROVED','PENDING_REVIEW','WAITLISTED')) desc, b.start_at desc`;
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
