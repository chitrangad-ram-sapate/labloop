import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";

export default async function Poster({ params }: PageProps<"/r/[token]/poster">) {
  await requireActor("owner", "manager", "admin");
  const token = (await params).token;
  const [r] = await sql`select name, location from resources where qr_token = ${token}`;
  if (!r) notFound();
  const h = await headers();
  const url = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}/r/${token}`;
  const qr = await QRCode.toDataURL(url, { width: 360, margin: 1 });
  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <h1 className="text-2xl font-bold">{r.name}</h1>
      <p>{r.location}</p>
      <img src={qr} alt={`QR code linking to ${url}`} className="mx-auto" />
      <p className="text-sm">Scan to check out or return this item and record its condition.</p>
      <p className="font-mono text-xs text-muted-foreground">{url}</p>
    </div>
  );
}
