import { existsSync } from "node:fs";
import postgres from "postgres";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

if (!process.env.SESSION_SECRET?.trim()) {
  console.error("SESSION_SECRET is missing. Database queries may work, but sign-in cannot create a session until it is set.");
  process.exitCode = 1;
}

const requiredTables = [
  "organizations",
  "departments",
  "profiles",
  "credential_types",
  "user_credentials",
  "resources",
  "resource_requirements",
  "bookings",
  "condition_reports",
  "incidents",
  "notifications",
  "audit_log",
  "owner_access_requests",
  "booking_requests",
  "booking_items",
  "cart_items",
  "complaint_tickets",
  "complaint_messages",
];

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL is missing. Copy .env.example to .env.local and set a real PostgreSQL connection URL.");
  process.exit(1);
}

try {
  const url = new URL(connectionString);
  if (!(url.protocol === "postgres:" || url.protocol === "postgresql:") || !url.hostname) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql:// and include a host.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "DATABASE_URL is not a valid PostgreSQL URL.");
  process.exit(1);
}

const sql = postgres(connectionString, {
  prepare: false,
  max: 1,
  connect_timeout: 8,
  idle_timeout: 1,
});

try {
  await sql`select 1`;
  const rows = await sql<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `;
  const existing = new Set(rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !existing.has(table));

  console.log("PostgreSQL connection succeeded. Connection details were not printed.");
  if (missing.length) {
    console.error(`LabLoop schema is incomplete. Missing tables: ${missing.join(", ")}. Apply the required SQL migrations once, in numeric order.`);
    process.exitCode = 1;
  } else {
    console.log("All required LabLoop tables are present.");
  }
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
  console.error(`PostgreSQL connection failed${code ? ` (${code})` : ""}. Check DATABASE_URL, the database server, credentials, TLS, and network access. The URL was not printed.`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
