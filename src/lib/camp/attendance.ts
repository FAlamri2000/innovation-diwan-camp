/**
 * Camp operations — attendance (Module 4).
 *
 * A person attends a session when they spend `attendMinutes` (10) or more in
 * the session's room inside its time window, added across rejoins, overlaps
 * counted once (BR-ATT-01). This file places meetings in rooms (FR-ATT-04),
 * scores every expected (person, session) pair (BR-ATT-02/03/04), and builds
 * the summary views (FR-ATT-10..17). It is pure: callers hand it intervals in
 * epoch milliseconds and get plain data back.
 */
import { SESSION_TYPE_DEFS, type SessionType } from "./agenda.ts";
import type { EventRole } from "./settings.ts";
import { normalizeArabicLetters, toWesternDigits } from "./text.ts";

const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

export type Iv = { s: number; e: number };

/** Sorted, non-overlapping union. */
export function mergeIntervals(list: readonly Iv[]): Iv[] {
  const sorted = list.filter((iv) => iv.e > iv.s).sort((a, b) => a.s - b.s);
  const out: Iv[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e);
    else out.push({ s: iv.s, e: iv.e });
  }
  return out;
}

/** Milliseconds of a MERGED list inside [from, to). */
export function overlapMs(merged: readonly Iv[], from: number, to: number): number {
  let total = 0;
  for (const iv of merged) {
    if (iv.e <= from) continue;
    if (iv.s >= to) break;
    total += Math.min(iv.e, to) - Math.max(iv.s, from);
  }
  return total;
}

/** First instant of a merged list inside [from, to), or null. */
export function firstInside(merged: readonly Iv[], from: number, to: number): number | null {
  for (const iv of merged) {
    if (iv.e <= from) continue;
    if (iv.s >= to) return null;
    return Math.max(iv.s, from);
  }
  return null;
}

export const toMinutes = (ms: number): number => Math.floor(ms / MINUTE);

// ---------------------------------------------------------------------------
// Rooms and meeting placement (FR-ATT-04)
// ---------------------------------------------------------------------------

export type RoomKind = "main_hall" | "team" | "committee" | "other";

export type Room = {
  id: string;
  kind: RoomKind;
  teamNo: number | null;
  committeeNo: number | null;
  label: string;
  topics: string[];
};

export type MeetingInput = {
  id: string;
  topic: string | null;
  startedAt: number;
  endedAt: number | null;
  manualRoomId: string | null;
  accountIds: string[];
};

export type PlacementSource = "manual" | "topic" | "mix" | "size";
export type Placement = { roomId: string | null; source: PlacementSource | null };

function normTopic(value: string): string {
  return normalizeArabicLetters(toWesternDigits(value)).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Topic first, then participant mix (the team whose members are at least
 * `mixShare` of the participants), then size (a crowd is the main hall),
 * else unplaced (غير محدد) for an operator. A manual placement always wins.
 */
export function placeMeetings(
  meetings: readonly MeetingInput[],
  rooms: readonly Room[],
  teamOfAccount: ReadonlyMap<string, number>,
  opts: { mixShare: number; mainHallMinParticipants: number },
): Map<string, Placement> {
  const roomIds = new Set(rooms.map((r) => r.id));
  const topicIndex: { topic: string; roomId: string }[] = [];
  for (const room of rooms) {
    for (const topic of room.topics) {
      const t = normTopic(topic);
      if (t) topicIndex.push({ topic: t, roomId: room.id });
    }
  }
  // Longest first, so "غرفة الفريق 12" is not captured by "غرفة الفريق 1".
  topicIndex.sort((a, b) => b.topic.length - a.topic.length);
  const teamRoom = new Map<number, string>();
  for (const room of rooms)
    if (room.kind === "team" && room.teamNo !== null) teamRoom.set(room.teamNo, room.id);
  const mainHall = rooms.find((r) => r.kind === "main_hall")?.id ?? null;

  const out = new Map<string, Placement>();
  for (const meeting of meetings) {
    if (meeting.manualRoomId && roomIds.has(meeting.manualRoomId)) {
      out.set(meeting.id, { roomId: meeting.manualRoomId, source: "manual" });
      continue;
    }
    const topic = meeting.topic ? normTopic(meeting.topic) : "";
    if (topic) {
      const exact = topicIndex.find((entry) => entry.topic === topic);
      const hit = exact ?? topicIndex.find((entry) => topic.includes(entry.topic));
      if (hit) {
        out.set(meeting.id, { roomId: hit.roomId, source: "topic" });
        continue;
      }
    }
    const participants = [...new Set(meeting.accountIds)];
    if (participants.length) {
      const counts = new Map<number, number>();
      for (const id of participants) {
        const team = teamOfAccount.get(id);
        if (team !== undefined) counts.set(team, (counts.get(team) ?? 0) + 1);
      }
      let bestTeam: number | null = null;
      let bestCount = 0;
      for (const [team, count] of counts) {
        if (count > bestCount) {
          bestTeam = team;
          bestCount = count;
        }
      }
      if (
        bestTeam !== null &&
        bestCount / participants.length >= opts.mixShare &&
        teamRoom.has(bestTeam)
      ) {
        out.set(meeting.id, { roomId: teamRoom.get(bestTeam) ?? null, source: "mix" });
        continue;
      }
      if (mainHall && participants.length >= opts.mainHallMinParticipants) {
        out.set(meeting.id, { roomId: mainHall, source: "size" });
        continue;
      }
    }
    out.set(meeting.id, { roomId: null, source: null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring (BR-ATT-01..04)
// ---------------------------------------------------------------------------

export type AttStatus =
  /** حاضر */
  | "present"
  /** حضور غير محتسب */
  | "partial"
  /** غائب */
  | "absent"
  /** في غرفة أخرى */
  | "elsewhere"
  /** خارج المنصة */
  | "off_platform"
  /** not expected at this session: excluded from every rate */
  | "not_expected";

export type AttPerson = {
  key: string;
  name: string;
  role: EventRole;
  teamNo: number | null;
  /** Guiders: the teams they are assigned to. */
  guiderTeams: number[];
  accountIds: string[];
};

export type AttSession = {
  id: string;
  dayNo: number;
  start: number;
  end: number;
  title: string;
  type: SessionType;
  /** Judging rounds: the teams presenting; null = every team. */
  roundTeams: number[] | null;
};

export type Cell = {
  status: AttStatus;
  minutes: number;
  late: boolean;
  firstJoin: number | null;
  overridden: boolean;
  /** Guiders in mentoring: minutes per assigned team room. */
  perTeam?: { teamNo: number; minutes: number }[];
};

export type AttendanceContext = {
  rooms: readonly Room[];
  /** personKey → roomId → merged intervals in that room. */
  roomIntervals: ReadonlyMap<string, ReadonlyMap<string, Iv[]>>;
  /** personKey → merged intervals in any meeting (placed or not). */
  meetingIntervals: ReadonlyMap<string, Iv[]>;
  /** personKey → merged "on the platform" spans (presence + clock in/out). */
  platformIntervals: ReadonlyMap<string, Iv[]>;
  /** `${dayNo}:${teamNo}` → committee number (checkpoint days). */
  committeeOfTeam: ReadonlyMap<string, number>;
  /** `${sessionId}|${personKey}|${teamNo}` → override. */
  overrides: ReadonlyMap<string, AttStatus>;
  attendMinutes: number;
  lateMinutes: number;
  everyoneIncludesEnablers: boolean;
};

const EVERYONE_TYPES: ReadonlySet<SessionType> = new Set(["workshop", "inspirational"]);

export function overrideKey(sessionId: string, personKey: string, teamNo = 0): string {
  return `${sessionId}|${personKey}|${teamNo}`;
}

/** Is this person expected at this session at all? */
export function isExpected(
  person: AttPerson,
  session: AttSession,
  everyoneIncludesEnablers: boolean,
): boolean {
  const def = SESSION_TYPE_DEFS[session.type];
  if (!def.counted && session.type !== "zoom") return false;
  if (person.role === "participant") {
    if (session.type === "judging" && session.roundTeams && person.teamNo !== null) {
      return session.roundTeams.includes(person.teamNo);
    }
    return true;
  }
  if (person.role === "guider") {
    if (session.type === "mentoring") return person.guiderTeams.length > 0;
    return (
      everyoneIncludesEnablers && (EVERYONE_TYPES.has(session.type) || session.type === "zoom")
    );
  }
  if (person.role === "coach") {
    if (session.type === "pitch_coaching") return true;
    return (
      everyoneIncludesEnablers && (EVERYONE_TYPES.has(session.type) || session.type === "zoom")
    );
  }
  // Experts, speakers, supervisors, unknown: presence and minutes only (FR-ATT-12).
  return false;
}

/** The rooms that count for this person at this session. */
export function expectedRoomIds(
  person: AttPerson,
  session: AttSession,
  rooms: readonly Room[],
  committeeOfTeam: ReadonlyMap<string, number>,
): string[] {
  const where = SESSION_TYPE_DEFS[session.type].where;
  if (where === "main_hall") return rooms.filter((r) => r.kind === "main_hall").map((r) => r.id);
  if (where === "team_rooms") {
    if (person.role === "participant" && person.teamNo !== null) {
      return rooms.filter((r) => r.kind === "team" && r.teamNo === person.teamNo).map((r) => r.id);
    }
    if (person.role === "guider") {
      return rooms
        .filter(
          (r) => r.kind === "team" && r.teamNo !== null && person.guiderTeams.includes(r.teamNo),
        )
        .map((r) => r.id);
    }
    return rooms.filter((r) => r.kind === "team").map((r) => r.id);
  }
  if (where === "committee_rooms") {
    const committees = rooms.filter((r) => r.kind === "committee");
    if (person.role === "participant" && person.teamNo !== null) {
      const assigned = committeeOfTeam.get(`${session.dayNo}:${person.teamNo}`);
      if (assigned !== undefined)
        return committees.filter((r) => r.committeeNo === assigned).map((r) => r.id);
    }
    return committees.map((r) => r.id);
  }
  return [];
}

function mergedFor(ctx: AttendanceContext, personKey: string, roomIds: readonly string[]): Iv[] {
  const byRoom = ctx.roomIntervals.get(personKey);
  if (!byRoom) return [];
  if (roomIds.length === 1) return byRoom.get(roomIds[0] ?? "") ?? [];
  const all: Iv[] = [];
  for (const id of roomIds) all.push(...(byRoom.get(id) ?? []));
  return mergeIntervals(all);
}

function statusFromMinutes(ms: number, attendMinutes: number): AttStatus | null {
  if (ms >= attendMinutes * MINUTE) return "present";
  if (ms >= MINUTE) return "partial";
  return null;
}

/** Score one (person, session) — BR-ATT-01..04. */
export function scoreCell(person: AttPerson, session: AttSession, ctx: AttendanceContext): Cell {
  if (!isExpected(person, session, ctx.everyoneIncludesEnablers)) {
    return { status: "not_expected", minutes: 0, late: false, firstJoin: null, overridden: false };
  }
  const override = ctx.overrides.get(overrideKey(session.id, person.key));
  if (session.type === "zoom") {
    return {
      status: override ?? "off_platform",
      minutes: 0,
      late: false,
      firstJoin: null,
      overridden: !!override,
    };
  }

  let ms: number;
  let firstJoin: number | null;
  let perTeam: Cell["perTeam"];
  if (person.role === "guider" && session.type === "mentoring") {
    // Each assigned team is scored on its own (BR-ATT-04); the guider's own
    // session status is their best team.
    perTeam = person.guiderTeams.map((teamNo) => {
      const ids = expectedRoomIds(
        { ...person, guiderTeams: [teamNo] },
        session,
        ctx.rooms,
        ctx.committeeOfTeam,
      );
      return {
        teamNo,
        minutes: toMinutes(overlapMs(mergedFor(ctx, person.key, ids), session.start, session.end)),
      };
    });
    const ids = expectedRoomIds(person, session, ctx.rooms, ctx.committeeOfTeam);
    const merged = mergedFor(ctx, person.key, ids);
    ms = Math.max(0, ...perTeam.map((t) => t.minutes * MINUTE));
    firstJoin = firstInside(merged, session.start, session.end);
  } else {
    const ids = expectedRoomIds(person, session, ctx.rooms, ctx.committeeOfTeam);
    const merged = mergedFor(ctx, person.key, ids);
    ms = overlapMs(merged, session.start, session.end);
    firstJoin = firstInside(merged, session.start, session.end);
  }

  let status = statusFromMinutes(ms, ctx.attendMinutes);
  if (!status) {
    const anywhere = overlapMs(
      ctx.meetingIntervals.get(person.key) ?? [],
      session.start,
      session.end,
    );
    const online = overlapMs(
      ctx.platformIntervals.get(person.key) ?? [],
      session.start,
      session.end,
    );
    status = anywhere >= MINUTE || online >= MINUTE ? "elsewhere" : "absent";
  }
  const late =
    (status === "present" || status === "partial") &&
    firstJoin !== null &&
    firstJoin > session.start + ctx.lateMinutes * MINUTE;
  return {
    status: override ?? status,
    minutes: toMinutes(ms),
    late: override ? false : late,
    firstJoin,
    overridden: !!override,
    perTeam,
  };
}

export type Grid = Map<string, Map<string, Cell>>; // sessionId → personKey → cell

export function scoreAll(
  persons: readonly AttPerson[],
  sessions: readonly AttSession[],
  ctx: AttendanceContext,
  now: number,
): Grid {
  const grid: Grid = new Map();
  for (const session of sessions) {
    // A session that has not started yet has no attendance to report.
    if (session.start > now) continue;
    const row = new Map<string, Cell>();
    for (const person of persons) {
      const cell = scoreCell(person, session, ctx);
      if (cell.status !== "not_expected") row.set(person.key, cell);
    }
    grid.set(session.id, row);
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Rates (FR-ATT-10..12)
// ---------------------------------------------------------------------------

export type Rate = { expected: number; attended: number; rate: number | null };

export const isAttended = (status: AttStatus): boolean => status === "present";

export function rateOf(cells: Iterable<Cell>): Rate {
  let expected = 0;
  let attended = 0;
  for (const cell of cells) {
    if (cell.status === "not_expected" || cell.status === "off_platform") continue;
    expected += 1;
    if (isAttended(cell.status)) attended += 1;
  }
  return {
    expected,
    attended,
    rate: expected ? Math.round((attended / expected) * 1000) / 10 : null,
  };
}

export type Group = "participants" | "enablers";

export function groupOf(person: AttPerson): Group {
  return person.role === "participant" ? "participants" : "enablers";
}

export type SessionSummary = {
  sessionId: string;
  participants: Rate;
  enablers: Rate;
};

export function summarizeSessions(
  sessions: readonly AttSession[],
  persons: readonly AttPerson[],
  grid: Grid,
): SessionSummary[] {
  const byKey = new Map(persons.map((p) => [p.key, p]));
  return sessions
    .filter((s) => grid.has(s.id))
    .map((session) => {
      const row = grid.get(session.id) ?? new Map<string, Cell>();
      const parts: Cell[] = [];
      const ens: Cell[] = [];
      for (const [key, cell] of row) {
        const person = byKey.get(key);
        if (!person) continue;
        (groupOf(person) === "participants" ? parts : ens).push(cell);
      }
      return { sessionId: session.id, participants: rateOf(parts), enablers: rateOf(ens) };
    });
}

/** Sum of attended person-sessions over expected person-sessions. */
export function aggregate(summaries: readonly SessionSummary[], pick: Group): Rate {
  let expected = 0;
  let attended = 0;
  for (const s of summaries) {
    expected += s[pick].expected;
    attended += s[pick].attended;
  }
  return {
    expected,
    attended,
    rate: expected ? Math.round((attended / expected) * 1000) / 10 : null,
  };
}

export type TeamDay = {
  teamNo: number;
  dayNo: number;
  rate: Rate;
  allPresent: boolean;
  nonePresent: boolean;
};

/** FR-ATT-11. A team's day is "all present" at 100%, "none present" at 0%. */
export function teamDays(
  sessions: readonly AttSession[],
  persons: readonly AttPerson[],
  grid: Grid,
): TeamDay[] {
  const members = new Map<number, AttPerson[]>();
  for (const p of persons) {
    if (p.role !== "participant" || p.teamNo === null) continue;
    members.set(p.teamNo, [...(members.get(p.teamNo) ?? []), p]);
  }
  const days = [...new Set(sessions.filter((s) => grid.has(s.id)).map((s) => s.dayNo))].sort(
    (a, b) => a - b,
  );
  const out: TeamDay[] = [];
  for (const [teamNo, list] of [...members].sort((a, b) => a[0] - b[0])) {
    for (const dayNo of days) {
      const cells: Cell[] = [];
      for (const s of sessions) {
        if (s.dayNo !== dayNo) continue;
        const row = grid.get(s.id);
        if (!row) continue;
        for (const p of list) {
          const cell = row.get(p.key);
          if (cell) cells.push(cell);
        }
      }
      const rate = rateOf(cells);
      if (!rate.expected) continue;
      out.push({
        teamNo,
        dayNo,
        rate,
        allPresent: rate.attended === rate.expected,
        nonePresent: rate.attended === 0,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Guider coverage (FR-ATT-13/14, BR-ATT-04)
// ---------------------------------------------------------------------------

export type CoverageCell = {
  teamNo: number;
  dayNo: number;
  guiderKey: string;
  minutes: number;
  covered: boolean;
  overridden: boolean;
};

/**
 * For each mentoring day and each assigned (guider, team): minutes the guider
 * spent in that team's room inside the day's mentoring windows.
 */
export function guiderCoverage(
  persons: readonly AttPerson[],
  sessions: readonly AttSession[],
  ctx: AttendanceContext,
  now: number,
): CoverageCell[] {
  const mentoring = sessions.filter((s) => s.type === "mentoring" && s.start <= now);
  const days = new Map<number, AttSession[]>();
  for (const s of mentoring) days.set(s.dayNo, [...(days.get(s.dayNo) ?? []), s]);
  const teamRoom = new Map<number, string>();
  for (const r of ctx.rooms)
    if (r.kind === "team" && r.teamNo !== null) teamRoom.set(r.teamNo, r.id);

  const out: CoverageCell[] = [];
  for (const guider of persons) {
    if (guider.role !== "guider") continue;
    for (const teamNo of guider.guiderTeams) {
      const roomId = teamRoom.get(teamNo);
      const merged = roomId ? (ctx.roomIntervals.get(guider.key)?.get(roomId) ?? []) : [];
      for (const [dayNo, list] of days) {
        let ms = 0;
        for (const s of mergeIntervals(list.map((x) => ({ s: x.start, e: x.end }))))
          ms += overlapMs(merged, s.s, s.e);
        const override = list
          .map((s) => ctx.overrides.get(overrideKey(s.id, guider.key, teamNo)))
          .find((value) => value !== undefined);
        const covered = override ? override === "present" : ms >= ctx.attendMinutes * MINUTE;
        out.push({
          teamNo,
          dayNo,
          guiderKey: guider.key,
          minutes: toMinutes(ms),
          covered,
          overridden: !!override,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Team-room presence for coaches and checkpoints (FR-ATT-15/16)
// ---------------------------------------------------------------------------

export type RoomVisit = { personKey: string; minutes: number };

/** Who from `people` spent time in `roomIds` during the session, longest first. */
export function visitorsOf(
  people: readonly AttPerson[],
  roomIds: readonly string[],
  session: AttSession,
  ctx: AttendanceContext,
): RoomVisit[] {
  const out: RoomVisit[] = [];
  for (const p of people) {
    const ms = overlapMs(mergedFor(ctx, p.key, roomIds), session.start, session.end);
    if (ms >= MINUTE) out.push({ personKey: p.key, minutes: toMinutes(ms) });
  }
  return out.sort((a, b) => b.minutes - a.minutes);
}

// ---------------------------------------------------------------------------
// Absence streaks (FR-ATT-17)
// ---------------------------------------------------------------------------

/** People attending no counted session on two consecutive scored days. */
export function absentTwoDays(
  sessions: readonly AttSession[],
  persons: readonly AttPerson[],
  grid: Grid,
): { personKey: string; days: [number, number] }[] {
  const scoredDays = [
    ...new Set(
      sessions
        .filter((s) => grid.has(s.id) && SESSION_TYPE_DEFS[s.type].counted)
        .map((s) => s.dayNo),
    ),
  ].sort((a, b) => a - b);
  const attendedOn = new Map<string, Set<number>>();
  const expectedOn = new Map<string, Set<number>>();
  for (const s of sessions) {
    if (!SESSION_TYPE_DEFS[s.type].counted) continue;
    const row = grid.get(s.id);
    if (!row) continue;
    for (const [key, cell] of row) {
      if (!expectedOn.has(key)) expectedOn.set(key, new Set());
      expectedOn.get(key)!.add(s.dayNo);
      if (isAttended(cell.status)) {
        if (!attendedOn.has(key)) attendedOn.set(key, new Set());
        attendedOn.get(key)!.add(s.dayNo);
      }
    }
  }
  const out: { personKey: string; days: [number, number] }[] = [];
  for (const person of persons) {
    const expected = expectedOn.get(person.key);
    if (!expected) continue;
    const attended = attendedOn.get(person.key) ?? new Set<number>();
    for (let i = scoredDays.length - 1; i > 0; i -= 1) {
      const d1 = scoredDays[i - 1]!;
      const d2 = scoredDays[i]!;
      if (d2 - d1 !== 1) continue;
      if (expected.has(d1) && expected.has(d2) && !attended.has(d1) && !attended.has(d2)) {
        out.push({ personKey: person.key, days: [d1, d2] });
        break;
      }
    }
  }
  return out;
}
