import postgres from "postgres";

// One pool per server instance. prepare:false keeps it compatible with Supabase's transaction pooler too;
// idle/lifetime limits recycle sockets so a dead pooler connection can never freeze the app.
const g = globalThis as unknown as { sql?: postgres.Sql };
export const sql = (g.sql ??= postgres(process.env.DATABASE_URL!, {
  prepare: false, max: 5, idle_timeout: 20, max_lifetime: 60 * 10, connect_timeout: 10,
}));

export type Tx = postgres.TransactionSql | postgres.Sql;
