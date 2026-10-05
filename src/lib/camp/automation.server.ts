/**
 * Camp operations — what the tick does after it has synced.
 *
 *   bookkeeping   naming history (FR-NAM-05/06), type changes that SoWork now
 *                 shows as applied (FR-USR-08)
 *   alerts        A01–A09 (§9) recorded in camp_alerts; shown on the dashboard
 *                 whether or not sending is on
 *   sending       ONLY when settings.sendingEnabled: scheduled cues (S00–S23),
 *                 personal nudges (P01–P07), alert DMs to operators on duty,
 *                 and the daily summary post
 *
 * Every trigger is time-boxed (e.g. "10 minutes into a session" is checked in
 * the window 10–20 minutes in), so a tick that was down does not fire stale
 * nudges an hour late. Every send carries a dedupe key.
 */
import { SESSION_TYPE_DEFS } from "./agenda";
import {
  absentTwoDays,
  expectedRoomIds,
  isExpected,
  overlapMs,
  type AttPerson,
} from "./attendance";
import {
  invalidateAttendance,
  loadAttendance,
  todayRates,
  type AttendanceData,
} from "./attendance.server";
import { ALERT_TITLE_AR, MAIN_HALL_AR, TEAM_ROOM_AR, type AlertCode } from "./copy-ar";
import { cueRunsOn, cueTimeOn, isDue, renderTemplate, type CueLite } from "./cues";
import { getState, q, setState } from "./db.server";
import { broadcast, npcWayfinding, nudgesToday, sendDms } from "./messaging.server";
import {
  invalidateCampModel,
  loadCampModel,
  type CampModel,
  type ModelPerson,
} from "./model.server";
import type { CampSettings } from "./settings";
import { sowork } from "./sowork.server";
import { addDays, daysBetween, formatDateAr, formatTimeAr, riyadhDate, riyadhHHMM } from "./text";

const MINUTE = 60_000;

export function campDayOf(settings: CampSettings, now: number): number | null {
  const day = daysBetween(settings.startDate, riyadhDate(now)) + 1;
  return day >= 1 && day <= settings.dayCount ? day : null;
}

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

async function namingBookkeeping(model: CampModel, dayNo: number | null): Promise<number> {
  const rows = model.accounts.map((a) => ({
    id: a.swUserId,
    status: a.naming,
    issues: a.issues,
    name: a.name,
  }));
  if (!rows.length) return 0;
  const json = JSON.stringify(rows);
  if (dayNo !== null) {
    await q(
      `insert into public.camp_naming_daily (day_no, sw_user_id, status, issues, name, updated_at)
       select $1, x.id, x.status, coalesce(array(select jsonb_array_elements_text(x.issues)), '{}'), x.name, now()
         from jsonb_to_recordset($2::jsonb) as x(id text, status text, issues jsonb, name text)
       on conflict (day_no, sw_user_id) do update set status = excluded.status, issues = excluded.issues,
         name = excluded.name, updated_at = now()`,
      [dayNo, json],
    );
  }
  await q(
    `insert into public.camp_name_tracking (sw_user_id, first_violation_at, fixed_at, last_status, last_name, updated_at)
     select x.id, case when x.status = 'violation' then now() end, null, x.status, x.name, now()
       from jsonb_to_recordset($1::jsonb) as x(id text, status text, name text)
     on conflict (sw_user_id) do update set
       first_violation_at = coalesce(camp_name_tracking.first_violation_at,
                                     case when excluded.last_status = 'violation' then now() end),
       fixed_at = case when excluded.last_status = 'violation' then null
                       when camp_name_tracking.last_status = 'violation' then now()
                       else camp_name_tracking.fixed_at end,
       last_status = excluded.last_status,
       last_name = excluded.last_name,
       updated_at = now()`,
    [json],
  );
  return rows.length;
}

/** FR-USR-08: a requested change is done once the API shows it. */
async function typeChangeBookkeeping(model: CampModel): Promise<number> {
  let done = 0;
  for (const change of model.typeChanges) {
    if (change.status !== "pending") continue;
    const account = model.accountById.get(change.swUserId);
    const applied =
      change.kind === "type"
        ? !!account && !!change.requestedType && account.accountType === change.requestedType
        : // Removed: gone from the member list and silent since the request.
          !!account &&
          account.accountType === "guest" &&
          (!account.lastActivityAt || account.lastActivityAt < change.requestedAt);
    if (!applied) continue;
    await q(
      `update public.camp_type_changes set status = 'done', done_at = now(), done_by = 'auto' where id = $1 and status = 'pending'`,
      [change.id],
    );
    done += 1;
  }
  return done;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

async function raise(
  code: AlertCode,
  dedupeKey: string,
  detail: Record<string, unknown>,
  dayNo: number | null,
  silent = false,
) {
  const rows = await q<{ id: string }>(
    `insert into public.camp_alerts (code, title, detail, dedupe_key, day_no, acknowledged_at, notified_at)
     values ($1, $2, $3::jsonb, $4, $5, $6, $6) on conflict (dedupe_key) do nothing returning id`,
    [
      code,
      ALERT_TITLE_AR[code],
      JSON.stringify(detail),
      dedupeKey,
      dayNo,
      silent ? new Date().toISOString() : null,
    ],
  );
  return rows.length;
}

const UNLISTED = new Set(["expert", "speaker", "supervisor"]);

function roomLabelFor(data: AttendanceData, roomId: string | undefined): string {
  return (roomId && data.roomById.get(roomId)?.label) || "";
}

function teamRoomId(data: AttendanceData, teamNo: number): string | undefined {
  return data.rooms.find((r) => r.kind === "team" && r.teamNo === teamNo)?.id;
}

/** Did anyone in `people` spend any time in `roomId` between `from` and `to`? */
function someoneIn(
  data: AttendanceData,
  people: readonly AttPerson[],
  roomId: string,
  from: number,
  to: number,
): boolean {
  return people.some(
    (p) => overlapMs(data.ctx.roomIntervals.get(p.key)?.get(roomId) ?? [], from, to) >= MINUTE,
  );
}

async function detectAlerts(
  model: CampModel,
  data: AttendanceData,
  now: number,
  dayNo: number | null,
  agendaHours: boolean,
): Promise<number> {
  const settings = model.settings;
  let raised = 0;
  // The first run records what already exists as seen, silently: go-live must
  // not DM the operators sixty "new" alerts about week-old accounts. An
  // applied registry import re-arms it: a new registry changes many accounts'
  // naming and registry match at once, and that is not sixty new incidents.
  const baseline = await getState<{ at: string; rearm?: boolean }>("alerts_baseline");
  const silent = !baseline || !!baseline.rearm;

  // A04 / A06 — accounts; A05 — pairs.
  const registryLoaded = model.registry.length > 0;
  for (const a of model.accounts) {
    if (a.naming === "violation") {
      raised += await raise(
        "A04",
        `A04:${a.swUserId}`,
        { swUserId: a.swUserId, name: a.name, issues: a.issues },
        dayNo,
        silent,
      );
    }
    if (
      registryLoaded &&
      a.matchState === "not_in_registry" &&
      a.lastActivityAt &&
      !UNLISTED.has(a.eventRole)
    ) {
      raised += await raise(
        "A06",
        `A06:${a.swUserId}`,
        { swUserId: a.swUserId, name: a.name },
        dayNo,
        silent,
      );
    }
  }
  for (const pair of model.pairs) {
    if (pair.level === "lookalike" || model.decisions.has(pair.key)) continue;
    raised += await raise(
      "A05",
      `A05:${pair.key}`,
      {
        pairKey: pair.key,
        a: model.accountById.get(pair.aId)?.name ?? pair.aId,
        b: model.accountById.get(pair.bId)?.name ?? pair.bId,
        level: pair.level,
        score: pair.score,
      },
      dayNo,
      silent,
    );
  }
  if (silent)
    await setState("alerts_baseline", {
      at: baseline?.at ?? new Date(now).toISOString(),
      rearm: false,
    });

  // A07 — the event feed went quiet during agenda hours.
  if (agendaHours) {
    const cursor = await getState<{ lastEventAt?: string }>("events_cursor");
    const last = cursor?.lastEventAt ? Date.parse(cursor.lastEventAt) : 0;
    if (now - last > settings.eventSilenceMinutes * MINUTE) {
      const bucket = Math.floor(now / (30 * MINUTE));
      raised += await raise(
        "A07",
        `A07:${bucket}`,
        { lastEventAt: cursor?.lastEventAt ?? null },
        dayNo,
      );
    }
  }

  if (dayNo === null) return raised;
  const today = data.sessions.filter((s) => s.dayNo === dayNo);
  const participants = data.persons.filter((p) => p.role === "participant" && p.teamNo !== null);
  const teamsWithMembers = [...new Set(participants.map((p) => p.teamNo!))].sort((a, b) => a - b);

  for (const s of today) {
    const sinceStart = now - s.start;
    // A01 / A02 — 10 minutes into mentoring (A02 also pitch coaching).
    if (sinceStart >= 10 * MINUTE && sinceStart < 30 * MINUTE && now < s.end) {
      if (s.type === "mentoring") {
        for (const guider of data.persons.filter((p) => p.role === "guider")) {
          for (const teamNo of guider.guiderTeams) {
            const roomId = teamRoomId(data, teamNo);
            if (!roomId || someoneIn(data, [guider], roomId, s.start, now)) continue;
            raised += await raise(
              "A01",
              `A01:${s.id}:${guider.key}:${teamNo}`,
              { sessionId: s.id, guider: guider.name, teamNo },
              dayNo,
            );
          }
        }
      }
      if (s.type === "mentoring" || s.type === "pitch_coaching") {
        for (const teamNo of teamsWithMembers) {
          const roomId = teamRoomId(data, teamNo);
          if (!roomId || someoneIn(data, data.persons, roomId, s.start, now)) continue;
          raised += await raise(
            "A02",
            `A02:${s.id}:${teamNo}`,
            { sessionId: s.id, session: s.title, teamNo },
            dayNo,
          );
        }
      }
    }
    // A03 — attendance below the threshold N minutes in.
    const after = settings.lowAttendanceAfterMinutes * MINUTE;
    if (s.counted && sinceStart >= after && sinceStart < after + 15 * MINUTE && now < s.end) {
      const session = data.attSessions.find((x) => x.id === s.id)!;
      let expected = 0;
      let here = 0;
      for (const p of participants) {
        if (!isExpected(p, session, settings.everyoneIncludesEnablers)) continue;
        expected += 1;
        const rooms = expectedRoomIds(p, session, data.ctx.rooms, data.ctx.committeeOfTeam);
        if (
          rooms.some(
            (id) =>
              overlapMs(data.ctx.roomIntervals.get(p.key)?.get(id) ?? [], s.start, now) >= MINUTE,
          )
        )
          here += 1;
      }
      const pct = expected ? Math.round((here / expected) * 100) : 100;
      if (expected && pct < settings.lowAttendancePercent) {
        raised += await raise(
          "A03",
          `A03:${s.id}`,
          { sessionId: s.id, session: s.title, percent: pct, expected, here },
          dayNo,
        );
      }
    }
    // A08 — no recording 30 minutes after a counted session ended.
    if (s.counted && now - s.end >= 30 * MINUTE && now - s.end < 120 * MINUTE) {
      const where = SESSION_TYPE_DEFS[s.type].where;
      const kinds =
        where === "main_hall"
          ? ["main_hall"]
          : where === "team_rooms"
            ? ["team"]
            : where === "committee_rooms"
              ? ["committee"]
              : [];
      const meetings = [...data.meetings.values()].filter((m) => {
        const roomId = data.placements.get(m.meeting_id)?.roomId;
        const room = roomId ? data.roomById.get(roomId) : undefined;
        const e = m.ended_at?.getTime() ?? now;
        return !!room && kinds.includes(room.kind) && m.started_at.getTime() < s.end && e > s.start;
      });
      if (meetings.length && !meetings.some((m) => m.library_has_recording)) {
        raised += await raise(
          "A08",
          `A08:${s.id}`,
          { sessionId: s.id, session: s.title, meetings: meetings.length },
          dayNo,
        );
      }
    }
  }

  // A09 — the daily summary (recorded always; posted only when sending is on).
  const summaryTime =
    dayNo === settings.dayCount ? settings.lastDaySummaryTime : settings.dailySummaryTime;
  if (isDue(summaryTime, riyadhHHMM(now), 20)) {
    const rates = todayRates(data, dayNo);
    const fixed = model.accounts.filter(
      (a) => a.nameFixedAt && riyadhDate(Date.parse(a.nameFixedAt)) === riyadhDate(now),
    ).length;
    const openDuplicates = model.pairs.filter(
      (p) => p.level !== "lookalike" && !model.decisions.has(p.key),
    ).length;
    raised += await raise(
      "A09",
      `A09:${dayNo}`,
      {
        participantRate: rates.participantRate.rate,
        enablerRate: rates.enablerRate.rate,
        guiderCoverage: rates.guiderCoverage,
        namesFixed: fixed,
        openDuplicates,
      },
      dayNo,
    );
  }
  return raised;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

type CueDb = {
  key: string;
  time_of_day: string;
  end_time: string | null;
  days: number[];
  disabled_days: number[];
  day_times: Record<string, string>;
  channel: "channel" | "gong" | "announcement" | "npc";
  text: string;
  enabled: boolean;
};

export async function loadCues(): Promise<
  (CueLite & { channel: CueDb["channel"]; text: string })[]
> {
  const rows = await q<CueDb>(`select * from public.camp_cues order by sort, key`);
  return rows.map((c) => ({
    key: c.key,
    timeOfDay: String(c.time_of_day).slice(0, 5),
    endTime: c.end_time ? String(c.end_time).slice(0, 5) : null,
    days: c.days,
    disabledDays: c.disabled_days,
    dayTimes: c.day_times ?? {},
    enabled: c.enabled,
    channel: c.channel,
    text: c.text,
  }));
}

/** The office's default public channel, remembered once found. */
async function defaultChannelId(settings: CampSettings): Promise<string | null> {
  if (settings.announcementChannelId) return settings.announcementChannelId;
  const cached = await getState<{ id: string }>("default_channel");
  if (cached?.id) return cached.id;
  const { channels } = await sowork.channels();
  const pick =
    channels.find((c) => c.type === "public" && c.name === "general") ??
    channels.find((c) => c.type === "public");
  if (pick) await setState("default_channel", { id: pick.id });
  return pick?.id ?? null;
}

/** "{الفقرات وأوقاتها}" for S00: the day's counted items with their times. */
export function agendaLine(data: AttendanceData, dayNo: number): string {
  return data.sessions
    .filter((s) => s.dayNo === dayNo && s.counted)
    .map((s) => `${s.title} ${formatTimeAr(s.start)}`)
    .join("، ");
}

export function dayDate(
  settings: CampSettings,
  data: AttendanceData | null,
  dayNo: number,
): string {
  return data?.days.find((d) => d.dayNo === dayNo)?.date ?? addDays(settings.startDate, dayNo - 1);
}

async function runCues(
  settings: CampSettings,
  data: AttendanceData,
  now: number,
  dayNo: number,
): Promise<number> {
  const cues = await loadCues();
  const nowHHMM = riyadhHHMM(now);
  let sent = 0;
  for (const cue of cues) {
    if (!cueRunsOn(cue, dayNo)) continue;
    const time = cueTimeOn(cue, dayNo);
    if (cue.channel === "npc") {
      if (isDue(time, nowHHMM, 5)) {
        if (!settings.mainHallZoneId) continue;
        const res = await npcWayfinding(
          { show: true, text: cue.text, zoneId: settings.mainHallZoneId },
          {
            npcId: settings.wayfindingNpcId || null,
            dayNo,
            dedupeKey: `cue:${cue.key}:${dayNo}`,
            itemKey: cue.key,
          },
        );
        if (res.npcId && res.npcId !== settings.wayfindingNpcId) {
          await q(
            `update public.camp_settings set settings = settings || jsonb_build_object('wayfindingNpcId', $1::text) where id`,
            [res.npcId],
          );
        }
        if (res.outcome.status === "sent") sent += 1;
      }
      if (cue.endTime && isDue(cue.endTime, nowHHMM, 10)) {
        const res = await npcWayfinding(
          { show: false },
          {
            npcId: settings.wayfindingNpcId || null,
            dayNo,
            dedupeKey: `cue:${cue.key}:${dayNo}:end`,
            itemKey: cue.key,
          },
        );
        if (res.outcome.status === "sent") sent += 1;
      }
      continue;
    }
    if (!isDue(time, nowHHMM, 5)) continue;
    const text = renderTemplate(cue.text, {
      التاريخ: formatDateAr(dayDate(settings, data, dayNo)),
      "الفقرات وأوقاتها": agendaLine(data, dayNo),
    });
    const res = await broadcast(cue.channel, text, {
      kind: "cue",
      itemKey: cue.key,
      dayNo,
      dedupeKey: `cue:${cue.key}:${dayNo}`,
      sentBy: null,
      channelId:
        cue.channel === "channel" ? ((await defaultChannelId(settings)) ?? undefined) : undefined,
    });
    if (res.status === "sent") sent += 1;
  }
  return sent;
}

/** The account a person is messaged on: the most recently active one. */
export function dmAccountOf(model: CampModel, person: ModelPerson | undefined): string | null {
  if (!person) return null;
  const accounts = person.accountIds
    .map((id) => model.accountById.get(id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
  return accounts[0]?.swUserId ?? null;
}

/** {الاسم}: the registered name, else the name part of the account. */
export function greetingName(
  model: CampModel,
  person: ModelPerson | undefined,
  swUserId: string,
): string {
  return person?.registryId
    ? person.name
    : model.accountById.get(swUserId)?.namePart || person?.name || "";
}

async function templates(): Promise<Map<string, { text: string; enabled: boolean }>> {
  const rows = await q<{ key: string; text: string; enabled: boolean }>(
    `select key, text, enabled from public.camp_templates`,
  );
  return new Map(rows.map((r) => [r.key, { text: r.text, enabled: r.enabled }]));
}

async function runNudges(
  model: CampModel,
  data: AttendanceData,
  now: number,
  dayNo: number,
): Promise<number> {
  const settings = model.settings;
  const tpl = await templates();
  const on = (key: string) => tpl.get(key)?.enabled === true;
  // FR-NOT-04: none during breaks.
  const inBreak = data.sessions.some(
    (s) => s.dayNo === dayNo && s.type === "break" && s.start <= now && now < s.end,
  );
  if (inBreak) return 0;
  const counts = await nudgesToday(dayNo);
  let sent = 0;

  const send = async (
    key: string,
    person: ModelPerson | undefined,
    vars: Record<string, string | number>,
    dedupe: string,
    templateKey = key,
  ) => {
    const account = dmAccountOf(model, person);
    if (!account) return;
    if ((counts.get(account) ?? 0) >= settings.maxNudgesPerDay) return;
    const text = renderTemplate(tpl.get(templateKey)?.text ?? "", {
      الاسم: greetingName(model, person, account),
      ...vars,
    });
    const res = await sendDms([{ swUserId: account, text }], {
      kind: "nudge",
      itemKey: key,
      dayNo,
      dedupeKey: dedupe,
      sentBy: null,
    });
    if (res.status === "sent") {
      counts.set(account, (counts.get(account) ?? 0) + 1);
      sent += 1;
    }
  };

  const today = data.sessions.filter((s) => s.dayNo === dayNo);
  const grid = data.grid();
  for (const s of today) {
    const sinceStart = now - s.start;
    if (!(sinceStart >= 10 * MINUTE && sinceStart < 20 * MINUTE && now < s.end)) continue;
    const att = data.attSessions.find((x) => x.id === s.id)!;
    // P01 — expected participant not in the room.
    if (on("P01") && s.counted) {
      for (const p of data.persons) {
        if (p.role !== "participant" || !grid.get(s.id)?.has(p.key)) continue;
        const rooms = expectedRoomIds(p, att, data.ctx.rooms, data.ctx.committeeOfTeam);
        if (!rooms.length) continue;
        const here = rooms.some(
          (id) =>
            overlapMs(data.ctx.roomIntervals.get(p.key)?.get(id) ?? [], s.start, now) >= MINUTE,
        );
        if (here) continue;
        const place =
          SESSION_TYPE_DEFS[s.type].where === "main_hall"
            ? MAIN_HALL_AR
            : roomLabelFor(data, rooms[0]);
        await send(
          "P01",
          model.personByKey.get(p.key),
          { الفقرة: s.title, الوقت: formatTimeAr(s.start), المكان: place },
          `P01:${s.id}:${p.key}`,
        );
      }
    }
    // P02 — guider not in an assigned team's room.
    if (on("P02") && s.type === "mentoring") {
      for (const g of data.persons.filter((p) => p.role === "guider")) {
        for (const teamNo of g.guiderTeams) {
          const roomId = teamRoomId(data, teamNo);
          if (!roomId || someoneIn(data, [g], roomId, s.start, now)) continue;
          await send(
            "P02",
            model.personByKey.get(g.key),
            { الرقم: teamNo },
            `P02:${s.id}:${g.key}:${teamNo}`,
          );
        }
      }
    }
    // P03 — team room empty: the team leader.
    if (on("P03") && (s.type === "mentoring" || s.type === "pitch_coaching")) {
      const leaders = model.registry.filter(
        (r) => r.kind === "participant" && r.title === "leader" && r.teamNo !== null,
      );
      for (const leader of leaders) {
        const roomId = teamRoomId(data, leader.teamNo!);
        if (!roomId || someoneIn(data, data.persons, roomId, s.start, now)) continue;
        await send(
          "P03",
          model.personByKey.get(`p:${leader.id}`),
          { الفقرة: s.title, الرقم: leader.teamNo! },
          `P03:${s.id}:${leader.teamNo}`,
        );
      }
    }
  }

  // P04 — naming: daily reminder, at most N naming messages per account in all.
  if (on("P04")) {
    const reminderDue = isDue(settings.namingReminderTime, riyadhHHMM(now), 10);
    const namingCounts = new Map(
      (
        await q<{ sw: string; n: string }>(
          `select r as sw, count(*)::text as n from public.camp_send_log, unnest(recipients) as r
            where item_key in ('M01', 'M02', 'P04') and status in ('sent', 'partial') group by r`,
        )
      ).map((r) => [r.sw, Number(r.n)]),
    );
    const baseline = await getState<{ at: string }>("alerts_baseline");
    for (const a of model.accounts) {
      if (a.naming !== "violation" || !a.suggestedName) continue;
      if ((namingCounts.get(a.swUserId) ?? 0) >= settings.namingReminderMax) continue;
      const becameNow =
        !!baseline &&
        Date.parse(a.firstSeenAt) > Date.parse(baseline.at) &&
        !!a.firstViolationAt &&
        now - Date.parse(a.firstViolationAt) < 30 * MINUTE;
      if (!reminderDue && !becameNow) continue;
      const templateKey = a.eventRole === "participant" ? "M01" : "M02";
      const person = model.personByKey.get(a.personKey);
      if ((counts.get(a.swUserId) ?? 0) >= settings.maxNudgesPerDay) continue;
      const text = renderTemplate(tpl.get(templateKey)?.text ?? "", {
        الاسم: greetingName(model, person, a.swUserId),
        "الاسم المقترح": a.suggestedName,
      });
      const res = await sendDms([{ swUserId: a.swUserId, text }], {
        kind: "nudge",
        itemKey: "P04",
        dayNo,
        dedupeKey: `P04:${a.swUserId}:${dayNo}`,
        sentBy: null,
      });
      if (res.status === "sent") {
        counts.set(a.swUserId, (counts.get(a.swUserId) ?? 0) + 1);
        sent += 1;
      }
    }
  }

  // P06 — absent from every counted session two days running (after the summary time).
  if (on("P06") && isDue(settings.dailySummaryTime, riyadhHHMM(now), 20)) {
    const counted = data.attSessions.filter((s) => SESSION_TYPE_DEFS[s.type].counted);
    for (const x of absentTwoDays(counted, data.persons, grid)) {
      if (x.days[1] !== dayNo) continue;
      await send("P06", model.personByKey.get(x.personKey), {}, `P06:${x.personKey}:${dayNo}`);
    }
  }

  // P07 — day 14, ten minutes before the team's judging round.
  if (on("P07") && dayNo === settings.dayCount) {
    for (const slot of data.judging) {
      const at = Date.parse(slot.startsAt);
      if (!(now >= at - 10 * MINUTE && now < at)) continue;
      for (const p of data.persons.filter(
        (x) => x.role === "participant" && x.teamNo === slot.teamNo,
      )) {
        await send(
          "P07",
          model.personByKey.get(p.key),
          { الوقت: formatTimeAr(at) },
          `P07:${slot.teamNo}:${p.key}`,
        );
      }
    }
  }
  return sent;
}

/** FR-NOT-06: new alerts to the operators on duty, batched into one DM per tick. */
async function notifyOperators(settings: CampSettings, dayNo: number | null): Promise<number> {
  const alerts = await q<{
    id: string;
    code: string;
    title: string;
    detail: Record<string, unknown>;
    day_no: number | null;
  }>(
    `select id, code, title, detail, day_no from public.camp_alerts
      where notified_at is null and acknowledged_at is null and created_at > now() - interval '2 hours'
      order by created_at limit 30`,
  );
  if (!alerts.length) return 0;
  const onDuty = await q<{ sw_user_id: string }>(
    `select sw_user_id from public.camp_operators where on_duty and sw_user_id is not null`,
  );
  const recipients = [
    ...new Set([...settings.alertRecipientIds, ...onDuty.map((o) => o.sw_user_id)]),
  ];
  if (!recipients.length) return 0;
  const lines = alerts.map((a) =>
    a.code === "A09"
      ? summaryText(a.day_no ?? dayNo ?? 0, a.detail)
      : `- ${a.title}${describe(a.detail)}`,
  );
  const text = `تنبيهات لوحة متابعة المعسكر:\n${lines.join("\n")}`;
  const res = await sendDms(
    recipients.map((swUserId) => ({ swUserId, text })),
    {
      kind: "alert",
      itemKey: alerts.length === 1 ? alerts[0]!.code : "alerts",
      dayNo,
      sentBy: null,
    },
  );
  if (res.delivered > 0) {
    await q(`update public.camp_alerts set notified_at = now() where id = any($1::uuid[])`, [
      alerts.map((a) => a.id),
    ]);
  }
  return res.delivered;
}

function describe(detail: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof detail.session === "string") parts.push(detail.session);
  if (typeof detail.teamNo === "number") parts.push(`الفريق ${detail.teamNo}`);
  if (typeof detail.guider === "string") parts.push(detail.guider);
  if (typeof detail.name === "string") parts.push(detail.name);
  if (typeof detail.a === "string" && typeof detail.b === "string")
    parts.push(`${detail.a} / ${detail.b}`);
  if (typeof detail.percent === "number") parts.push(`${detail.percent}%`);
  return parts.length ? `: ${parts.join("، ")}` : "";
}

/** A09 text, also used by the "send summary now" action. */
export function summaryText(dayNo: number, detail: Record<string, unknown>): string {
  const pct = (v: unknown) => (typeof v === "number" ? `${v}%` : "—");
  const cov = detail.guiderCoverage as { covered: number; total: number } | undefined;
  return [
    `ملخص اليوم ${dayNo}:`,
    `نسبة حضور المشاركين ${pct(detail.participantRate)}`,
    `نسبة حضور الممكّنين ${pct(detail.enablerRate)}`,
    `تغطية المرشدين ${cov ? `${cov.covered} من ${cov.total}` : "—"}`,
    `الأسماء المصححة ${detail.namesFixed ?? 0}`,
    `الحسابات المكررة المفتوحة ${detail.openDuplicates ?? 0}`,
  ].join("\n");
}

async function postDailySummary(settings: CampSettings, dayNo: number): Promise<number> {
  const rows = await q<{ id: string; detail: Record<string, unknown> }>(
    `select id, detail from public.camp_alerts where dedupe_key = $1`,
    [`A09:${dayNo}`],
  );
  const row = rows[0];
  if (!row) return 0;
  const text = summaryText(dayNo, row.detail);
  let sent = 0;
  if (settings.summaryChannelId) {
    const res = await broadcast("channel", text, {
      kind: "summary",
      itemKey: "A09",
      dayNo,
      dedupeKey: `summary:${dayNo}`,
      sentBy: null,
      channelId: settings.summaryChannelId,
    });
    if (res.status === "sent") sent += 1;
  }
  return sent;
}

// ---------------------------------------------------------------------------

export async function runAutomation(
  settings: CampSettings,
  opts: { now: number; agendaHours: boolean },
) {
  // The sync steps just wrote; read fresh.
  invalidateCampModel();
  invalidateAttendance();
  const model = await loadCampModel();
  const dayNo = campDayOf(settings, opts.now);
  const result: Record<string, number> = {};
  result.naming = await namingBookkeeping(model, dayNo);
  result.typeChanges = await typeChangeBookkeeping(model);
  const data = await loadAttendance();
  result.alerts = await detectAlerts(model, data, opts.now, dayNo, opts.agendaHours);
  if (!settings.sendingEnabled || dayNo === null) return result;
  result.cues = await runCues(settings, data, opts.now, dayNo);
  result.nudges = await runNudges(model, data, opts.now, dayNo);
  result.operatorDms = await notifyOperators(settings, dayNo);
  result.summary = await postDailySummary(settings, dayNo);
  return result;
}

export { TEAM_ROOM_AR };
