// Usage: npm run seed   (reads DATABASE_URL from .env.local)
import { sql } from "../src/lib/db";
import { seed } from "../src/lib/seed";

await seed(sql);
console.log("Demo data loaded.");
await sql.end();
