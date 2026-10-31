import { tick } from "@/lib/tick";

// Called every ten minutes by the configured database scheduler and by staff-triggered tick actions.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "Cron authentication is not configured." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  return Response.json(await tick());
}
