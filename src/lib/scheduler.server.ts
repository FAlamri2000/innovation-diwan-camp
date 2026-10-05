/**
 * The in-process worker: the camp sync tick once a minute, session
 * housekeeping once an hour. It starts with the server (src/server.ts), so a
 * deployment needs no external scheduler.
 *
 * Safe with more than one replica: runCampTick holds a database lease, so a
 * second process skips ("busy") rather than double-sending. Turn it off with
 * CAMP_SCHEDULER=off (then POST /api/tick from a scheduler of your choice).
 */
type SchedulerGlobal = typeof globalThis & { __DIWAN_CAMP_SCHEDULER__?: boolean };

const TICK_MS = 60_000;
const HOUSEKEEPING_MS = 60 * 60_000;

export function startScheduler(): void {
  const global = globalThis as SchedulerGlobal;
  if (global.__DIWAN_CAMP_SCHEDULER__) return;
  if (process.env.CAMP_SCHEDULER === "off") {
    console.log("[scheduler] off (CAMP_SCHEDULER=off)");
    return;
  }
  global.__DIWAN_CAMP_SCHEDULER__ = true;
  let lastHousekeeping = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let stopping = false;

  const tick = async () => {
    const started = Date.now();
    try {
      const { runCampTick } = await import("@/lib/camp/sync.server");
      const result = await runCampTick({ trigger: "schedule" });
      if ("skipped" in result && result.skipped === "not_configured" && lastHousekeeping === 0) {
        console.warn("[scheduler] SOWORK_API_KEY is not set — the camp sync is idle");
      }
      if (started - lastHousekeeping > HOUSEKEEPING_MS) {
        const { purgeExpiredSessions } = await import("@/lib/auth/session.server");
        await purgeExpiredSessions();
        lastHousekeeping = started;
      }
    } catch (error) {
      console.error("[scheduler] tick failed:", error);
    }
    if (!stopping) timer = setTimeout(loop, Math.max(5_000, TICK_MS - (Date.now() - started)));
  };
  const loop = () => {
    running = tick().finally(() => {
      running = null;
    });
  };

  // The HTTP server closes itself on SIGTERM but never exits, and this loop
  // and the database pool would keep the process alive: let a running tick
  // finish (bounded), then exit, so a redeploy is never held up.
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    console.log(`[scheduler] ${signal}: stopping`);
    await Promise.race([running ?? Promise.resolve(), new Promise((r) => setTimeout(r, 15_000))]);
    setTimeout(() => process.exit(0), 1_000);
  };
  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));

  // Let the server finish booting (and the migrator's connections close) first.
  timer = setTimeout(loop, 10_000);
  console.log("[scheduler] camp sync every minute");
}
