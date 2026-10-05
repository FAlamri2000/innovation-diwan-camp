// Manual/external trigger for the camp sync tick. The in-process scheduler
// (src/lib/scheduler.server.ts) already runs it every minute; this exists for
// CAMP_SCHEDULER=off deployments. Authenticated by the TICK_SECRET header.
// Safe to call repeatedly — a database lease lets one tick run at a time.
import { createFileRoute } from "@tanstack/react-router";

async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/tick")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const secret = process.env.TICK_SECRET;
        const provided = request.headers.get("x-tick-secret") ?? "";
        if (!secret || !(await secretsMatch(provided, secret))) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const { runCampTick } = await import("@/lib/camp/sync.server");
        try {
          return Response.json(await runCampTick({ trigger: "schedule" }));
        } catch (error) {
          console.error("[tick] failed:", error);
          return Response.json({ error: "tick failed" }, { status: 500 });
        }
      },
    },
  },
});
