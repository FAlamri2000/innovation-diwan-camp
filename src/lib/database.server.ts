/**
 * The one PostgreSQL pool (DATABASE_URL). Every read and write in the app goes
 * through it, from server code only — the database is never exposed to the
 * browser, so authorization lives in the server functions (lib/auth/guards).
 */
import { Pool, type QueryResult, type QueryResultRow } from "pg";

type PoolGlobal = typeof globalThis & { __DIWAN_CAMP_POOL__?: Pool };

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

export function getDatabasePool(): Pool {
  const global = globalThis as PoolGlobal;
  if (!global.__DIWAN_CAMP_POOL__) {
    // TLS follows the URL (?sslmode=…) — pg parses it from the string.
    global.__DIWAN_CAMP_POOL__ = new Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.PG_POOL_SIZE ?? 8),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "innovation-diwan-camp",
      allowExitOnIdle: true,
    });
  }
  return global.__DIWAN_CAMP_POOL__;
}

export function databaseQuery<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  return getDatabasePool().query<Row>(text, values);
}
