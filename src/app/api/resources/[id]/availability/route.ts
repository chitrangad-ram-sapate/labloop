import { getActor } from "@/lib/auth";
import { getResourceAvailability } from "@/lib/booking";
import { istToDate } from "@/lib/format";

export async function GET(request: Request, { params }: RouteContext<"/api/resources/[id]/availability">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Resource not found." }, { status: 404 });
  const query = new URL(request.url).searchParams;
  const date = query.get("date") ?? "";
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to))
    return Response.json({ error: "Choose a valid date and time." }, { status: 400 });
  const start = istToDate(date, from);
  const end = istToDate(date, to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
    return Response.json({ error: "End time must be after start time." }, { status: 400 });
  try {
    const actor = await getActor();
    const stock = await getResourceAvailability(id, start, end, actor?.id ?? null);
    if (!stock) return Response.json({ error: "Resource not found." }, { status: 404 });
    return Response.json(stock, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Live availability is temporarily unavailable. Please refresh and try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
