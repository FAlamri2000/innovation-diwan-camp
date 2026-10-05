/**
 * Sign-in, sign-out, password change, and the per-browser preferences
 * (language, theme) that the server needs to render the first paint right.
 *
 * Error messages are dictionary keys (auth.error.*); the client translates
 * them (errorMessage in components/camp/camp-ui.tsx).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";
import type { Role } from "@/lib/auth/guards";

export type Locale = "ar" | "en";
export type Theme = "light" | "dark";

export const LOCALE_COOKIE = "dc_locale";
export const THEME_COOKIE = "dc_theme";

export type BootUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
};

export type Boot = { user: BootUser | null; locale: Locale; theme: Theme };

const MAX_FAILURES = 8;
const FAILURE_WINDOW_MINUTES = 15;

async function refuseCrossSite() {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  if (request?.headers.get("sec-fetch-site") === "cross-site") {
    throw new Error("auth.error.invalid");
  }
  return request;
}

/** Everything the first render needs: who is signed in, language, theme. */
export const getBoot = createServerFn({ method: "GET" }).handler(async (): Promise<Boot> => {
  const { getCookie } = await import("@tanstack/react-start/server");
  const { readSession } = await import("@/lib/auth/session.server");
  const user = await readSession();
  return {
    user: user
      ? {
          id: user.userId,
          email: user.email,
          name: user.name,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        }
      : null,
    locale: getCookie(LOCALE_COOKIE) === "en" ? "en" : "ar",
    theme: getCookie(THEME_COOKIE) === "dark" ? "dark" : "light",
  };
});

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        email: z.string().trim().toLowerCase().min(3).max(200),
        password: z.string().min(1).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const request = await refuseCrossSite();
    const { databaseQuery } = await import("@/lib/database.server");
    const { verifyPassword, DUMMY_HASH } = await import("@/lib/auth/password.server");
    const { createSession } = await import("@/lib/auth/session.server");

    const failures = await databaseQuery<{ n: number }>(
      `select count(*)::int as n from public.app_login_failures
        where lower(email) = $1 and at > now() - make_interval(mins => $2)`,
      [data.email, FAILURE_WINDOW_MINUTES],
    );
    if ((failures.rows[0]?.n ?? 0) >= MAX_FAILURES) throw new Error("auth.error.throttled");

    const { rows } = await databaseQuery<{ id: string; password_hash: string; active: boolean }>(
      `select id, password_hash, active from public.app_users where lower(email) = $1`,
      [data.email],
    );
    const user = rows[0];
    // Verify even when the email is unknown, so a miss takes as long as a hit.
    const ok = await verifyPassword(data.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      const ip = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      await databaseQuery(`insert into public.app_login_failures (email, ip) values ($1, $2)`, [
        data.email,
        ip,
      ]);
      throw new Error("auth.error.invalid");
    }
    if (!user.active) throw new Error("auth.error.inactive");

    await databaseQuery(`update public.app_users set last_login_at = now() where id = $1`, [
      user.id,
    ]);
    await createSession(user.id, request?.headers.get("user-agent") ?? null);
    return { ok: true };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { destroySession } = await import("@/lib/auth/session.server");
  await destroySession();
  return { ok: true };
});

export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        current: z.string().min(1).max(200),
        next: z.string().min(10).max(200),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { databaseQuery } = await import("@/lib/database.server");
    const { verifyPassword, hashPassword } = await import("@/lib/auth/password.server");
    const { destroyUserSessions } = await import("@/lib/auth/session.server");
    const { rows } = await databaseQuery<{ password_hash: string }>(
      `select password_hash from public.app_users where id = $1`,
      [context.userId],
    );
    if (!rows[0] || !(await verifyPassword(data.current, rows[0].password_hash))) {
      throw new Error("auth.error.wrongCurrent");
    }
    if (data.current === data.next) throw new Error("auth.error.samePassword");
    await databaseQuery(
      `update public.app_users
          set password_hash = $2, must_change_password = false, updated_at = now()
        where id = $1`,
      [context.userId, await hashPassword(data.next)],
    );
    // Any other browser holding the old password's session is signed out.
    await destroyUserSessions(context.userId, true);
    return { ok: true };
  });

export const setPreferences = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        locale: z.enum(["ar", "en"]).optional(),
        theme: z.enum(["light", "dark"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { setCookie } = await import("@tanstack/react-start/server");
    const options = { path: "/", sameSite: "lax" as const, maxAge: 365 * 24 * 60 * 60 };
    if (data.locale) setCookie(LOCALE_COOKIE, data.locale, options);
    if (data.theme) setCookie(THEME_COOKIE, data.theme, options);
    return { ok: true };
  });
