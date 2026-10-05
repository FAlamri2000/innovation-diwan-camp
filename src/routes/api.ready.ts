// Readiness: the process answers AND PostgreSQL does. 503 otherwise, so a
// rollout that cannot read a row is held back.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ready")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { databaseQuery } = await import("@/lib/database.server");
          await databaseQuery("select 1 from public.app_migrations limit 1");
          return Response.json({ ok: true, database: "ok" });
        } catch {
          return Response.json({ ok: false, database: "unreachable" }, { status: 503 });
        }
      },
    },
  },
});
