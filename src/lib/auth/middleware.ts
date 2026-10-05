/**
 * Function middleware for every server function that needs a signed-in user.
 * Puts the AuthContext (./guards) on `context`; the handler then calls
 * requireViewer / requireEditor / requireAdmin.
 *
 * Cross-site requests are refused outright: the session cookie is SameSite=Lax
 * already, and the browser's Sec-Fetch-Site header closes the rest.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  if (request?.headers.get("sec-fetch-site") === "cross-site") {
    throw new Error("Unauthorized: cross-site request");
  }
  const { readSession } = await import("./session.server");
  const user = await readSession();
  if (!user) throw new Error("Unauthorized: sign in again");
  return next({
    context: { userId: user.userId, role: user.role, email: user.email, name: user.name },
  });
});
