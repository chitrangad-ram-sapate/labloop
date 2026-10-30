// Usage: node --env-file=.env.local --import tsx scripts/ai-smoke.mts  (checks the AI provider end to end)
import { findResources, summariseIncident } from "../src/lib/ai";
import { sql } from "../src/lib/db";

const catalog = await sql`select id, name, category, description, location, null as requires from resources`;
const t = Date.now();
const f = await findResources("I need to cut acrylic for a drone frame by Friday", catalog as never);
console.log("finder", Date.now() - t, "ms", f?.matches.map((m) => `${catalog.find((c) => c.id === m.id)?.name}: ${m.why}`));
console.log("incident", await summariseIncident("Resource: Digital Oscilloscope\nType: DAMAGE LOW\nReport: one probe tip bent when cable snagged"));
await sql.end();
