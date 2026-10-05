/**
 * Camp data access over the app's one pool (DATABASE_URL). The database is
 * never reachable from the browser: every caller is a server function that
 * has already passed requireViewer / requireEditor / requireAdmin, or the
 * sync worker.
 */
import type { PoolClient, QueryResultRow } from "pg";
import { databaseQuery, getDatabasePool } from "@/lib/database.server";
import { resolveCampSettings, type CampSettings } from "./settings";

export type Db = Pick<PoolClient, "query">;

export async function q<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const result = await databaseQuery<Row>(text, values);
  return result.rows;
}

export async function tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function loadSettings(db?: Db): Promise<CampSettings> {
  const sql = "select settings from public.camp_settings where id";
  const rows = db
    ? (await db.query<{ settings: unknown }>(sql)).rows
    : await q<{ settings: unknown }>(sql);
  return resolveCampSettings(rows[0]?.settings);
}

export async function getState<T>(key: string, db?: Db): Promise<T | null> {
  const sql = "select value from public.camp_sync_state where key = $1";
  const rows = db
    ? (await db.query<{ value: T }>(sql, [key])).rows
    : await q<{ value: T }>(sql, [key]);
  return rows[0]?.value ?? null;
}

export async function setState(key: string, value: unknown, db?: Db): Promise<void> {
  const sql = `insert into public.camp_sync_state (key, value, updated_at) values ($1, $2::jsonb, now())
               on conflict (key) do update set value = excluded.value, updated_at = now()`;
  const params = [key, JSON.stringify(value)];
  if (db) await db.query(sql, params);
  else await q(sql, params);
}

/**
 * A time-boxed lease: at most one sync tick runs at a time across processes
 * and schedulers. Expires on its own if a holder dies mid-tick.
 */
export async function acquireLease(
  name: string,
  holder: string,
  seconds: number,
): Promise<boolean> {
  const rows = await q<{ holder: string }>(
    `insert into public.camp_leases (name, holder, expires_at)
       values ($1, $2, now() + make_interval(secs => $3))
     on conflict (name) do update
       set holder = excluded.holder, expires_at = excluded.expires_at
       where camp_leases.expires_at < now() or camp_leases.holder = excluded.holder
     returning holder`,
    [name, holder, seconds],
  );
  return rows[0]?.holder === holder;
}

export async function releaseLease(name: string, holder: string): Promise<void> {
  await q("delete from public.camp_leases where name = $1 and holder = $2", [name, holder]);
}

export async function audit(
  actor: string | null,
  action: string,
  targets: readonly string[],
  detail: Record<string, unknown> = {},
): Promise<void> {
  await q(
    "insert into public.camp_audit (actor, action, targets, detail) values ($1, $2, $3, $4::jsonb)",
    [actor, action, targets, JSON.stringify(detail)],
  );
}

export const toIso = (unixSeconds: number | null | undefined): string | null =>
  typeof unixSeconds === "number" && unixSeconds > 0
    ? new Date(unixSeconds * 1000).toISOString()
    : null;
