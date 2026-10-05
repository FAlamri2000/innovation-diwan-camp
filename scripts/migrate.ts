/**
 * Startup migrator. Applies db/migrations/*.sql in name order, each in its own
 * transaction, recorded in public.app_migrations with a checksum. A file that
 * changed after it was applied stops the start: fix forward with a new file.
 *
 * Then, if ADMIN_EMAIL and ADMIN_PASSWORD are set and there is no active
 * admin yet, creates that admin — the way into a fresh deployment.
 *
 * Plain node (type stripping); runs before the server in scripts/start.sh.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { hashPassword } from "../src/lib/auth/password.server.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const LOCK_KEY = 727_001;
const client = new pg.Client({ connectionString: url, application_name: "diwan-camp-migrate" });
await client.connect();
try {
  await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
  await client.query(`create table if not exists public.app_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Map(
    (
      await client.query<{ name: string; checksum: string }>(
        "select name, checksum from public.app_migrations",
      )
    ).rows.map((r) => [r.name, r.checksum]),
  );

  const dir = new URL("../db/migrations/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    const sql = await readFile(new URL(file, dir), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = applied.get(file);
    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `${file} changed after it was applied (checksum drift). Add a new migration instead.`,
        );
      }
      continue;
    }
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.app_migrations (name, checksum) values ($1, $2)", [
        file,
        checksum,
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    count++;
    console.log(`[migrate] applied ${file}`);
  }
  console.log(`[migrate] ${count ? `${count} applied` : "up to date"} (${files.length} files)`);

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const admins = await client.query<{ n: number }>(
      "select count(*)::int as n from public.app_users where role = 'admin' and active",
    );
    if (admins.rows[0].n === 0) {
      if (password.length < 10) throw new Error("ADMIN_PASSWORD must be at least 10 characters");
      await client.query(
        `insert into public.app_users (email, name, role, password_hash, must_change_password)
         values ($1, $2, 'admin', $3, true)
         on conflict ((lower(email))) do update
           set role = 'admin', active = true, password_hash = excluded.password_hash,
               must_change_password = true, updated_at = now()`,
        [email, process.env.ADMIN_NAME?.trim() || email, await hashPassword(password)],
      );
      console.log(`[migrate] first admin ready: ${email} (must change the password at sign-in)`);
    }
  }
} finally {
  await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
  await client.end();
}
