/**
 * Camp operations — attendance assembly (Module 4 server side).
 *
 * Loads meetings, intervals, presence and working hours once, places every
 * meeting in a room, maps every interval to a merged person (BR-ATT-06), and
 * hands the pure scorer in ./attendance.ts what it needs. The views below are
 * thin projections of that one context.
 */
import { roundTeams, SESSION_TYPE_DEFS, type SessionType } from "./agenda";
import {
  absentTwoDays,
  aggregate,
  expectedRoomIds,
  guiderCoverage,
  mergeIntervals,
  overlapMs,
  overrideKey,
  placeMeetings,
  rateOf,
  scoreAll,
  summarizeSessions,
  teamDays,
  toMinutes,
  visitorsOf,
  type AttendanceContext,
  type AttPerson,
  type AttSession,
  type AttStatus,
  type Cell,
  type Grid,
  type Iv,
  type Placement,
  type Room,
} from "./attendance";
import { q } from "./db.server";
import { loadCampModel, type CampModel } from "./model.server";
import { fromRiyadh, riyadhDate } from "./text";
import type {
  AttCellDto,
  CoveragePayload,
  DayRow,
  DaySheetPayload,
  LivePayload,
  MeetingRow,
  PersonMeetingRow,
  RoomRow,
  SessionRow,
  SummaryPayload,
  WindowRow,
} from "./types";

type MeetingDb = {
  meeting_id: string;
  topic: string | null;
  status: "active" | "ended";
  started_at: Date;
  ended_at: Date | null;
  participant_count: number;
  room_id: string | null;
  library_status: MeetingRow["library"]["status"];
  library_item_id: string | null;
  library_topic: string | null;
  library_deep_link: string | null;
  library_has_recording: boolean | null;
  library_duration_seconds: number | null;
  library_candidates: MeetingRow["library"]["candidates"];
};

export type PersonInterval = Iv & { meetingId: string; accountId: string };

export type AttendanceData = {
  model: CampModel;
  now: number;
  days: DayRow[];
  sessions: SessionRow[];
  attSessions: AttSession[];
  rooms: RoomRow[];
  roomById: Map<string, RoomRow>;
  persons: AttPerson[];
  personByKey: Map<string, AttPerson>;
  meetings: Map<string, MeetingDb>;
  placements: Map<string, Placement>;
  intervalsByPerson: Map<string, PersonInterval[]>;
  workingHours: Map<
    string,
    Map<string, { clockIn: number | null; clockOut: number | null; total: number; meeting: number }>
  >;
  ctx: AttendanceContext;
  committees: { dayNo: number; teamNo: number; committeeNo: number }[];
  judging: { teamNo: number; round: number; startsAt: string }[];
  grid: () => Grid;
};

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

let cache: { at: number; data: Promise<AttendanceData> } | null = null;
const TTL_MS = 10_000;

export function invalidateAttendance(): void {
  cache = null;
}

export function loadAttendance(): Promise<AttendanceData> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = build();
  cache = { at: Date.now(), data };
  data.catch(() => {
    if (cache?.data === data) cache = null;
  });
  return data;
}

export function toSessionRow(s: {
  id: string;
  day_no: number;
  seq: number;
  starts_at: Date;
  ends_at: Date;
  title: string;
  auto_type: string;
  type_override: string | null;
}): SessionRow {
  const type = (s.type_override ?? s.auto_type) as SessionType;
  return {
    id: s.id,
    dayNo: s.day_no,
    seq: s.seq,
    start: s.starts_at.getTime(),
    end: s.ends_at.getTime(),
    title: s.title,
    autoType: s.auto_type as SessionType,
    typeOverride: (s.type_override as SessionType | null) ?? null,
    type,
    counted: SESSION_TYPE_DEFS[type]?.counted ?? false,
  };
}

async function build(): Promise<AttendanceData> {
  const model = await loadCampModel();
  const now = Date.now();
  const [
    days,
    sessions,
    rooms,
    committees,
    judging,
    overrides,
    meetings,
    intervals,
    meetingUsers,
    presence,
    wh,
  ] = await Promise.all([
    q<{ day_no: number; date: Date | string; phase: string | null; header: string | null }>(
      `select day_no, to_char(date, 'YYYY-MM-DD') as date, phase, header from public.camp_days order by day_no`,
    ),
    q<Parameters<typeof toSessionRow>[0]>(
      `select id, day_no, seq, starts_at, ends_at, title, auto_type, type_override
           from public.camp_sessions order by starts_at, seq`,
    ),
    q<{
      id: string;
      kind: RoomRow["kind"];
      team_no: number | null;
      committee_no: number | null;
      label: string;
      topics: string[];
      zone_id: string | null;
    }>(
      `select id, kind, team_no, committee_no, label, topics, zone_id from public.camp_rooms
          order by case kind when 'main_hall' then 0 when 'committee' then 1 when 'team' then 2 else 3 end, committee_no, team_no, label`,
    ),
    q<{ day_no: number; team_no: number; committee_no: number }>(
      `select day_no, team_no, committee_no from public.camp_committee_teams`,
    ),
    q<{ team_no: number; round: number; starts_at: Date }>(
      `select team_no, round, starts_at from public.camp_judging_slots order by starts_at`,
    ),
    q<{ session_id: string; person_key: string; team_no: number; status: AttStatus }>(
      `select session_id, person_key, team_no, status from public.camp_attendance_overrides`,
    ),
    q<MeetingDb>(
      `select meeting_id, topic, status, started_at, ended_at, participant_count, room_id, library_status,
                library_item_id, library_topic, library_deep_link, library_has_recording, library_duration_seconds,
                library_candidates
           from public.camp_meetings`,
    ),
    q<{ meeting_id: string; sw_user_id: string; joined_at: Date; left_at: Date | null }>(
      `select meeting_id, sw_user_id, joined_at, left_at from public.camp_intervals`,
    ),
    q<{ meeting_id: string; sw_user_id: string }>(
      `select meeting_id, sw_user_id from public.camp_meeting_users`,
    ),
    q<{ sw_user_id: string; started_at: Date; ended_at: Date | null }>(
      `select sw_user_id, started_at, ended_at from public.camp_presence_spans where availability <> 'offline'`,
    ),
    q<{
      day: string;
      sw_user_id: string;
      clock_in: Date | null;
      clock_out: Date | null;
      total_seconds: number;
      meeting_seconds: number;
    }>(
      `select to_char(day, 'YYYY-MM-DD') as day, sw_user_id, clock_in, clock_out, total_seconds, meeting_seconds
           from public.camp_working_hours`,
    ),
  ]);

  const sessionRows = sessions.map(toSessionRow);
  const attSessions: AttSession[] = sessionRows.map((s) => ({
    id: s.id,
    dayNo: s.dayNo,
    start: s.start,
    end: s.end,
    title: s.title,
    type: s.type,
    roundTeams: s.type === "judging" ? roundTeams(s.title, model.settings.teamCount) : null,
  }));
  const roomRows: RoomRow[] = rooms.map((r) => ({
    id: r.id,
    kind: r.kind,
    teamNo: r.team_no,
    committeeNo: r.committee_no,
    label: r.label,
    topics: r.topics ?? [],
    zoneId: r.zone_id,
  }));
  const pureRooms: Room[] = roomRows.map((r) => ({
    id: r.id,
    kind: r.kind,
    teamNo: r.teamNo,
    committeeNo: r.committeeNo,
    label: r.label,
    topics: r.topics,
  }));

  // Persons as the scorer sees them.
  const persons: AttPerson[] = model.persons.map((p) => ({
    key: p.key,
    name: p.name,
    role: p.role,
    teamNo: p.teamNo,
    guiderTeams: p.guiderTeams,
    accountIds: p.accountIds,
  }));
  const personByKey = new Map(persons.map((p) => [p.key, p]));
  const personOf = (accountId: string) => model.personOfAccount.get(accountId) ?? `u:${accountId}`;

  // Room placement: accounts per meeting from both intervals and API rows.
  const meetingAccounts = new Map<string, Set<string>>();
  for (const r of [...meetingUsers, ...intervals]) {
    if (!meetingAccounts.has(r.meeting_id)) meetingAccounts.set(r.meeting_id, new Set());
    meetingAccounts.get(r.meeting_id)!.add(r.sw_user_id);
  }
  const teamOfAccount = new Map<string, number>();
  for (const p of model.persons) {
    if (p.role !== "participant" || p.teamNo === null) continue;
    for (const a of p.accountIds) teamOfAccount.set(a, p.teamNo);
  }
  const placements = placeMeetings(
    meetings.map((m) => ({
      id: m.meeting_id,
      topic: m.topic,
      startedAt: m.started_at.getTime(),
      endedAt: m.ended_at?.getTime() ?? null,
      manualRoomId: m.room_id,
      accountIds: [...(meetingAccounts.get(m.meeting_id) ?? [])],
    })),
    pureRooms,
    teamOfAccount,
    {
      mixShare: model.settings.roomMixShare,
      mainHallMinParticipants: model.settings.mainHallMinParticipants,
    },
  );
  const meetingById = new Map(meetings.map((m) => [m.meeting_id, m]));

  // Intervals per person; open ones run to the meeting's end, else now.
  const intervalsByPerson = new Map<string, PersonInterval[]>();
  const roomRaw = new Map<string, Map<string, Iv[]>>();
  const meetingRaw = new Map<string, Iv[]>();
  for (const iv of intervals) {
    const meeting = meetingById.get(iv.meeting_id);
    const s = iv.joined_at.getTime();
    const e = iv.left_at?.getTime() ?? meeting?.ended_at?.getTime() ?? now;
    if (e <= s) continue;
    const key = personOf(iv.sw_user_id);
    const entry: PersonInterval = { s, e, meetingId: iv.meeting_id, accountId: iv.sw_user_id };
    pushTo(intervalsByPerson, key, entry);
    pushTo(meetingRaw, key, { s, e });
    const roomId = placements.get(iv.meeting_id)?.roomId;
    if (roomId) {
      if (!roomRaw.has(key)) roomRaw.set(key, new Map());
      pushTo(roomRaw.get(key)!, roomId, { s, e });
    }
  }
  const roomIntervals = new Map<string, Map<string, Iv[]>>();
  for (const [key, byRoom] of roomRaw) {
    roomIntervals.set(
      key,
      new Map([...byRoom].map(([room, list]) => [room, mergeIntervals(list)])),
    );
  }
  const meetingIntervals = new Map([...meetingRaw].map(([k, v]) => [k, mergeIntervals(v)]));

  const platformRaw = new Map<string, Iv[]>();
  for (const span of presence) {
    const key = personOf(span.sw_user_id);
    pushTo(platformRaw, key, { s: span.started_at.getTime(), e: span.ended_at?.getTime() ?? now });
  }
  const workingHours = new Map<
    string,
    Map<string, { clockIn: number | null; clockOut: number | null; total: number; meeting: number }>
  >();
  for (const row of wh) {
    const key = personOf(row.sw_user_id);
    const clockIn = row.clock_in?.getTime() ?? null;
    const clockOut = row.clock_out?.getTime() ?? null;
    if (clockIn !== null) {
      pushTo(platformRaw, key, { s: clockIn, e: clockOut ?? now });
    }
    if (!workingHours.has(key)) workingHours.set(key, new Map());
    const byDay = workingHours.get(key)!;
    const prev = byDay.get(row.day);
    // Two accounts of one person: earliest in, latest out, the larger total
    // (summing would double-count time both were signed in).
    byDay.set(row.day, {
      clockIn:
        prev?.clockIn != null && clockIn != null
          ? Math.min(prev.clockIn, clockIn)
          : (prev?.clockIn ?? clockIn),
      clockOut:
        prev?.clockOut != null && clockOut != null
          ? Math.max(prev.clockOut, clockOut)
          : (prev?.clockOut ?? clockOut),
      total: Math.max(prev?.total ?? 0, row.total_seconds),
      meeting: Math.max(prev?.meeting ?? 0, row.meeting_seconds),
    });
  }
  const platformIntervals = new Map([...platformRaw].map(([k, v]) => [k, mergeIntervals(v)]));

  const ctx: AttendanceContext = {
    rooms: pureRooms,
    roomIntervals,
    meetingIntervals,
    platformIntervals,
    committeeOfTeam: new Map(committees.map((c) => [`${c.day_no}:${c.team_no}`, c.committee_no])),
    overrides: new Map(
      overrides.map((o) => [overrideKey(o.session_id, o.person_key, o.team_no), o.status]),
    ),
    attendMinutes: model.settings.attendMinutes,
    lateMinutes: model.settings.lateMinutes,
    everyoneIncludesEnablers: model.settings.everyoneIncludesEnablers,
  };

  let grid: Grid | null = null;
  return {
    model,
    now,
    days: days.map((d) => ({
      dayNo: d.day_no,
      date: String(d.date),
      phase: d.phase,
      header: d.header,
    })),
    sessions: sessionRows,
    attSessions,
    rooms: roomRows,
    roomById: new Map(roomRows.map((r) => [r.id, r])),
    persons,
    personByKey,
    meetings: meetingById,
    placements,
    intervalsByPerson,
    workingHours,
    ctx,
    committees: committees.map((c) => ({
      dayNo: c.day_no,
      teamNo: c.team_no,
      committeeNo: c.committee_no,
    })),
    judging: judging.map((j) => ({
      teamNo: j.team_no,
      round: j.round,
      startsAt: j.starts_at.toISOString(),
    })),
    grid: () => (grid ??= scoreAll(persons, attSessions, ctx, now)),
  };
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

const cellDto = (c: Cell): AttCellDto => ({
  status: c.status,
  minutes: c.minutes,
  late: c.late,
  overridden: c.overridden,
  ...(c.perTeam ? { perTeam: c.perTeam } : {}),
});

function personDto(data: AttendanceData, p: AttPerson) {
  return {
    key: p.key,
    name: p.name,
    role: p.role,
    teamNo: p.teamNo,
    accountIds: p.accountIds,
    phone: data.model.personByKey.get(p.key)?.phone ?? null,
  };
}

function dayBounds(
  data: AttendanceData,
  dayNo: number,
): { date: string | null; from: number; to: number } {
  const date = data.days.find((d) => d.dayNo === dayNo)?.date ?? null;
  const base =
    date ??
    (() => {
      const start = data.model.settings.startDate;
      const t = fromRiyadh(start, "00:00").getTime() + (dayNo - 1) * 86_400_000;
      return riyadhDate(t);
    })();
  const from = fromRiyadh(base, "00:00").getTime();
  return { date: base, from, to: from + 86_400_000 };
}

/** FR-ATT-05/06 — the daily attendance sheet. */
export function daySheet(data: AttendanceData, dayNo: number): DaySheetPayload {
  const { date, from, to } = dayBounds(data, dayNo);
  const sessions = data.sessions.filter((s) => s.dayNo === dayNo);
  const grid = data.grid();
  const rows: DaySheetPayload["rows"] = [];
  for (const p of data.persons) {
    const cells: Record<string, AttCellDto> = {};
    let expected = false;
    for (const s of sessions) {
      const cell = grid.get(s.id)?.get(p.key);
      if (cell) {
        cells[s.id] = cellDto(cell);
        expected = true;
      }
    }
    const ivs = (data.intervalsByPerson.get(p.key) ?? []).filter((iv) => iv.e > from && iv.s < to);
    const wh = date ? data.workingHours.get(p.key)?.get(date) : undefined;
    if (!expected && !ivs.length && !wh) continue;
    const firstJoin = ivs.length ? Math.max(from, Math.min(...ivs.map((iv) => iv.s))) : null;
    const lastLeave = ivs.length ? Math.min(to, Math.max(...ivs.map((iv) => iv.e))) : null;
    const entryCandidates = [firstJoin, wh?.clockIn ?? null].filter((v): v is number => v !== null);
    const exitCandidates = [lastLeave, wh?.clockOut ?? null].filter((v): v is number => v !== null);
    rows.push({
      ...personDto(data, p),
      entry: entryCandidates.length ? Math.min(...entryCandidates) : null,
      exit: exitCandidates.length ? Math.max(...exitCandidates) : null,
      platformSeconds: wh?.total ?? 0,
      meetingMinutes: toMinutes(overlapMs(mergeIntervals(ivs), from, to)),
      cells,
    });
  }
  rows.sort(
    (a, b) =>
      roleRank(a.role) - roleRank(b.role) ||
      (a.teamNo ?? 999) - (b.teamNo ?? 999) ||
      a.name.localeCompare(b.name, "ar"),
  );
  return { dayNo, date, sessions, rows };
}

const ROLE_ORDER = ["participant", "guider", "coach", "expert", "speaker", "supervisor", "unknown"];
const roleRank = (role: string) => ROLE_ORDER.indexOf(role);

/** The agenda session a meeting belongs to, from the room and time overlap. */
function sessionOfMeeting(
  data: AttendanceData,
  meetingId: string,
  s: number,
  e: number,
): SessionRow | null {
  const roomId = data.placements.get(meetingId)?.roomId ?? null;
  const room = roomId ? data.roomById.get(roomId) : undefined;
  let best: { row: SessionRow; ms: number } | null = null;
  for (const row of data.sessions) {
    if (!row.counted && row.type !== "zoom") continue;
    const where = SESSION_TYPE_DEFS[row.type].where;
    const fits =
      !room ||
      (where === "main_hall" && room.kind === "main_hall") ||
      (where === "team_rooms" && room.kind === "team") ||
      (where === "committee_rooms" && room.kind === "committee");
    if (!fits) continue;
    const ms = Math.min(e, row.end) - Math.max(s, row.start);
    if (ms > 0 && (!best || ms > best.ms)) best = { row, ms };
  }
  return best?.row ?? null;
}

/** FR-ATT-06 — one person's meetings on one day. */
export function personMeetings(
  data: AttendanceData,
  personKey: string,
  dayNo: number | null,
): PersonMeetingRow[] {
  const bounds = dayNo === null ? null : dayBounds(data, dayNo);
  const byMeeting = new Map<string, PersonInterval[]>();
  for (const iv of data.intervalsByPerson.get(personKey) ?? []) {
    if (bounds && (iv.e <= bounds.from || iv.s >= bounds.to)) continue;
    pushTo(byMeeting, iv.meetingId, iv);
  }
  const grid = data.grid();
  const out: PersonMeetingRow[] = [];
  for (const [meetingId, list] of byMeeting) {
    const meeting = data.meetings.get(meetingId);
    const merged = mergeIntervals(list);
    const s = merged[0]!.s;
    const e = merged[merged.length - 1]!.e;
    const roomId = data.placements.get(meetingId)?.roomId ?? null;
    const session = sessionOfMeeting(data, meetingId, s, e);
    out.push({
      meetingId,
      topic: meeting?.topic ?? meeting?.library_topic ?? null,
      roomId,
      roomLabel: roomId ? (data.roomById.get(roomId)?.label ?? null) : null,
      sessionId: session?.id ?? null,
      sessionTitle: session?.title ?? null,
      joinedAt: s,
      leftAt: list.some((iv) => !meeting?.ended_at && iv.e >= data.now - 1000) ? null : e,
      minutes: toMinutes(merged.reduce((sum, iv) => sum + iv.e - iv.s, 0)),
      status: session ? (grid.get(session.id)?.get(personKey)?.status ?? null) : null,
      deepLink: meeting?.library_deep_link ?? null,
      hasRecording: meeting?.library_has_recording ?? null,
    });
  }
  return out.sort((a, b) => a.joinedAt - b.joinedAt);
}

/** FR-ATT-07 — any window: minutes present and meetings inside it. */
export function windowSheet(data: AttendanceData, from: number, to: number): WindowRow[] {
  const rows: WindowRow[] = [];
  for (const p of data.persons) {
    const list = (data.intervalsByPerson.get(p.key) ?? []).filter((iv) => iv.e > from && iv.s < to);
    if (!list.length) continue;
    const merged = mergeIntervals(list);
    const byMeeting = new Map<string, Iv[]>();
    for (const iv of list) pushTo(byMeeting, iv.meetingId, iv);
    rows.push({
      ...personDto(data, p),
      entry: Math.max(from, merged[0]!.s),
      minutes: toMinutes(overlapMs(merged, from, to)),
      meetings: [...byMeeting].map(([meetingId, ivs]) => {
        const roomId = data.placements.get(meetingId)?.roomId ?? null;
        return {
          meetingId,
          roomLabel: roomId ? (data.roomById.get(roomId)?.label ?? null) : null,
          minutes: toMinutes(overlapMs(mergeIntervals(ivs), from, to)),
        };
      }),
    });
  }
  return rows.sort(
    (a, b) =>
      roleRank(a.role) - roleRank(b.role) ||
      (a.teamNo ?? 999) - (b.teamNo ?? 999) ||
      a.name.localeCompare(b.name, "ar"),
  );
}

/** FR-ATT-08 — who is where now. */
export function liveView(data: AttendanceData): LivePayload {
  const now = data.now;
  const sessions = data.sessions.filter((s) => s.start <= now && s.end > now);
  const rooms = new Map<string, LivePayload["rooms"][number]>();
  const present = new Map<string, Set<string>>(); // personKey → roomIds now
  for (const [key, list] of data.intervalsByPerson) {
    for (const iv of list) {
      const meeting = data.meetings.get(iv.meetingId);
      if (!meeting || meeting.status !== "active" || !(iv.s <= now && iv.e >= now - 1000)) continue;
      const roomId = data.placements.get(iv.meetingId)?.roomId ?? null;
      const roomKey = roomId ?? "unplaced";
      if (!rooms.has(roomKey)) {
        const room = roomId ? data.roomById.get(roomId) : undefined;
        rooms.set(roomKey, {
          roomId,
          label: room?.label ?? "",
          kind: room?.kind ?? "unplaced",
          people: [],
        });
      }
      const person = data.personByKey.get(key);
      const entry = rooms.get(roomKey)!;
      if (!entry.people.some((x) => x.key === key)) {
        entry.people.push({
          key,
          name: person?.name ?? key,
          role: person?.role ?? "unknown",
          teamNo: person?.teamNo ?? null,
          since: iv.s,
        });
      }
      if (!present.has(key)) present.set(key, new Set());
      if (roomId) present.get(key)!.add(roomId);
    }
  }
  const expectedMissing = sessions
    .filter((s) => s.counted)
    .map((s) => {
      const att = data.attSessions.find((x) => x.id === s.id)!;
      const people = data.persons
        .filter((p) => {
          const grid = data.grid().get(s.id);
          if (!grid?.has(p.key)) return false;
          const want = expectedRoomIds(p, att, data.ctx.rooms, data.ctx.committeeOfTeam);
          const here = present.get(p.key);
          return !here || !want.some((id) => here.has(id));
        })
        .map((p) => {
          const here = [...(present.get(p.key) ?? [])][0];
          return {
            key: p.key,
            name: p.name,
            role: p.role,
            teamNo: p.teamNo,
            where: here ? (data.roomById.get(here)?.label ?? null) : null,
          };
        });
      return { sessionId: s.id, people };
    });
  const online = data.model.accounts.filter((a) => a.presence && a.presence !== "offline");
  return {
    now,
    sessions,
    rooms: [...rooms.values()].sort((a, b) => b.people.length - a.people.length),
    expectedMissing,
    onlineCount: new Set(online.map((a) => a.personKey)).size,
  };
}

/** FR-ATT-10..17. */
export function summary(data: AttendanceData): SummaryPayload {
  const grid = data.grid();
  const counted = data.attSessions.filter((s) => SESSION_TYPE_DEFS[s.type].counted);
  const sums = summarizeSessions(counted, data.persons, grid);
  const sumById = new Map(sums.map((s) => [s.sessionId, s]));
  const sessionRows = data.sessions.filter((s) => sumById.has(s.id));
  const phaseOf = new Map(data.days.map((d) => [d.dayNo, d.phase]));
  const days = [...new Set(sessionRows.map((s) => s.dayNo))].sort((a, b) => a - b);
  const phases = [...new Set(days.map((d) => phaseOf.get(d)).filter((p): p is string => !!p))];

  const byRole: SummaryPayload["enablersByRole"] = [];
  for (const role of ["guider", "coach", "expert", "speaker", "supervisor"] as const) {
    const people = data.persons
      .filter((p) => p.role === role)
      .map((p) => {
        const cells: Cell[] = [];
        for (const s of counted) {
          const c = grid.get(s.id)?.get(p.key);
          if (c) cells.push(c);
        }
        const ivs = data.intervalsByPerson.get(p.key) ?? [];
        const daysSeen = new Set(ivs.map((iv) => riyadhDate(iv.s))).size;
        return {
          key: p.key,
          name: p.name,
          scored: role === "guider" || role === "coach",
          rate: rateOf(cells),
          minutes: toMinutes(mergeIntervals(ivs).reduce((sum, iv) => sum + iv.e - iv.s, 0)),
          daysSeen,
        };
      });
    if (people.length) byRole.push({ role, people });
  }

  const nameOf = (key: string) => data.personByKey.get(key);
  const checkpoints = counted
    .filter((s) => s.type === "checkpoint")
    .map((s) => {
      const row = grid.get(s.id);
      const teams = new Map<number, Cell[]>();
      for (const p of data.persons) {
        if (p.role !== "participant" || p.teamNo === null) continue;
        const c = row?.get(p.key);
        if (c) pushTo(teams, p.teamNo, c);
      }
      return {
        sessionId: s.id,
        dayNo: s.dayNo,
        teams: [...teams]
          .sort((a, b) => a[0] - b[0])
          .map(([teamNo, cells]) => ({ teamNo, rate: rateOf(cells) })),
      };
    });
  const coaches = data.persons.filter((p) => p.role === "coach");
  const teamRooms = data.rooms.filter((r) => r.kind === "team" && r.teamNo !== null);
  const pitchCoaching = counted
    .filter((s) => s.type === "pitch_coaching" && s.start <= data.now)
    .map((s) => ({
      sessionId: s.id,
      dayNo: s.dayNo,
      teams: teamRooms.map((room) => {
        const visits = visitorsOf(coaches, [room.id], s, data.ctx);
        const minutes = visits.reduce((max, v) => Math.max(max, v.minutes), 0);
        return {
          teamNo: room.teamNo!,
          minutes,
          covered: minutes >= data.ctx.attendMinutes,
          coaches: visits.map((v) => nameOf(v.personKey)?.name ?? v.personKey),
        };
      }),
    }));

  return {
    sessions: sessionRows.map((s) => ({
      ...s,
      participants: sumById.get(s.id)!.participants,
      enablers: sumById.get(s.id)!.enablers,
    })),
    days: days.map((dayNo) => {
      const list = sums.filter(
        (x) => data.sessions.find((s) => s.id === x.sessionId)?.dayNo === dayNo,
      );
      return {
        dayNo,
        phase: phaseOf.get(dayNo) ?? null,
        participants: aggregate(list, "participants"),
        enablers: aggregate(list, "enablers"),
      };
    }),
    phases: phases.map((phase) => {
      const list = sums.filter(
        (x) => phaseOf.get(data.sessions.find((s) => s.id === x.sessionId)?.dayNo ?? -1) === phase,
      );
      return {
        phase,
        participants: aggregate(list, "participants"),
        enablers: aggregate(list, "enablers"),
      };
    }),
    teams: teamDays(counted, data.persons, grid),
    enablersByRole: byRole,
    absentTwoDays: absentTwoDays(counted, data.persons, grid).map((x) => {
      const p = nameOf(x.personKey);
      return {
        key: x.personKey,
        name: p?.name ?? x.personKey,
        accountIds: p?.accountIds ?? [],
        role: p?.role ?? "unknown",
        teamNo: p?.teamNo ?? null,
        days: x.days,
      };
    }),
    checkpoints,
    pitchCoaching,
  };
}

/** FR-ATT-13/14. */
export function coverage(data: AttendanceData): CoveragePayload {
  const cells = guiderCoverage(data.persons, data.attSessions, data.ctx, data.now);
  const name = (key: string) => data.personByKey.get(key)?.name ?? key;
  const days = [...new Set(cells.map((c) => c.dayNo))].sort((a, b) => a - b);
  const mentoringSessions: Record<number, string[]> = {};
  for (const s of data.attSessions)
    if (s.type === "mentoring") (mentoringSessions[s.dayNo] ??= []).push(s.id);
  const guiders = data.persons
    .filter((p) => p.role === "guider")
    .map((g) => {
      const mine = cells.filter((c) => c.guiderKey === g.key);
      const minutesByTeam = g.guiderTeams.map((teamNo) => ({
        teamNo,
        minutes: mine.filter((c) => c.teamNo === teamNo).reduce((sum, c) => sum + c.minutes, 0),
      }));
      return {
        key: g.key,
        name: g.name,
        teams: g.guiderTeams,
        covered: mine.filter((c) => c.covered).length,
        missed: mine.filter((c) => !c.covered).length,
        minutesByTeam,
      };
    });
  return {
    days,
    cells: cells.map((c) => ({ ...c, guiderName: name(c.guiderKey) })),
    guiders,
    mentoringSessions,
  };
}

/** Meetings for the room-assignment and recordings screens. */
export function meetingRows(
  data: AttendanceData,
  filter: { dayNo?: number | null; unplacedOnly?: boolean; library?: string | null },
): MeetingRow[] {
  const bounds = filter.dayNo ? dayBounds(data, filter.dayNo) : null;
  const out: MeetingRow[] = [];
  for (const m of data.meetings.values()) {
    const s = m.started_at.getTime();
    const e = m.ended_at?.getTime() ?? data.now;
    if (bounds && (s >= bounds.to || e <= bounds.from)) continue;
    const placement = data.placements.get(m.meeting_id) ?? { roomId: null, source: null };
    if (filter.unplacedOnly && placement.roomId) continue;
    if (filter.library && m.library_status !== filter.library) continue;
    const session = sessionOfMeeting(data, m.meeting_id, s, e);
    out.push({
      meetingId: m.meeting_id,
      topic: m.topic,
      status: m.status,
      startedAt: s,
      endedAt: m.ended_at?.getTime() ?? null,
      participants: m.participant_count,
      roomId: placement.roomId,
      roomLabel: placement.roomId ? (data.roomById.get(placement.roomId)?.label ?? null) : null,
      roomSource: placement.source,
      manualRoom: !!m.room_id,
      sessionId: session?.id ?? null,
      sessionTitle: session?.title ?? null,
      library: {
        status: m.library_status,
        itemId: m.library_item_id,
        topic: m.library_topic,
        deepLink: m.library_deep_link,
        hasRecording: m.library_has_recording,
        durationSeconds: m.library_duration_seconds,
        candidates: m.library_candidates ?? [],
      },
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** Overview cards for today (or the last camp day with sessions). */
export function todayRates(data: AttendanceData, dayNo: number) {
  const grid = data.grid();
  const list = summarizeSessions(
    data.attSessions.filter((s) => s.dayNo === dayNo && SESSION_TYPE_DEFS[s.type].counted),
    data.persons,
    grid,
  );
  const cov = guiderCoverage(
    data.persons,
    data.attSessions.filter((s) => s.dayNo === dayNo),
    data.ctx,
    data.now,
  );
  return {
    participantRate: aggregate(list, "participants"),
    enablerRate: aggregate(list, "enablers"),
    guiderCoverage: { covered: cov.filter((c) => c.covered).length, total: cov.length },
  };
}

export { expectedRoomIds };
