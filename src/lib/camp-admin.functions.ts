/**
 * Camp operations — messaging, imports, settings and the sync worker.
 *
 *   editor  bulk messages (FR-USR-06, FR-NAM-05), tests to one's own account,
 *           retries, imports, "sync now"
 *   admin   settings (incl. the sending switch), templates and cues, office-
 *           wide broadcasts, starting event capture
 *
 * A bulk send is personalised per person (suggested name, team), so it is one
 * direct message each — never a group DM that would show recipients to one
 * another.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";
import { requireAdmin, requireEditor, requireViewer } from "@/lib/auth/guards";
import { parseCampSettingsPatch } from "@/lib/camp/settings";

const swId = () => z.string().regex(/^[a-zA-Z0-9]{4,36}$/);
const hhmm = () => z.string().regex(/^\d{2}:\d{2}$/);

async function invalidate() {
  const { invalidateCampModel } = await import("@/lib/camp/model.server");
  const { invalidateAttendance } = await import("@/lib/camp/attendance.server");
  invalidateCampModel();
  invalidateAttendance();
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Send a template (or free text) to many accounts. Placeholders are filled per
 * person: {الاسم}, {الاسم المقترح}, {اسم الحساب}, {الرقم}. A person whose
 * template cannot be completed (no suggested name for M01) is reported as a
 * failure, not sent a half-filled message.
 */
export const sendCampMessage = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        swUserIds: z.array(swId()).min(1).max(1000),
        templateKey: z.string().max(20).nullable().default(null),
        text: z.string().trim().max(4000).nullable().default(null),
      })
      .refine((v) => !!v.templateKey || !!v.text, "A template or a text is required")
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    const { loadCampModel } = await import("@/lib/camp/model.server");
    const { greetingName } = await import("@/lib/camp/automation.server");
    const { renderTemplate } = await import("@/lib/camp/cues");
    const { sendDms } = await import("@/lib/camp/messaging.server");
    const model = await loadCampModel();
    const templates = new Map(
      (await q<{ key: string; text: string }>(`select key, text from public.camp_templates`)).map(
        (t) => [t.key, t.text],
      ),
    );
    if (input.templateKey && !templates.has(input.templateKey)) throw new Error("Unknown template");
    const template = input.templateKey ? templates.get(input.templateKey)! : (input.text ?? "");
    // M01 is the participant wording and M02 the enabler's: a mixed selection
    // gets the right one per person.
    const naming = input.templateKey === "M01" || input.templateKey === "M02";
    const ids = [...new Set(input.swUserIds)];
    const targets = ids.map((id) => {
      const account = model.accountById.get(id);
      const person = account ? model.personByKey.get(account.personKey) : undefined;
      const text = naming
        ? (templates.get(account?.eventRole === "participant" ? "M01" : "M02") ?? template)
        : template;
      return {
        swUserId: id,
        text: renderTemplate(text, {
          الاسم: greetingName(model, person, id),
          "الاسم المقترح": account?.suggestedName ?? "",
          "اسم الحساب": account?.name ?? "",
          الرقم: account?.teamNo ?? "",
        }),
      };
    });
    const res = await sendDms(targets, {
      kind: "manual",
      itemKey: input.templateKey,
      dayNo: null,
      sentBy: context.userId,
      logText: template,
    });
    await audit(context.userId, "bulk.message", ids, {
      templateKey: input.templateKey,
      delivered: res.delivered,
      failed: res.failures.length,
    });
    await invalidate();
    return { delivered: res.delivered, failed: res.failures.length, logId: res.logId };
  });

/** FR-NOT-03: a test to the operator's own SoWork account. */
export const sendCampTest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ text: z.string().trim().min(1).max(4000) }).parse(d))
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q } = await import("@/lib/camp/db.server");
    const { renderTemplate } = await import("@/lib/camp/cues");
    const { sendDms } = await import("@/lib/camp/messaging.server");
    const { formatDateAr, riyadhDate } = await import("@/lib/camp/text");
    const mine = (
      await q<{ sw_user_id: string | null }>(
        `select sw_user_id from public.camp_operators where user_id = $1`,
        [context.userId],
      )
    )[0];
    if (!mine?.sw_user_id) throw new Error("Choose your SoWork account first");
    const text = `[تجربة] ${renderTemplate(input.text, { التاريخ: formatDateAr(riyadhDate(Date.now())) })}`;
    // Unfilled placeholders are expected in a test of a template: show them.
    const res = await sendDms(
      [{ swUserId: mine.sw_user_id, text: text.replace(/\{/g, "‹").replace(/\}/g, "›") }],
      {
        kind: "test",
        itemKey: null,
        dayNo: null,
        sentBy: context.userId,
      },
    );
    return { delivered: res.delivered, failed: res.failures.length };
  });

/** M05: retry the failed recipients of a logged send. */
export const retryCampSend = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ logId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    const { sendDms } = await import("@/lib/camp/messaging.server");
    const rows = await q<{
      channel: string;
      item_key: string | null;
      kind: string;
      text: string;
      failures: { userId?: string; error: string; text?: string }[];
    }>(`select channel, item_key, kind, text, failures from public.camp_send_log where id = $1`, [
      input.logId,
    ]);
    const row = rows[0];
    if (!row) throw new Error("Send not found");
    if (row.channel !== "dm") throw new Error("Only direct messages can be retried");
    const targets = row.failures
      .filter((f) => f.userId && f.text && !f.error.startsWith("unfilled"))
      .map((f) => ({ swUserId: f.userId!, text: f.text! }));
    if (!targets.length) return { delivered: 0, failed: 0 };
    const res = await sendDms(targets, {
      kind: "manual",
      itemKey: row.item_key,
      dayNo: null,
      sentBy: context.userId,
      logText: row.text,
    });
    await q(
      `update public.camp_send_log set failures = '[]'::jsonb, status = case when delivered > 0 then 'sent' else status end where id = $1`,
      [input.logId],
    );
    await audit(
      context.userId,
      "bulk.retry",
      targets.map((t) => t.swUserId),
      { logId: input.logId, delivered: res.delivered },
    );
    return { delivered: res.delivered, failed: res.failures.length };
  });

/** An office-wide gong, announcement or channel post, now (admin). */
export const broadcastCampNow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        channel: z.enum(["gong", "announcement", "channel"]),
        text: z.string().trim().min(1).max(4000),
        channelId: z.string().max(64).nullable().default(null),
      })
      .refine(
        (v) => v.channel === "channel" || v.text.length <= 100,
        "Gong and announcement texts are limited to 100 characters",
      )
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireAdmin(context);
    const { broadcast } = await import("@/lib/camp/messaging.server");
    const { audit, loadSettings, getState } = await import("@/lib/camp/db.server");
    const settings = await loadSettings();
    const channelId =
      input.channelId ??
      (settings.announcementChannelId ||
        (await getState<{ id: string }>("default_channel"))?.id ||
        undefined);
    const res = await broadcast(input.channel, input.text, {
      kind: "manual",
      itemKey: null,
      dayNo: null,
      sentBy: context.userId,
      channelId,
    });
    await audit(context.userId, `broadcast.${input.channel}`, [], {
      text: input.text,
      status: res.status,
    });
    return { status: res.status, error: res.failures[0]?.error ?? null };
  });

export const saveCampTemplate = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        key: z.string().min(2).max(20),
        text: z.string().trim().min(1).max(4000),
        enabled: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireAdmin(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    const rows = await q(
      `update public.camp_templates set text = $2, enabled = $3, updated_by = $4, updated_at = now() where key = $1 returning key`,
      [input.key, input.text, input.enabled, context.userId],
    );
    if (!rows.length) throw new Error("Unknown template");
    await audit(context.userId, "template.save", [input.key], { enabled: input.enabled });
    return { ok: true };
  });

export const saveCampCue = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        key: z.string().min(2).max(10),
        timeOfDay: hhmm(),
        endTime: hhmm().nullable().default(null),
        days: z.array(z.number().int().min(1).max(60)).max(60),
        disabledDays: z.array(z.number().int().min(1).max(60)).max(60).default([]),
        dayTimes: z.record(z.string(), hhmm()).default({}),
        text: z.string().trim().min(1).max(4000),
        enabled: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireAdmin(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    const { CHANNEL_LIMITS } = await import("@/lib/camp/cues");
    const current = (
      await q<{ channel: "channel" | "gong" | "announcement" | "npc" }>(
        `select channel from public.camp_cues where key = $1`,
        [input.key],
      )
    )[0];
    if (!current) throw new Error("Unknown cue");
    // FR-NOT-02: the popup and bubble limits are the API's, enforced here too.
    const limit = CHANNEL_LIMITS[current.channel];
    if (input.text.length > limit)
      throw new Error(`Text is ${input.text.length} characters; the limit is ${limit}`);
    await q(
      `update public.camp_cues set time_of_day = $2, end_time = $3, days = $4, disabled_days = $5, day_times = $6::jsonb,
              text = $7, enabled = $8, updated_by = $9, updated_at = now() where key = $1`,
      [
        input.key,
        input.timeOfDay,
        input.endTime,
        input.days,
        input.disabledDays,
        JSON.stringify(input.dayTimes),
        input.text,
        input.enabled,
        context.userId,
      ],
    );
    await audit(context.userId, "cue.save", [input.key], {
      enabled: input.enabled,
      days: input.days,
      disabledDays: input.disabledDays,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Settings, operators, sync
// ---------------------------------------------------------------------------

export const saveCampSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => parseCampSettingsPatch(d))
  .handler(async ({ context, data: patch }) => {
    await requireAdmin(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    await q(
      `update public.camp_settings set settings = settings || $1::jsonb, updated_at = now(), updated_by = $2 where id`,
      [JSON.stringify(patch), context.userId],
    );
    await audit(
      context.userId,
      "settings.save",
      Object.keys(patch),
      patch as Record<string, unknown>,
    );
    await invalidate();
    return { ok: true };
  });

/** The caller's own SoWork account (tests) and whether they are on duty (alerts). */
export const setMyCampAccount = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ swUserId: swId().nullable(), onDuty: z.boolean() }).parse(d))
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q } = await import("@/lib/camp/db.server");
    await q(
      `insert into public.camp_operators (user_id, sw_user_id, on_duty, updated_at) values ($1, $2, $3, now())
       on conflict (user_id) do update set sw_user_id = excluded.sw_user_id, on_duty = excluded.on_duty, updated_at = now()`,
      [context.userId, input.swUserId, input.onDuty],
    );
    return { ok: true };
  });

export const runCampSyncNow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireEditor(context);
    const { runCampTick } = await import("@/lib/camp/sync.server");
    const result = await runCampTick({ force: true, trigger: "manual" });
    await invalidate();
    return {
      skipped: result.skipped ?? null,
      durationMs: result.durationMs,
      errors: Object.entries(result.steps)
        .filter(([, s]) => !s.ok)
        .map(([name, s]) => `${name}: ${s.error ?? ""}`),
    };
  });

/** FR-ATT-01 go-live: create (or adopt) the inbox subscription for the five events. */
export const startCampEventCapture = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { ensureInboxSubscription } = await import("@/lib/camp/sync.server");
    const { audit } = await import("@/lib/camp/db.server");
    const result = await ensureInboxSubscription();
    await audit(context.userId, "events.subscribe", [result.id], { created: result.created });
    return result;
  });

/** Settings → connection check: who the key acts as, and whether analytics is allowed. */
export const testCampConnection = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { sowork, soworkConfigured, SoworkError } = await import("@/lib/camp/sowork.server");
    const { riyadhDate } = await import("@/lib/camp/text");
    if (!soworkConfigured())
      return { configured: false, me: null, analytics: false, channels: [], error: null };
    try {
      const me = await sowork.me();
      let analytics = true;
      try {
        await sowork.workingHours({ date: riyadhDate(Date.now()), timezone: "Asia/Riyadh" });
      } catch (error) {
        if (error instanceof SoworkError && error.status === 403) analytics = false;
        else throw error;
      }
      const { channels } = await sowork.channels();
      return {
        configured: true,
        me: { id: me.id, name: me.name ?? "" },
        analytics,
        channels,
        error: null,
      };
    } catch (error) {
      return {
        configured: true,
        me: null,
        analytics: false,
        channels: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

// ---------------------------------------------------------------------------
// Imports (FR-IMP-01..07)
// ---------------------------------------------------------------------------

const cell = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

export const previewCampImport = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        kind: z.enum(["registry", "agenda"]),
        fileName: z.string().min(1).max(255),
        sheets: z
          .array(
            z.object({ name: z.string().max(120), rows: z.array(z.array(cell).max(80)).max(3000) }),
          )
          .min(1)
          .max(60),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { previewImport } = await import("@/lib/camp/import.server");
    return previewImport(input.kind, input.fileName, input.sheets, context.userId);
  });

export const applyCampImport = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { applyImport } = await import("@/lib/camp/import.server");
    const result = await applyImport(input.id, context.userId);
    await invalidate();
    return result;
  });

export const discardCampImport = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { discardImport } = await import("@/lib/camp/import.server");
    await discardImport(input.id);
    return { ok: true };
  });

/** Who may do what, for the screens to hide what the server would refuse. */
export const getCampAbilities = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireViewer(context);
    return { edit: context.role !== "viewer", admin: context.role === "admin" };
  });
