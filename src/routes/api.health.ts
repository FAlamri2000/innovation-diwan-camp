// Liveness: the process answers. Use /api/ready for health checks that must
// also prove the database.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: true }),
    },
  },
});
