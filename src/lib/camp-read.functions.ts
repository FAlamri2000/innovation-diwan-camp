/**
 * Camp operations — read endpoints for the eleven screens (Module 1–6).
 *
 * Every handler requires a signed-in user (any role); all of them read the one cached
 * model (camp/model.server.ts) or attendance context (camp/attendance.server.ts),
 * imported inside the handler so nothing server-only reaches the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";
import { requireViewer } from "@/lib/auth/guards";
import type {
  AlertRow,
  AgendaPayload,
  CoveragePayload,
  CueRow,
  DaySheetPayload,
  DirectoryPayload,
  DuplicateRow,
  DuplicatesPayload,
  ImportPreview,
  Json,
  LivePayload,
  MeetingRow,
  NamingPayload,
  OverviewPayload,
  PersonMeetingRow,
  SendLogRow,
  SummaryPayload,
  SyncStatusDto,
  TemplateRow,
  WindowRow,
} from "@/lib/camp/types";
import type { CampSettings } from "@/lib/camp/settings";

async function syncStatusDto(settings: CampSettings): Promise<SyncStatusDto> {
  const { syncStatus } = await import("@/lib/camp/sync.server");
  const s = await syncStatus();
  const tick = s.state.last_tick?.value as
    { startedAt?: string; steps?: Record<string, { ok: boolean; error?: string }> } | undefined;
  const sub = s.state.subscription?.value as { id?: string } | null | undefined;
  const cursor = s.state.events_cursor?.value as { lastEventAt?: string } | undefined;
  const backfill = s.state.meetings_backfill?.value as { done?: boolean } | undefined;
  const steps = Object.entries(tick?.steps ?? {});
  return {
    configured: s.configured,
    subscriptionId: sub?.id ?? null,
    lastTickAt: tick?.startedAt ?? null,
    lastTickOk: steps.length ? steps.every(([, v]) => v.ok) : null,
    lastTickErrors: steps.filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.error ?? ""}`),
    lastEventAt: cursor?.lastEventAt ?? null,
    minutesSinceRefresh: tick?.startedAt
      ? Math.floor((Date.now() - Date.parse(tick.startedAt)) / 60_000)
      : null,
    backfillDone: !!backfill?.done,
    counts: s.counts,
    sendingEnabled: settings.sendingEnabled,
  };
}

export const getCampOverview = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<OverviewPayload> => {
    await requireViewer(context);
    const { loadAttendance, todayRates, liveView } = await import("@/lib/camp/attendance.server");
    const { campDayOf } = await import("@/lib/camp/automation.server");
    const { q } = await import("@/lib/camp/db.server");
    const { riyadhDate } = await import("@/lib/camp/text");
    const data = await loadAttendance();
    const { model, now } = data;
    const settings = model.settings;
    const inCamp = campDayOf(settings, now);
    const lastDayWithSessions = Math.max(
      0,
      ...data.sessions.filter((s) => s.start <= now).map((s) => s.dayNo),
    );
    const dayNo = inCamp ?? (lastDayWithSessions || 1);
    const rates = todayRates(data, dayNo);
    const live = liveView(data);
    const alerts = await q<{
      id: string;
      code: string;
      title: string;
      detail: { [key: string]: Json };
      day_no: number | null;
      created_at: Date;
      acknowledged_at: Date | null;
      notified_at: Date | null;
    }>(
      `select id, code, title, detail, day_no, created_at, acknowledged_at, notified_at from public.camp_alerts
        where acknowledged_at is null order by created_at desc limit 20`,
    );
    return {
      campDay: dayNo,
      dayCount: settings.dayCount,
      today: riyadhDate(now),
      currentSessions: data.sessions.filter((s) => s.start <= now && now < s.end),
      nextSession: data.sessions.find((s) => s.start > now) ?? null,
      cards: {
        participantRate: rates.participantRate,
        enablerRate: rates.enablerRate,
        guiderCoverage: rates.guiderCoverage,
        namingViolations: model.accounts.filter((a) => a.naming === "violation").length,
        openDuplicates: model.pairs.filter(
          (p) =>
            p.level !== "lookalike" &&
            (!model.decisions.has(p.key) || model.decisions.get(p.key)?.decision === "follow_up"),
        ).length,
        onlineNow: live.onlineCount,
        inMeetingsNow: live.rooms.reduce((sum, r) => sum + r.people.length, 0),
      },
      alerts: alerts.map((a) => ({
        id: a.id,
        code: a.code,
        title: a.title,
        detail: a.detail,
        dayNo: a.day_no,
        createdAt: a.created_at.toISOString(),
        acknowledgedAt: a.acknowledged_at?.toISOString() ?? null,
        notifiedAt: a.notified_at?.toISOString() ?? null,
      })),
      sync: await syncStatusDto(settings),
    };
  });

export const getCampDirectory = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<DirectoryPayload> => {
    await requireViewer(context);
    const { loadCampModel } = await import("@/lib/camp/model.server");
    const model = await loadCampModel();
    return {
      accounts: model.accounts,
      missing: model.registry.filter((r) => r.accountIds.length === 0),
      registry: model.registry,
      teams: model.teams,
      typeChanges: model.typeChanges,
      teamCount: model.settings.teamCount,
      soworkAdminUrl: model.settings.soworkAdminUrl,
      generatedAt: new Date(model.generatedAt).toISOString(),
    };
  });

export const getCampPerson = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ key: z.string().min(3).max(80) }).parse(d))
  .handler(async ({ context, data: input }) => {
    await requireViewer(context);
    const { loadAttendance, personMeetings } = await import("@/lib/camp/attendance.server");
    const { q } = await import("@/lib/camp/db.server");
    const { rateOf } = await import("@/lib/camp/attendance");
    const data = await loadAttendance();
    const model = data.model;
    // An account key may have been merged into a person since the link was made.
    const key = input.key.startsWith("u:")
      ? (model.personOfAccount.get(input.key.slice(2)) ?? input.key)
      : input.key;
    const person = model.personByKey.get(key);
    if (!person) throw new Error("Person not found");
    const grid = data.grid();
    const days = [...new Set(data.sessions.map((s) => s.dayNo))].sort((a, b) => a - b);
    const daily = days
      .map((dayNo) => {
        const cells = data.sessions
          .filter((s) => s.dayNo === dayNo)
          .map((s) => grid.get(s.id)?.get(key))
          .filter((c): c is NonNullable<typeof c> => !!c);
        const rate = rateOf(cells);
        const minutes = personMeetings(data, key, dayNo).reduce((sum, m) => sum + m.minutes, 0);
        return { dayNo, rate, minutes, statuses: cells.map((c) => c.status) };
      })
      .filter((d) => d.rate.expected > 0 || d.minutes > 0);
    const messages = person.accountIds.length
      ? await q<{
          id: string;
          kind: string;
          item_key: string | null;
          channel: string;
          text: string;
          status: string;
          created_at: Date;
        }>(
          `select id, kind, item_key, channel, text, status, created_at from public.camp_send_log
            where recipients && $1::text[] order by created_at desc limit 100`,
          [person.accountIds],
        )
      : [];
    return {
      person,
      registry: person.registryId ? (model.registryById.get(person.registryId) ?? null) : null,
      accounts: person.accountIds
        .map((id) => model.accountById.get(id))
        .filter((a): a is NonNullable<typeof a> => !!a),
      daily,
      meetings: personMeetings(data, key, null).slice(-300),
      messages: messages.map((m) => ({
        id: m.id,
        kind: m.kind,
        itemKey: m.item_key,
        channel: m.channel,
        text: m.text,
        status: m.status,
        createdAt: m.created_at.toISOString(),
      })),
    };
  });

export const getCampNaming = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<NamingPayload> => {
    await requireViewer(context);
    const { loadCampModel } = await import("@/lib/camp/model.server");
    const { q } = await import("@/lib/camp/db.server");
    const model = await loadCampModel();
    const rank = { violation: 0, note: 1, ok: 2 } as const;
    const rows = model.accounts
      .filter((a) => a.naming !== "ok")
      .sort(
        (a, b) =>
          rank[a.naming] - rank[b.naming] ||
          (a.teamNo ?? 999) - (b.teamNo ?? 999) ||
          a.name.localeCompare(b.name, "ar"),
      );
    const counts = { ok: 0, note: 0, violation: 0 };
    for (const a of model.accounts) counts[a.naming] += 1;
    const byTeam = new Map<number, { teamNo: number; violation: number; note: number }>();
    const byRole = new Map<
      string,
      { role: NamingPayload["byRole"][number]["role"]; violation: number; note: number }
    >();
    for (const a of rows) {
      if (a.teamNo !== null) {
        const t = byTeam.get(a.teamNo) ?? { teamNo: a.teamNo, violation: 0, note: 0 };
        t[a.naming === "violation" ? "violation" : "note"] += 1;
        byTeam.set(a.teamNo, t);
      }
      const r = byRole.get(a.eventRole) ?? { role: a.eventRole, violation: 0, note: 0 };
      r[a.naming === "violation" ? "violation" : "note"] += 1;
      byRole.set(a.eventRole, r);
    }
    const trend = await q<{ day_no: number; ok: string; note: string; violation: string }>(
      `select day_no,
              count(*) filter (where status = 'ok')::text as ok,
              count(*) filter (where status = 'note')::text as note,
              count(*) filter (where status = 'violation')::text as violation
         from public.camp_naming_daily group by day_no order by day_no`,
    );
    return {
      rows,
      counts,
      byTeam: [...byTeam.values()].sort((a, b) => a.teamNo - b.teamNo),
      byRole: [...byRole.values()],
      trend: trend.map((t) => ({
        dayNo: t.day_no,
        ok: Number(t.ok),
        note: Number(t.note),
        violation: Number(t.violation),
      })),
    };
  });

export const getCampDuplicates = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ includeHidden: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ context, data: input }): Promise<DuplicatesPayload> => {
    await requireViewer(context);
    const { loadCampModel } = await import("@/lib/camp/model.server");
    const { registryChecks } = await import("@/lib/camp/match");
    const { q } = await import("@/lib/camp/db.server");
    const model = await loadCampModel();
    const ids = [...new Set(model.pairs.flatMap((p) => [p.aId, p.bId]))];
    const spans = ids.length
      ? await q<{ sw_user_id: string; first: Date | null; last: Date | null }>(
          `select sw_user_id, min(joined_at) as first, max(coalesce(left_at, joined_at)) as last
             from public.camp_intervals where sw_user_id = any($1::text[]) group by sw_user_id`,
          [ids],
        )
      : [];
    const spanOf = new Map(spans.map((s) => [s.sw_user_id, s]));
    const side = (id: string) => {
      const a = model.accountById.get(id)!;
      const span = spanOf.get(id);
      return {
        swUserId: id,
        name: a.name,
        accountType: a.accountType,
        firstSeenAt: a.firstSeenAt,
        lastActivityAt: a.lastActivityAt,
        firstMeetingAt: span?.first?.toISOString() ?? null,
        lastMeetingAt: span?.last?.toISOString() ?? null,
        registryId: a.registryId,
        registryName: a.registryName ?? a.candidateName,
        phone: a.phone,
        teamNo: a.teamNo,
      };
    };
    const pairs: DuplicateRow[] = [];
    for (const p of model.pairs) {
      const d = model.decisions.get(p.key);
      if (d?.decision === "not_duplicate" && !input.includeHidden) continue;
      if (!model.accountById.has(p.aId) || !model.accountById.has(p.bId)) continue;
      pairs.push({
        key: p.key,
        a: side(p.aId),
        b: side(p.bId),
        score: p.score,
        level: p.level,
        reasons: p.reasons,
        decision: d?.decision ?? null,
        primaryId: d?.primary_id ?? null,
        decidedBy: d ? (d.decided_by_email ?? d.decided_by) : null,
        decidedAt: d?.decided_at?.toISOString() ?? null,
        note: d?.note ?? null,
      });
    }
    const people = new Map(model.registry.map((r) => [r.id, r]));
    const checks = registryChecks(
      model.registry.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        teamNo: r.teamNo,
        phone: r.phone,
        email: r.email,
      })),
    ).map((c) => ({
      kind: c.kind,
      value: c.value,
      people: c.personIds.map((id) => {
        const r = people.get(id);
        return { id, name: r?.name ?? id, teamNo: r?.teamNo ?? null, kind: r?.kind ?? "" };
      }),
    }));
    return {
      pairs,
      checks,
      thresholds: {
        suspected: model.settings.duplicateSuspectedScore,
        lookalike: model.settings.duplicateLookalikeScore,
      },
    };
  });

export const getCampAgenda = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<AgendaPayload> => {
    await requireViewer(context);
    const { loadAttendance } = await import("@/lib/camp/attendance.server");
    const data = await loadAttendance();
    return {
      days: data.days,
      sessions: data.sessions,
      rooms: data.rooms,
      committees: data.committees,
      judging: data.judging,
    };
  });

export const getAttendanceDay = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ dayNo: z.number().int().min(1).max(60) }).parse(d))
  .handler(async ({ context, data: input }): Promise<DaySheetPayload> => {
    await requireViewer(context);
    const { loadAttendance, daySheet } = await import("@/lib/camp/attendance.server");
    return daySheet(await loadAttendance(), input.dayNo);
  });

export const getPersonMeetings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({ key: z.string().min(3).max(80), dayNo: z.number().int().min(1).max(60).nullable() })
      .parse(d),
  )
  .handler(async ({ context, data: input }): Promise<PersonMeetingRow[]> => {
    await requireViewer(context);
    const { loadAttendance, personMeetings } = await import("@/lib/camp/attendance.server");
    return personMeetings(await loadAttendance(), input.key, input.dayNo);
  });

export const getAttendanceWindow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({ from: z.number().int().positive(), to: z.number().int().positive() })
      .refine(
        (v) => v.to > v.from && v.to - v.from <= 3 * 86_400_000,
        "Window must be positive and at most 3 days",
      )
      .parse(d),
  )
  .handler(async ({ context, data: input }): Promise<WindowRow[]> => {
    await requireViewer(context);
    const { loadAttendance, windowSheet } = await import("@/lib/camp/attendance.server");
    return windowSheet(await loadAttendance(), input.from, input.to);
  });

export const getAttendanceLive = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<LivePayload> => {
    await requireViewer(context);
    const { loadAttendance, liveView } = await import("@/lib/camp/attendance.server");
    return liveView(await loadAttendance());
  });

export const getAttendanceSummary = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<SummaryPayload> => {
    await requireViewer(context);
    const { loadAttendance, summary } = await import("@/lib/camp/attendance.server");
    return summary(await loadAttendance());
  });

export const getGuiderCoverage = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<CoveragePayload> => {
    await requireViewer(context);
    const { loadAttendance, coverage } = await import("@/lib/camp/attendance.server");
    return coverage(await loadAttendance());
  });

export const listCampMeetings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        dayNo: z.number().int().min(1).max(60).nullable().default(null),
        unplacedOnly: z.boolean().default(false),
        library: z
          .enum(["pending", "linked", "uncertain", "none", "manual"])
          .nullable()
          .default(null),
        minParticipants: z.number().int().min(0).max(1000).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data: input }): Promise<MeetingRow[]> => {
    await requireViewer(context);
    const { loadAttendance, meetingRows } = await import("@/lib/camp/attendance.server");
    return meetingRows(await loadAttendance(), input)
      .filter((m) => m.participants >= input.minParticipants)
      .slice(0, 800);
  });

export const listCampAlerts = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({ includeAcknowledged: z.boolean().default(false) }).parse(d ?? {}),
  )
  .handler(async ({ context, data: input }): Promise<AlertRow[]> => {
    await requireViewer(context);
    const { q } = await import("@/lib/camp/db.server");
    const rows = await q<{
      id: string;
      code: string;
      title: string;
      detail: { [key: string]: Json };
      day_no: number | null;
      created_at: Date;
      acknowledged_at: Date | null;
      notified_at: Date | null;
    }>(
      `select id, code, title, detail, day_no, created_at, acknowledged_at, notified_at from public.camp_alerts
        where ($1 or acknowledged_at is null) order by created_at desc limit 300`,
      [input.includeAcknowledged],
    );
    return rows.map((a) => ({
      id: a.id,
      code: a.code,
      title: a.title,
      detail: a.detail,
      dayNo: a.day_no,
      createdAt: a.created_at.toISOString(),
      acknowledgedAt: a.acknowledged_at?.toISOString() ?? null,
      notifiedAt: a.notified_at?.toISOString() ?? null,
    }));
  });

export const listCampSendLog = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({ limit: z.number().int().min(1).max(500).default(200) }).parse(d ?? {}),
  )
  .handler(async ({ context, data: input }): Promise<SendLogRow[]> => {
    await requireViewer(context);
    const { q } = await import("@/lib/camp/db.server");
    const { loadCampModel } = await import("@/lib/camp/model.server");
    const model = await loadCampModel();
    const rows = await q<{
      id: string;
      kind: string;
      item_key: string | null;
      channel: string;
      day_no: number | null;
      recipients: string[];
      text: string;
      status: SendLogRow["status"];
      delivered: number;
      failures: SendLogRow["failures"];
      created_at: Date;
    }>(
      `select id, kind, item_key, channel, day_no, recipients, text, status, delivered, failures, created_at
         from public.camp_send_log order by created_at desc limit $1`,
      [input.limit],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      itemKey: r.item_key,
      channel: r.channel,
      dayNo: r.day_no,
      recipients: r.recipients,
      recipientNames: r.recipients.map((id) => model.accountById.get(id)?.name ?? id),
      text: r.text,
      status: r.status,
      delivered: r.delivered,
      // The per-recipient text kept for retries stays on the server.
      failures: (r.failures ?? []).map((f) => ({ userId: f.userId, error: f.error })),
      createdAt: r.created_at.toISOString(),
    }));
  });

export const getCampMessaging = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireViewer(context);
    const { loadCues } = await import("@/lib/camp/automation.server");
    const { loadSettings, q } = await import("@/lib/camp/db.server");
    const settings = await loadSettings();
    const cues: CueRow[] = (await loadCues()).map((c) => ({
      key: c.key,
      timeOfDay: c.timeOfDay,
      endTime: c.endTime,
      days: c.days,
      disabledDays: c.disabledDays,
      dayTimes: c.dayTimes,
      channel: c.channel,
      text: c.text,
      enabled: c.enabled,
    }));
    const templates = await q<TemplateRow>(
      `select key, kind, text, enabled from public.camp_templates order by sort, key`,
    );
    const mine = await q<{ sw_user_id: string | null; on_duty: boolean }>(
      `select sw_user_id, on_duty from public.camp_operators where user_id = $1`,
      [context.userId],
    );
    return {
      cues,
      templates,
      sendingEnabled: settings.sendingEnabled,
      alertRecipientIds: settings.alertRecipientIds,
      myAccount: mine[0]?.sw_user_id ?? null,
      myOnDuty: mine[0]?.on_duty ?? false,
      maxNudgesPerDay: settings.maxNudgesPerDay,
      namingReminderTime: settings.namingReminderTime,
      namingReminderMax: settings.namingReminderMax,
      dayCount: settings.dayCount,
      startDate: settings.startDate,
    };
  });

export const getCampSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireViewer(context);
    const { loadSettings } = await import("@/lib/camp/db.server");
    const settings = await loadSettings();
    return { settings, sync: await syncStatusDto(settings) };
  });

export const getCampSyncStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<SyncStatusDto> => {
    await requireViewer(context);
    const { loadSettings } = await import("@/lib/camp/db.server");
    return syncStatusDto(await loadSettings());
  });

export const listCampImports = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<ImportPreview[]> => {
    await requireViewer(context);
    const { listImports } = await import("@/lib/camp/import.server");
    return listImports();
  });

export const listCampAudit = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({ limit: z.number().int().min(1).max(500).default(200) }).parse(d ?? {}),
  )
  .handler(async ({ context, data: input }) => {
    await requireViewer(context);
    const { q } = await import("@/lib/camp/db.server");
    const rows = await q<{
      id: string;
      actor: string | null;
      action: string;
      targets: string[];
      detail: { [key: string]: Json };
      created_at: Date;
      actor_email: string | null;
    }>(
      `select a.id::text, a.actor, a.action, a.targets, a.detail, a.created_at, u.email as actor_email
         from public.camp_audit a left join public.app_users u on u.id = a.actor
        order by a.created_at desc limit $1`,
      [input.limit],
    );
    return rows.map((r) => ({
      id: r.id,
      actor: r.actor_email ?? r.actor,
      action: r.action,
      targets: r.targets,
      detail: r.detail,
      createdAt: r.created_at.toISOString(),
    }));
  });
