/**
 * Camp operations — operator decisions (Modules 1, 2, 4, 5 and the room map).
 *
 * Each requires a camp EDITOR, writes one decision table, records who and why
 * where the requirements ask for a reason (FR-USR-05, FR-ATT-09), audits it
 * (FR-USR-11), and invalidates the cached model so the next read re-derives.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";
import { requireEditor, requireViewer } from "@/lib/auth/guards";
import { SESSION_TYPES } from "@/lib/camp/agenda";
import type { LibraryOption } from "@/lib/camp/types";

const swId = () => z.string().regex(/^[a-zA-Z0-9]{4,36}$/);
const uuid = () => z.string().uuid();
const reason = () => z.string().trim().min(2).max(500);
const accountType = () => z.enum(["admin", "teammate", "guest"]);

async function invalidate() {
  const { invalidateCampModel } = await import("@/lib/camp/model.server");
  const { invalidateAttendance } = await import("@/lib/camp/attendance.server");
  invalidateCampModel();
  invalidateAttendance();
}

/** FR-USR-05: link, unlink, or mark as not in the registry — reason required. */
export const setCampAccountLink = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("link"),
          swUserId: swId(),
          personId: uuid(),
          reason: reason(),
        }),
        z.object({ action: z.literal("unlink"), swUserId: swId(), reason: reason() }),
        z.object({ action: z.literal("not_in_registry"), swUserId: swId(), reason: reason() }),
        z.object({ action: z.literal("reset"), swUserId: swId() }),
      ])
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    if (input.action === "reset") {
      await q(`delete from public.camp_account_links where sw_user_id = $1`, [input.swUserId]);
    } else {
      const status =
        input.action === "link"
          ? "linked"
          : input.action === "unlink"
            ? "unlinked"
            : "not_in_registry";
      await q(
        `insert into public.camp_account_links (sw_user_id, status, person_id, reason, decided_by, decided_at)
         values ($1, $2, $3, $4, $5, now())
         on conflict (sw_user_id) do update set status = excluded.status, person_id = excluded.person_id,
           reason = excluded.reason, decided_by = excluded.decided_by, decided_at = now()`,
        [
          input.swUserId,
          status,
          input.action === "link" ? input.personId : null,
          input.reason,
          context.userId,
        ],
      );
    }
    await audit(context.userId, `account.${input.action}`, [input.swUserId], {
      personId: input.action === "link" ? input.personId : null,
      reason: "reason" in input ? input.reason : null,
    });
    await invalidate();
    return { ok: true };
  });

/** FR-USR-06 "mark as reviewed" (and un-mark). */
export const markCampReviewed = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({ swUserIds: z.array(swId()).min(1).max(1000), reviewed: z.boolean() }).parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    if (input.reviewed) {
      await q(
        `insert into public.camp_account_reviews (sw_user_id, reviewed_by) select unnest($1::text[]), $2
         on conflict (sw_user_id) do update set reviewed_by = excluded.reviewed_by, reviewed_at = now()`,
        [input.swUserIds, context.userId],
      );
    } else {
      await q(`delete from public.camp_account_reviews where sw_user_id = any($1::text[])`, [
        input.swUserIds,
      ]);
    }
    await audit(
      context.userId,
      input.reviewed ? "bulk.reviewed" : "bulk.unreviewed",
      input.swUserIds,
    );
    await invalidate();
    return { ok: true, count: input.swUserIds.length };
  });

/**
 * FR-DUP-05/06: decide one or many pairs. A confirmed duplicate also puts the
 * second account on the change list for removal in SoWork admin, and can send
 * P05 asking the person to use one account.
 */
export const decideCampDuplicates = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        pairs: z
          .array(z.object({ aId: swId(), bId: swId(), primaryId: swId().nullable().default(null) }))
          .min(1)
          .max(500),
        decision: z.enum(["duplicate", "not_duplicate", "follow_up", "clear"]),
        note: z.string().max(500).nullable().default(null),
        sendMessage: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, tx, audit } = await import("@/lib/camp/db.server");
    const { pairKey } = await import("@/lib/camp/match");
    const messageTargets: { primary: string; secondary: string }[] = [];
    await tx(async (db) => {
      for (const pair of input.pairs) {
        const [a, b] = pair.aId < pair.bId ? [pair.aId, pair.bId] : [pair.bId, pair.aId];
        const key = pairKey(a, b);
        if (input.decision === "clear") {
          await db.query(`delete from public.camp_dup_decisions where pair_key = $1`, [key]);
          continue;
        }
        const primary = input.decision === "duplicate" ? (pair.primaryId ?? a) : null;
        if (primary && primary !== a && primary !== b)
          throw new Error("The main account must be one of the pair");
        await db.query(
          `insert into public.camp_dup_decisions (pair_key, a_id, b_id, decision, primary_id, note, decided_by, decided_at)
           values ($1, $2, $3, $4, $5, $6, $7, now())
           on conflict (pair_key) do update set decision = excluded.decision, primary_id = excluded.primary_id,
             note = excluded.note, decided_by = excluded.decided_by, decided_at = now()`,
          [key, a, b, input.decision, primary, input.note, context.userId],
        );
        if (input.decision === "duplicate" && primary) {
          const secondary = primary === a ? b : a;
          await db.query(
            `insert into public.camp_type_changes (sw_user_id, kind, current_type, requested_type, reason, requested_by)
             select $1, 'remove', case when u.in_directory then (case when u.wh_role = 'admin' then 'admin' else 'teammate' end) else 'guest' end,
                    null, $2, $3
               from public.camp_sw_users u where u.sw_user_id = $1
             on conflict (sw_user_id, kind) where status = 'pending' do nothing`,
            [secondary, "حساب مكرر", context.userId],
          );
          messageTargets.push({ primary, secondary });
        }
      }
    });
    await audit(
      context.userId,
      `duplicates.${input.decision}`,
      input.pairs.flatMap((p) => [p.aId, p.bId]),
      { note: input.note },
    );
    await invalidate();

    let sent = 0;
    if (input.sendMessage && messageTargets.length) {
      const { loadCampModel } = await import("@/lib/camp/model.server");
      const { greetingName } = await import("@/lib/camp/automation.server");
      const { renderTemplate } = await import("@/lib/camp/cues");
      const { sendDms } = await import("@/lib/camp/messaging.server");
      const model = await loadCampModel();
      const tpl =
        (await q<{ text: string }>(`select text from public.camp_templates where key = 'P05'`))[0]
          ?.text ?? "";
      const targets = messageTargets.map(({ primary }) => {
        const account = model.accountById.get(primary);
        const person = account ? model.personByKey.get(account.personKey) : undefined;
        return {
          swUserId: primary,
          text: renderTemplate(tpl, {
            الاسم: greetingName(model, person, primary),
            "اسم الحساب": account?.name ?? "",
          }),
        };
      });
      const res = await sendDms(targets, {
        kind: "manual",
        itemKey: "P05",
        dayNo: null,
        sentBy: context.userId,
        logText: tpl,
      });
      sent = res.delivered;
    }
    return { ok: true, sent };
  });

/** FR-USR-07: add accounts to the account-type change list. */
export const addCampTypeChanges = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        items: z
          .array(
            z.object({
              swUserId: swId(),
              kind: z.enum(["type", "remove"]).default("type"),
              requestedType: accountType().nullable().default(null),
            }),
          )
          .min(1)
          .max(1000),
        reason: reason(),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    const { loadCampModel } = await import("@/lib/camp/model.server");
    const model = await loadCampModel();
    let added = 0;
    for (const item of input.items) {
      const account = model.accountById.get(item.swUserId);
      if (!account) continue;
      // An account whose expected type is set and differs goes straight to it (BR-USR-04).
      const requested = item.kind === "type" ? (item.requestedType ?? account.expectedType) : null;
      if (item.kind === "type" && (!requested || requested === account.accountType)) continue;
      const rows = await q(
        `insert into public.camp_type_changes (sw_user_id, kind, current_type, requested_type, reason, requested_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (sw_user_id, kind) where status = 'pending'
         do update set requested_type = excluded.requested_type, reason = excluded.reason,
                       requested_by = excluded.requested_by, requested_at = now()
         returning id`,
        [item.swUserId, item.kind, account.accountType, requested, input.reason, context.userId],
      );
      added += rows.length;
    }
    await audit(
      context.userId,
      "bulk.type_change",
      input.items.map((i) => i.swUserId),
      { reason: input.reason },
    );
    await invalidate();
    return { ok: true, added };
  });

export const updateCampTypeChange = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        ids: z.array(uuid()).min(1).max(1000),
        status: z.enum(["pending", "done", "cancelled"]),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    await q(
      `update public.camp_type_changes
          set status = $2, done_at = case when $2 = 'done' then now() else null end,
              done_by = case when $2 = 'done' then $3 else null end
        where id = any($1::uuid[])`,
      [input.ids, input.status, context.userId],
    );
    await audit(context.userId, `type_change.${input.status}`, input.ids);
    await invalidate();
    return { ok: true };
  });

/** FR-ATT-09: override a person's session status — reason required (M12). */
export const setCampAttendanceOverride = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        sessionId: uuid(),
        personKey: z.string().min(3).max(80),
        teamNo: z.number().int().min(0).max(999).default(0),
        status: z.enum(["present", "partial", "absent", "elsewhere", "off_platform"]).nullable(),
        reason: z.string().trim().max(500).default(""),
      })
      .refine((v) => v.status === null || v.reason.length >= 2, {
        message: "A reason is required",
        path: ["reason"],
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    if (input.status === null) {
      await q(
        `delete from public.camp_attendance_overrides where session_id = $1 and person_key = $2 and team_no = $3`,
        [input.sessionId, input.personKey, input.teamNo],
      );
    } else {
      await q(
        `insert into public.camp_attendance_overrides (session_id, person_key, team_no, status, reason, decided_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (session_id, person_key, team_no) do update set status = excluded.status, reason = excluded.reason,
           decided_by = excluded.decided_by, decided_at = now()`,
        [
          input.sessionId,
          input.personKey,
          input.teamNo,
          input.status,
          input.reason,
          context.userId,
        ],
      );
    }
    await audit(context.userId, "attendance.override", [input.personKey], {
      sessionId: input.sessionId,
      teamNo: input.teamNo,
      status: input.status,
      reason: input.reason,
    });
    await invalidate();
    return { ok: true };
  });

/** FR-ATT-04: place an unplaced (غير محدد) meeting, or undo a placement. */
export const assignCampMeetingRoom = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        meetingIds: z.array(z.string().min(1).max(64)).min(1).max(500),
        roomId: uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    await q(
      `update public.camp_meetings set room_id = $2, room_set_by = $3, room_set_at = now() where meeting_id = any($1::text[])`,
      [input.meetingIds, input.roomId, context.userId],
    );
    await audit(context.userId, "meeting.room", input.meetingIds, { roomId: input.roomId });
    await invalidate();
    return { ok: true };
  });

/** FR-REC-07: choose the library item for a meeting (or "no recording"). */
export const chooseCampLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        meetingId: z.string().min(1).max(64),
        itemId: z.string().min(1).max(64).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    if (input.itemId === null) {
      await q(
        `update public.camp_meetings set library_status = 'none', library_item_id = null, library_deep_link = null,
                library_has_recording = null where meeting_id = $1`,
        [input.meetingId],
      );
    } else {
      const { sowork } = await import("@/lib/camp/sowork.server");
      const item = await sowork.libraryItem(input.itemId, ["none"]);
      await q(
        `update public.camp_meetings set library_status = 'manual', library_item_id = $2, library_topic = $3,
                library_deep_link = $4, library_has_recording = $5, library_duration_seconds = $6,
                library_participants = $7::jsonb, library_checked_at = now()
          where meeting_id = $1`,
        [
          input.meetingId,
          item.id,
          item.topic ?? null,
          item.deepLink ?? null,
          item.hasRecording ?? null,
          item.durationSeconds,
          JSON.stringify(item.participants ?? []),
        ],
      );
    }
    await audit(context.userId, "meeting.library", [input.meetingId], { itemId: input.itemId });
    await invalidate();
    return { ok: true };
  });

/** FR-REC-03: a fresh signed video link, fetched on click and never stored. */
export const getCampRecordingUrl = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ meetingId: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ context, data: input }) => {
    await requireViewer(context);
    const { q } = await import("@/lib/camp/db.server");
    const rows = await q<{ library_item_id: string | null; library_deep_link: string | null }>(
      `select library_item_id, library_deep_link from public.camp_meetings where meeting_id = $1`,
      [input.meetingId],
    );
    const row = rows[0];
    if (!row?.library_item_id) return { videoUrl: null, deepLink: row?.library_deep_link ?? null };
    const { sowork } = await import("@/lib/camp/sowork.server");
    const item = await sowork.libraryItem(row.library_item_id, ["video"]);
    return { videoUrl: item.videoUrl ?? null, deepLink: item.deepLink ?? row.library_deep_link };
  });

/** FR-REC-05: notes summary, transcript or chat on demand. */
export const getCampMeetingNotes = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        meetingId: z.string().min(1).max(64),
        include: z.enum(["notes", "transcript", "chat"]),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireViewer(context);
    const { q } = await import("@/lib/camp/db.server");
    const rows = await q<{ library_item_id: string | null }>(
      `select library_item_id from public.camp_meetings where meeting_id = $1`,
      [input.meetingId],
    );
    const id = rows[0]?.library_item_id;
    if (!id) return { notes: [], transcript: [], chat: [] };
    const { sowork } = await import("@/lib/camp/sowork.server");
    const item = await sowork.libraryItem(id, [input.include]);
    return {
      notes: (item.noteContents ?? []).map((n) => ({
        language: n.language,
        markdown: n.contentMarkdown,
      })),
      transcript: (item.transcript?.turns ?? []).map((t) => ({
        speaker: t.speaker.name ?? t.speaker.id,
        atMs: t.atMs,
        text: t.text,
      })),
      chat: (item.chatMessages ?? []).map((m) => ({
        author: m.authorName ?? m.authorId,
        text: m.text,
        sentAt: m.sentAt,
      })),
    };
  });

/** FR-IMP-05: override an agenda item's type (null restores the automatic one). */
export const setCampSessionType = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({ sessionId: uuid(), type: z.enum(SESSION_TYPES).nullable() }).parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    await q(`update public.camp_sessions set type_override = $2 where id = $1`, [
      input.sessionId,
      input.type,
    ]);
    await audit(context.userId, "session.type", [input.sessionId], { type: input.type });
    await invalidate();
    return { ok: true };
  });

/** FR-IMP-06: the room map. */
export const saveCampRoom = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        id: uuid().nullable().default(null),
        kind: z.enum(["main_hall", "team", "committee", "other"]),
        teamNo: z.number().int().min(1).max(999).nullable().default(null),
        committeeNo: z.number().int().min(1).max(99).nullable().default(null),
        label: z.string().trim().min(1).max(120),
        topics: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
        zoneId: z.string().trim().max(120).nullable().default(null),
      })
      .refine((v) => v.kind !== "team" || v.teamNo !== null, {
        message: "Team rooms need a team number",
      })
      .refine((v) => v.kind !== "committee" || v.committeeNo !== null, {
        message: "Committee rooms need a number",
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    const params = [
      input.kind,
      input.teamNo,
      input.committeeNo,
      input.label,
      input.topics,
      input.zoneId || null,
    ];
    if (input.id) {
      await q(
        `update public.camp_rooms set kind = $2, team_no = $3, committee_no = $4, label = $5, topics = $6, zone_id = $7 where id = $1`,
        [input.id, ...params],
      );
    } else {
      await q(
        `insert into public.camp_rooms (kind, team_no, committee_no, label, topics, zone_id) values ($1, $2, $3, $4, $5, $6)`,
        params,
      );
    }
    await audit(context.userId, "room.save", [input.id ?? input.label], { ...input });
    await invalidate();
    return { ok: true };
  });

export const deleteCampRoom = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: uuid() }).parse(d))
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q, audit } = await import("@/lib/camp/db.server");
    await q(`delete from public.camp_rooms where id = $1`, [input.id]);
    await audit(context.userId, "room.delete", [input.id]);
    await invalidate();
    return { ok: true };
  });

/** §13: which committee room each team uses on a checkpoint day. */
export const saveCampCommittees = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        dayNo: z.number().int().min(1).max(60),
        assignments: z
          .array(
            z.object({
              teamNo: z.number().int().min(1).max(999),
              committeeNo: z.number().int().min(1).max(99),
            }),
          )
          .max(999),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { tx, audit } = await import("@/lib/camp/db.server");
    await tx(async (db) => {
      await db.query(`delete from public.camp_committee_teams where day_no = $1`, [input.dayNo]);
      for (const a of input.assignments) {
        await db.query(
          `insert into public.camp_committee_teams (day_no, team_no, committee_no) values ($1, $2, $3)`,
          [input.dayNo, a.teamNo, a.committeeNo],
        );
      }
    });
    await audit(context.userId, "committees.save", [String(input.dayNo)], {
      count: input.assignments.length,
    });
    await invalidate();
    return { ok: true };
  });

/** §13: team order in the day-14 judging rounds (P07). */
export const saveCampJudging = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        slots: z
          .array(
            z.object({
              teamNo: z.number().int().min(1).max(999),
              round: z.number().int().min(1).max(20),
              startsAt: z.string().datetime(),
            }),
          )
          .max(999),
      })
      .parse(d),
  )
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { tx, audit } = await import("@/lib/camp/db.server");
    await tx(async (db) => {
      await db.query(`delete from public.camp_judging_slots`);
      for (const s of input.slots) {
        await db.query(
          `insert into public.camp_judging_slots (team_no, round, starts_at) values ($1, $2, $3)`,
          [s.teamNo, s.round, s.startsAt],
        );
      }
    });
    await audit(context.userId, "judging.save", [], { count: input.slots.length });
    await invalidate();
    return { ok: true };
  });

export const acknowledgeCampAlerts = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ ids: z.array(uuid()).min(1).max(500) }).parse(d))
  .handler(async ({ context, data: input }) => {
    await requireEditor(context);
    const { q } = await import("@/lib/camp/db.server");
    await q(
      `update public.camp_alerts set acknowledged_at = now(), acknowledged_by = $2 where id = any($1::uuid[])`,
      [input.ids, context.userId],
    );
    return { ok: true };
  });

/**
 * Library items around a meeting, live from SoWork, for linking one by hand
 * when automatic matching found none or several (FR-REC-06/07). Read-only.
 */
export const listCampLibraryOptions = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ meetingId: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ context, data: input }): Promise<LibraryOption[]> => {
    await requireViewer(context);
    const { q } = await import("@/lib/camp/db.server");
    const { sowork } = await import("@/lib/camp/sowork.server");
    const rows = await q<{ started_at: Date; ended_at: Date | null }>(
      `select started_at, ended_at from public.camp_meetings where meeting_id = $1`,
      [input.meetingId],
    );
    const meeting = rows[0];
    if (!meeting) throw new Error("Meeting not found");
    const accounts = new Set(
      (
        await q<{ sw_user_id: string }>(
          `select sw_user_id from public.camp_meeting_users where meeting_id = $1
           union select sw_user_id from public.camp_intervals where meeting_id = $1`,
          [input.meetingId],
        )
      ).map((r) => r.sw_user_id),
    );
    const since = Math.floor(meeting.started_at.getTime() / 1000) - 15 * 60;
    const until = Math.floor((meeting.ended_at ?? new Date()).getTime() / 1000) + 15 * 60;
    const taken = new Map(
      (
        await q<{ library_item_id: string; meeting_id: string }>(
          `select library_item_id, meeting_id from public.camp_meetings
            where library_item_id is not null and meeting_id <> $1`,
          [input.meetingId],
        )
      ).map((r) => [r.library_item_id, r.meeting_id]),
    );
    const out: LibraryOption[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page += 1) {
      const res = await sowork.library({ since, until, limit: 50, cursor });
      for (const it of res.items) {
        const ids = (it.participants ?? []).map((p) => p.id);
        out.push({
          itemId: it.id,
          topic: it.topic ?? null,
          startedAt: it.startedAt * 1000,
          endedAt: it.endedAt ? it.endedAt * 1000 : null,
          participants: ids.length,
          shared: ids.filter((id) => accounts.has(id)).length,
          hasRecording: it.hasRecording ?? null,
          takenBy: taken.get(it.id) ?? null,
        });
      }
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return out.sort((a, b) => b.shared - a.shared || a.startedAt - b.startedAt);
  });
