/**
 * Server entry: wraps TanStack Start's handler with a last-resort error page,
 * and starts the in-process camp worker when the server boots.
 */
import { renderErrorPage } from "./lib/error-page";
import { startScheduler } from "./lib/scheduler.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

function getServerEntry(): Promise<ServerEntry> {
  serverEntryPromise ??= import("@tanstack/react-start/server-entry").then(
    (m) => (m.default ?? m) as ServerEntry,
  );
  return serverEntryPromise;
}

// Built server only: the dev server must not reach SoWork on its own
// (opt in with CAMP_SCHEDULER=on).
if (process.env.NODE_ENV === "production" || process.env.CAMP_SCHEDULER === "on") {
  startScheduler();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      return await handler.fetch(request, env, ctx);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
