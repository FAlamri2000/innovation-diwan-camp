/**
 * Camp operations — shapes that cross the server/client boundary.
 *
 * Types only. Every value here is plain JSON (dates are ISO strings or epoch
 * milliseconds), so server functions can return them as-is.
 */
import type { SessionType } from "./agenda.ts";
import type { AttStatus, PlacementSource } from "./attendance.ts";
import type { DuplicateLevel, MatchStatus, PairReason, RegistryCheckKind } from "./match.ts";
import type { NamingCode, NamingStatus, SuffixKind } from "./naming.ts";
import type { AccountType, CampSettings, EventRole } from "./settings.ts";

export type {
  AccountType,
  AttStatus,
  CampSettings,
  DuplicateLevel,
  EventRole,
  MatchStatus,
  NamingCode,
  NamingStatus,
  SessionType,
};

/** Plain JSON, so server functions can prove a payload serializable. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Directory status of a person (FR-USR-02 "match status"). */
export type MatchState = "linked" | "candidate" | "not_in_registry" | "no_account";

export type AccountRow = {
  swUserId: string;
  name: string;
  avatarUrl: string | null;
  namePart: string;
  suffix: string;
  suffixKind: SuffixKind;
  eventRole: EventRole;
  teamNo: number | null;
  guiderName: string | null;
  accountType: AccountType;
  expectedType: AccountType | null;
  typeMismatch: boolean;
  presence: "available" | "busy" | "away" | "offline" | null;
  lastActivityAt: string | null;
  firstSeenAt: string;
  phone: string | null;
  email: string | null;
  registryId: string | null;
  registryName: string | null;
  candidateId: string | null;
  candidateName: string | null;
  matchStatus: MatchStatus;
  matchState: MatchState;
  matchScore: number;
  naming: NamingStatus;
  issues: NamingCode[];
  suggestedName: string | null;
  duplicate: DuplicateLevel | null;
  personKey: string;
  reviewed: boolean;
  pendingChange: { id: string; kind: "type" | "remove"; requestedType: AccountType | null } | null;
  firstViolationAt: string | null;
  nameFixedAt: string | null;
  lastNamingMessageAt: string | null;
};

export type RegistryRow = {
  id: string;
  kind: "participant" | "guider" | "coach";
  name: string;
  teamNo: number | null;
  title: "leader" | "member" | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  guiderTeams: number[];
  accountIds: string[];
};

export type TeamRow = {
  teamNo: number;
  applicationNo: string | null;
  guiderName: string | null;
  declaredMembers: number | null;
  members: number;
};

export type TypeChangeRow = {
  id: string;
  swUserId: string;
  name: string;
  kind: "type" | "remove";
  currentType: AccountType | null;
  requestedType: AccountType | null;
  reason: string;
  status: "pending" | "done" | "cancelled";
  requestedAt: string;
  doneAt: string | null;
};

export type DirectoryPayload = {
  accounts: AccountRow[];
  /** Registry people with no SoWork account seen (FR-USR-09). */
  missing: RegistryRow[];
  registry: RegistryRow[];
  teams: TeamRow[];
  typeChanges: TypeChangeRow[];
  teamCount: number;
  soworkAdminUrl: string;
  generatedAt: string;
};

export type PairAccount = {
  swUserId: string;
  name: string;
  accountType: AccountType;
  firstSeenAt: string;
  lastActivityAt: string | null;
  firstMeetingAt: string | null;
  lastMeetingAt: string | null;
  registryId: string | null;
  registryName: string | null;
  phone: string | null;
  teamNo: number | null;
};

export type DuplicateRow = {
  key: string;
  a: PairAccount;
  b: PairAccount;
  score: number;
  level: DuplicateLevel;
  reasons: PairReason[];
  decision: "duplicate" | "not_duplicate" | "follow_up" | null;
  primaryId: string | null;
  /** Email of the operator who decided (the user id when the account is gone). */
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
};

export type RegistryCheckRow = {
  kind: RegistryCheckKind;
  value: string;
  people: { id: string; name: string; teamNo: number | null; kind: string }[];
};

export type DuplicatesPayload = {
  pairs: DuplicateRow[];
  checks: RegistryCheckRow[];
  thresholds: { suspected: number; lookalike: number };
};

export type NamingDayCount = { dayNo: number; ok: number; note: number; violation: number };

export type NamingPayload = {
  rows: AccountRow[];
  counts: { ok: number; note: number; violation: number };
  byTeam: { teamNo: number; violation: number; note: number }[];
  byRole: { role: EventRole; violation: number; note: number }[];
  trend: NamingDayCount[];
};

export type RoomRow = {
  id: string;
  kind: "main_hall" | "team" | "committee" | "other";
  teamNo: number | null;
  committeeNo: number | null;
  label: string;
  topics: string[];
  zoneId: string | null;
};

export type DayRow = { dayNo: number; date: string; phase: string | null; header: string | null };

export type SessionRow = {
  id: string;
  dayNo: number;
  seq: number;
  start: number;
  end: number;
  title: string;
  autoType: SessionType;
  typeOverride: SessionType | null;
  type: SessionType;
  counted: boolean;
};

export type AgendaPayload = {
  days: DayRow[];
  sessions: SessionRow[];
  rooms: RoomRow[];
  committees: { dayNo: number; teamNo: number; committeeNo: number }[];
  judging: { teamNo: number; round: number; startsAt: string }[];
};

export type AttCellDto = {
  status: AttStatus;
  minutes: number;
  late: boolean;
  overridden: boolean;
  perTeam?: { teamNo: number; minutes: number }[];
};

export type AttPersonDto = {
  key: string;
  name: string;
  role: EventRole;
  teamNo: number | null;
  accountIds: string[];
  phone: string | null;
};

export type DaySheetRow = AttPersonDto & {
  entry: number | null;
  exit: number | null;
  platformSeconds: number;
  meetingMinutes: number;
  cells: Record<string, AttCellDto>;
};

export type DaySheetPayload = {
  dayNo: number;
  date: string | null;
  sessions: SessionRow[];
  rows: DaySheetRow[];
};

export type PersonMeetingRow = {
  meetingId: string;
  topic: string | null;
  roomId: string | null;
  roomLabel: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  joinedAt: number;
  leftAt: number | null;
  minutes: number;
  status: AttStatus | null;
  deepLink: string | null;
  hasRecording: boolean | null;
};

export type WindowRow = AttPersonDto & {
  entry: number | null;
  minutes: number;
  meetings: { meetingId: string; roomLabel: string | null; minutes: number }[];
};

export type RateDto = { expected: number; attended: number; rate: number | null };

export type SummaryPayload = {
  sessions: (SessionRow & { participants: RateDto; enablers: RateDto })[];
  days: { dayNo: number; phase: string | null; participants: RateDto; enablers: RateDto }[];
  phases: { phase: string; participants: RateDto; enablers: RateDto }[];
  teams: {
    teamNo: number;
    dayNo: number;
    rate: RateDto;
    allPresent: boolean;
    nonePresent: boolean;
  }[];
  enablersByRole: {
    role: EventRole;
    people: {
      key: string;
      name: string;
      scored: boolean;
      rate: RateDto;
      minutes: number;
      daysSeen: number;
    }[];
  }[];
  absentTwoDays: {
    key: string;
    accountIds: string[];
    name: string;
    role: EventRole;
    teamNo: number | null;
    days: [number, number];
  }[];
  checkpoints: { sessionId: string; dayNo: number; teams: { teamNo: number; rate: RateDto }[] }[];
  pitchCoaching: {
    sessionId: string;
    dayNo: number;
    teams: { teamNo: number; minutes: number; covered: boolean; coaches: string[] }[];
  }[];
};

export type CoveragePayload = {
  days: number[];
  cells: {
    teamNo: number;
    dayNo: number;
    guiderKey: string;
    guiderName: string;
    minutes: number;
    covered: boolean;
    overridden: boolean;
  }[];
  guiders: {
    key: string;
    name: string;
    teams: number[];
    covered: number;
    missed: number;
    minutesByTeam: { teamNo: number; minutes: number }[];
  }[];
  mentoringSessions: Record<number, string[]>;
};

export type LiveRoom = {
  roomId: string | null;
  label: string;
  kind: string;
  people: { key: string; name: string; role: EventRole; teamNo: number | null; since: number }[];
};

export type LivePayload = {
  now: number;
  sessions: SessionRow[];
  rooms: LiveRoom[];
  expectedMissing: {
    sessionId: string;
    people: {
      key: string;
      name: string;
      role: EventRole;
      teamNo: number | null;
      where: string | null;
    }[];
  }[];
  onlineCount: number;
};

export type MeetingRow = {
  meetingId: string;
  topic: string | null;
  status: "active" | "ended";
  startedAt: number;
  endedAt: number | null;
  participants: number;
  roomId: string | null;
  roomLabel: string | null;
  roomSource: PlacementSource | null;
  manualRoom: boolean;
  sessionId: string | null;
  sessionTitle: string | null;
  library: {
    status: "pending" | "linked" | "uncertain" | "none" | "manual";
    itemId: string | null;
    topic: string | null;
    deepLink: string | null;
    hasRecording: boolean | null;
    durationSeconds: number | null;
    candidates: {
      itemId: string;
      score: number;
      overlap: number;
      deltaSeconds: number;
      topicMatch: boolean;
      /** Absent on candidates stored before 2026-10-05. */
      topic?: string | null;
      startedAt?: number;
    }[];
  };
};

/** A library item near a meeting, for linking one by hand (FR-REC-07). */
export type LibraryOption = {
  itemId: string;
  topic: string | null;
  startedAt: number;
  endedAt: number | null;
  participants: number;
  shared: number;
  hasRecording: boolean | null;
  takenBy: string | null;
};

export type AlertRow = {
  id: string;
  code: string;
  title: string;
  detail: { [key: string]: Json };
  dayNo: number | null;
  createdAt: string;
  acknowledgedAt: string | null;
  notifiedAt: string | null;
};

export type SendLogRow = {
  id: string;
  kind: string;
  itemKey: string | null;
  channel: string;
  dayNo: number | null;
  recipients: string[];
  recipientNames: string[];
  text: string;
  status: "sent" | "partial" | "failed" | "skipped";
  delivered: number;
  failures: { userId?: string; error: string }[];
  createdAt: string;
};

export type CueRow = {
  key: string;
  timeOfDay: string;
  endTime: string | null;
  days: number[];
  disabledDays: number[];
  dayTimes: Record<string, string>;
  channel: "channel" | "gong" | "announcement" | "npc";
  text: string;
  enabled: boolean;
};

export type TemplateRow = {
  key: string;
  kind: "message" | "nudge";
  text: string;
  enabled: boolean;
};

export type OverviewPayload = {
  campDay: number;
  dayCount: number;
  today: string;
  currentSessions: SessionRow[];
  nextSession: SessionRow | null;
  cards: {
    participantRate: RateDto;
    enablerRate: RateDto;
    guiderCoverage: { covered: number; total: number };
    namingViolations: number;
    openDuplicates: number;
    onlineNow: number;
    inMeetingsNow: number;
  };
  alerts: AlertRow[];
  sync: SyncStatusDto;
};

export type SyncStatusDto = {
  configured: boolean;
  subscriptionId: string | null;
  lastTickAt: string | null;
  lastTickOk: boolean | null;
  lastTickErrors: string[];
  lastEventAt: string | null;
  minutesSinceRefresh: number | null;
  backfillDone: boolean;
  counts: { events: number; meetings: number; accounts: number };
  sendingEnabled: boolean;
};

export type ImportPreview = {
  id: string;
  kind: "registry" | "agenda";
  fileName: string;
  issues: {
    code: string;
    sheet?: string;
    row?: number;
    params?: Record<string, string | number>;
  }[];
  summary: Record<string, number>;
  diff: {
    entity: string;
    added: { key: string; label: string }[];
    removed: { key: string; label: string }[];
    changed: { key: string; label: string; fields: string[] }[];
    unchanged: number;
  }[];
  cueShifts: { cue: string; dayNo: number; from: string; to: string }[];
  createdAt: string;
  status: "preview" | "applied" | "discarded";
};
