import Link from "next/link";
import { Status } from "@/components/bits";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import { fmt, fmtTime } from "@/lib/format";

export default async function MyBookings() {
  const actor = await requireActor();
  const rows = await sql`
    select b.id, b.status, b.start_at, b.end_at, b.decision_reason, b.offer_expires_at, r.name
    from bookings b join resources r on r.id = b.resource_id where b.user_id = ${actor.id}
    order by (b.status in ('OFFERED','OVERDUE','IN_USE','APPROVED','PENDING_REVIEW','WAITLISTED')) desc, b.start_at desc`;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My bookings</h1>
      {rows.length === 0 && <p>No bookings yet. <Link href="/" className="underline">Find a resource</Link>.</p>}
      <ul className="divide-y rounded-lg border">
        {rows.map((b) => (
          <li key={b.id}>
            <Link href={`/bookings/${b.id}`} className="flex flex-wrap items-center gap-3 p-3 hover:bg-muted">
              <Status s={b.status} />
              <span className="font-medium">{b.name}</span>
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
