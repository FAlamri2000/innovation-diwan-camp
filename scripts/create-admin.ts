/**
 * Break-glass: create an admin, or turn an existing user back into an active
 * admin, with a fresh one-time password printed once.
 *
 *   node scripts/create-admin.ts someone@example.com "Display name"
 *
 * Run inside the app container (it reads DATABASE_URL). All of that user's
 * sessions are signed out.
 */
import pg from "pg";
import { generatePassword, hashPassword } from "../src/lib/auth/password.server.ts";

const [emailArg, ...nameParts] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error('usage: node scripts/create-admin.ts <email> ["Display name"]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const password = generatePassword();
  const name = nameParts.join(" ").trim() || email;
  const { rows } = await client.query<{ id: string }>(
    `insert into public.app_users (email, name, role, password_hash, must_change_password)
     values ($1, $2, 'admin', $3, true)
     on conflict ((lower(email))) do update
       set role = 'admin', active = true, password_hash = excluded.password_hash,
           must_change_password = true, updated_at = now()
     returning id`,
    [email, name, await hashPassword(password)],
  );
  await client.query("delete from public.app_sessions where user_id = $1", [rows[0].id]);
  console.log(`Admin ready: ${email}`);
  console.log(`One-time password: ${password}`);
  console.log("They must replace it at first sign-in.");
} finally {
  await client.end();
}
