import { tick } from "@/lib/tick";

// Called every few minutes by .github/workflows/tick.yml (and by Vercel Cron if configured).
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("Unauthorized", { status: 401 });
  return Response.json(await tick());
}
