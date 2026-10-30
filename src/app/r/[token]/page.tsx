import { notFound, redirect } from "next/navigation";
import { canManage, requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";

/** Target of the QR code stuck on each resource: jumps straight to the booking to check out or return. */
export default async function Scan({ params }: PageProps<"/r/[token]">) {
  const actor = await requireActor();
  const [r] = await sql`select id, department_id from resources where qr_token = ${(await params).token}`;
  if (!r) notFound();
  const staff = canManage(actor, r.department_id);
  const [b] = await sql`select id from bookings where resource_id = ${r.id} and status in ('APPROVED','IN_USE','OVERDUE','RETURNED')
    and (${staff} or user_id = ${actor.id}) order by abs(extract(epoch from start_at - now())) limit 1`;
  redirect(b ? `/bookings/${b.id}` : `/resources/${r.id}`);
}
