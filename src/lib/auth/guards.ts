/**
 * The permission model is one role per user (app_users.role):
 *
 *   viewer  reads every screen
 *   editor  + operator decisions, messages, imports, overrides, sync now
 *   admin   + settings (the sending switch), templates and cues, broadcasts,
 *             starting event capture, managing users
 *
 * `requireAuth` (./middleware) resolves the session into this context; the
 * guards below are the only authorization checks — the database is reachable
 * from the server alone.
 */
export type Role = "admin" | "editor" | "viewer";

export const ROLES: readonly Role[] = ["admin", "editor", "viewer"];

export type AuthContext = {
  userId: string;
  role: Role;
  email: string;
  name: string;
};

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

export function hasRole(context: Pick<AuthContext, "role">, needed: Role): boolean {
  return RANK[context.role] >= RANK[needed];
}

function need(context: AuthContext, needed: Role): void {
  if (!hasRole(context, needed)) throw new Error(`Forbidden: this needs the ${needed} role`);
}

export async function requireViewer(context: AuthContext): Promise<void> {
  need(context, "viewer");
}

export async function requireEditor(context: AuthContext): Promise<void> {
  need(context, "editor");
}

export async function requireAdmin(context: AuthContext): Promise<void> {
  need(context, "admin");
}
