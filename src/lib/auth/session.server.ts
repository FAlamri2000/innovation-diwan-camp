/**
 * Sessions: a random 32-byte token in an httpOnly cookie, its SHA-256 in
 * app_sessions. Sliding expiry — a session seen within the window is extended,
 * so an operator active every day is never signed out mid-camp.
 */
import { createHash, randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { databaseQuery } from "@/lib/database.server";
import type { AuthContext, Role } from "./guards";

export const SESSION_COOKIE = "dc_session";
const SESSION_DAYS = 14;
/** Extend (and re-set the cookie) at most once an hour. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function secureCookies(): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

function writeCookie(token: string) {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function createSession(userId: string, userAgent: string | null): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await databaseQuery(
    `insert into public.app_sessions (token_hash, user_id, expires_at, user_agent)
     values ($1, $2, now() + make_interval(days => $3), $4)`,
    [hashToken(token), userId, SESSION_DAYS, userAgent?.slice(0, 300) ?? null],
  );
  writeCookie(token);
}

type SessionRow = {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  must_change_password: boolean;
  last_seen_at: Date;
};

export type SessionUser = AuthContext & { mustChangePassword: boolean };

/** The signed-in user for this request, or null. */
export async function readSession(): Promise<SessionUser | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const { rows } = await databaseQuery<SessionRow>(
    `select s.user_id, s.last_seen_at, u.email, u.name, u.role, u.must_change_password
       from public.app_sessions s
       join public.app_users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.active`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_AFTER_MS) {
    await databaseQuery(
      `update public.app_sessions
          set last_seen_at = now(), expires_at = now() + make_interval(days => $2)
        where token_hash = $1`,
      [tokenHash, SESSION_DAYS],
    );
    writeCookie(token);
  }
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    mustChangePassword: row.must_change_password,
  };
}

export async function destroySession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE);
  if (token) {
    await databaseQuery(`delete from public.app_sessions where token_hash = $1`, [
      hashToken(token),
    ]);
  }
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

/** Sign a user out everywhere except, optionally, this browser. */
export async function destroyUserSessions(userId: string, keepCurrent = false): Promise<void> {
  const token = keepCurrent ? getCookie(SESSION_COOKIE) : undefined;
  await databaseQuery(
    `delete from public.app_sessions where user_id = $1 and ($2::text is null or token_hash <> $2)`,
    [userId, token ? hashToken(token) : null],
  );
}

/** Housekeeping, run by the scheduler. */
export async function purgeExpiredSessions(): Promise<void> {
  await databaseQuery(`delete from public.app_sessions where expires_at < now()`);
  await databaseQuery(`delete from public.app_login_failures where at < now() - interval '1 day'`);
}
