// Usage: npx tsx scripts/ai-smoke.mts (checks the AI provider end to end)
import { existsSync } from "node:fs";
import { findResources, summariseIncident } from "../src/lib/ai";
import { fromFirestore, getFirebaseDb } from "../src/lib/firebase";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const catalog = (await getFirebaseDb().collection("resources").get()).docs.map((doc) => fromFirestore(doc.id, doc.data()));
const t = Date.now();
const f = await findResources("I need to cut acrylic for a drone frame by Friday", catalog as never);
console.log("finder", Date.now() - t, "ms", f?.matches.map((m) => `${catalog.find((c) => c.id === m.id)?.name}: ${m.why}`));
console.log("incident", await summariseIncident("Resource: Digital Oscilloscope\nType: DAMAGE LOW\nReport: one probe tip bent when cable snagged"));
