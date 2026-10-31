import postgres from "postgres";

// One pool per server instance. prepare:false works with PostgreSQL transaction
// poolers; idle/lifetime limits recycle stale pooler connections.
const g = globalThis as unknown as { sql?: postgres.Sql };
const options = { prepare: false, max: 5, idle_timeout: 20, max_lifetime: 60 * 10, connect_timeout: 10 } as const;

const databaseUrlHint = process.env.NODE_ENV === "production"
  ? "Set DATABASE_URL in the hosting service's environment settings, then redeploy or restart the service."
  : "Copy .env.example to .env.local, set DATABASE_URL to a real PostgreSQL connection URL, then restart the Next.js server.";

function unavailable(message: string): postgres.Sql {
  const fail = () => { throw new Error(message); };
  return new Proxy(fail, {
    apply: fail,
    get: fail,
  }) as unknown as postgres.Sql;
}

function createClient(): postgres.Sql {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return unavailable(`DATABASE_URL is not configured. ${databaseUrlHint}`);
  }

  try {
    const url = new URL(connectionString);
    if (!(url.protocol === "postgres:" || url.protocol === "postgresql:") || !url.hostname) {
      return unavailable(`DATABASE_URL must be a PostgreSQL connection URL with a host. ${databaseUrlHint}`);
    }
  } catch {
    return unavailable(`DATABASE_URL must be a valid PostgreSQL connection URL. ${databaseUrlHint}`);
  }

  return postgres(connectionString, options);
}

export const sql = (g.sql ??= createClient());

export type Tx = postgres.TransactionSql | postgres.Sql;
