import postgres from "postgres";

// One pool per server instance; prepare:false because Supabase's transaction pooler can't keep prepared statements.
const g = globalThis as unknown as { sql?: postgres.Sql };
export const sql = (g.sql ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 5 }));

export type Tx = postgres.TransactionSql | postgres.Sql;
