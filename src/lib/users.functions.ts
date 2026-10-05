/**
 * User management (admin only). Passwords are never chosen by the admin and
 * never shown twice: creating a user or resetting a password returns a
 * one-time password, and the user must replace it at first sign-in.
 *
 * Two guards keep the app administrable: an admin cannot demote or deactivate
 * themself, and the last active admin cannot be demoted or deactivated.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";
import { requireAdmin, ROLES, type Role } from "@/lib/auth/guards";

export type AppUserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

const roleSchema = z.enum(ROLES as [Role, ...Role[]]);
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export const listAppUsers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<AppUserRow[]> => {
    await requireAdmin(context);
    const { databaseQuery } = await import("@/lib/database.server");
    const { rows } = await databaseQuery<{
      id: string;
      email: string;
      name: string;
      role: Role;
      active: boolean;
      must_change_password: boolean;
      last_login_at: Date | null;
      created_at: Date;
    }>(
      `select id, email, name, role, active, must_change_password, last_login_at, created_at
         from public.app_users
        order by active desc, case role when 'admin' then 0 when 'editor' then 1 else 2 end, lower(name), lower(email)`,
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      active: r.active,
      mustChangePassword: r.must_change_password,
      lastLoginAt: iso(r.last_login_at),
      createdAt: iso(r.created_at)!,
    }));
  });

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email().max(200),
        name: z.string().trim().min(1).max(120),
        role: roleSchema,
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const { databaseQuery } = await import("@/lib/database.server");
    const { hashPassword, generatePassword } = await import("@/lib/auth/password.server");
    const { audit } = await import("@/lib/camp/db.server");
    const exists = await databaseQuery(`select 1 from public.app_users where lower(email) = $1`, [
      data.email,
    ]);
    if (exists.rowCount) throw new Error("users.error.exists");
    const password = generatePassword();
    const { rows } = await databaseQuery<{ id: string }>(
      `insert into public.app_users (email, name, role, password_hash, must_change_password)
       values ($1, $2, $3, $4, true) returning id`,
      [data.email, data.name, data.role, await hashPassword(password)],
    );
    await audit(context.userId, "user.create", [rows[0].id], {
      email: data.email,
      role: data.role,
    });
    return { id: rows[0].id, password };
  });

/** Would this change leave the app without an active admin? */
async function wouldOrphanAdmins(userId: string): Promise<boolean> {
  const { databaseQuery } = await import("@/lib/database.server");
  const { rows } = await databaseQuery<{ n: number }>(
    `select count(*)::int as n from public.app_users
      where role = 'admin' and active and id <> $1`,
    [userId],
  );
  return (rows[0]?.n ?? 0) === 0;
}

export const updateAppUser = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        role: roleSchema.optional(),
        active: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const { databaseQuery } = await import("@/lib/database.server");
    const { destroyUserSessions } = await import("@/lib/auth/session.server");
    const { audit } = await import("@/lib/camp/db.server");
    const { rows } = await databaseQuery<{ role: Role; active: boolean }>(
      `select role, active from public.app_users where id = $1`,
      [data.id],
    );
    const current = rows[0];
    if (!current) throw new Error("users.error.notFound");

    const demoting = data.role !== undefined && data.role !== "admin" && current.role === "admin";
    const deactivating = data.active === false && current.active;
    if ((demoting || deactivating) && data.id === context.userId) {
      throw new Error("users.error.self");
    }
    if (
      (demoting || deactivating) &&
      current.role === "admin" &&
      (await wouldOrphanAdmins(data.id))
    ) {
      throw new Error("users.error.lastAdmin");
    }

    await databaseQuery(
      `update public.app_users
          set name = coalesce($2, name),
              role = coalesce($3, role),
              active = coalesce($4, active),
              updated_at = now()
        where id = $1`,
      [data.id, data.name ?? null, data.role ?? null, data.active ?? null],
    );
    if (deactivating) await destroyUserSessions(data.id);
    await audit(context.userId, "user.update", [data.id], {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    });
    return { ok: true };
  });

export const resetAppUserPassword = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const { databaseQuery } = await import("@/lib/database.server");
    const { hashPassword, generatePassword } = await import("@/lib/auth/password.server");
    const { destroyUserSessions } = await import("@/lib/auth/session.server");
    const { audit } = await import("@/lib/camp/db.server");
    const password = generatePassword();
    const result = await databaseQuery(
      `update public.app_users
          set password_hash = $2, must_change_password = true, updated_at = now()
        where id = $1`,
      [data.id, await hashPassword(password)],
    );
    if (!result.rowCount) throw new Error("users.error.notFound");
    await destroyUserSessions(data.id);
    await audit(context.userId, "user.resetPassword", [data.id]);
    return { password };
  });
