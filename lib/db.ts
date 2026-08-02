import { Pool, type QueryResultRow } from "pg";

const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/crewmade_nexus",
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.pgPool = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}
