/**
 * Camp operations settings — schema and defaults.
 *
 * Stored as a PARTIAL document in public.camp_settings and merged over these
 * defaults on read, so adding a setting never needs a migration and an empty
 * row is a complete, working configuration. Every threshold the requirements
 * call "editable" lives here.
 */
import { z } from "zod";
import { DEFAULT_HONORIFICS } from "./text.ts";

export const ENABLER_ROLES = ["guider", "coach", "expert", "speaker", "supervisor"] as const;
export type EnablerRole = (typeof ENABLER_ROLES)[number];
export type EventRole = "participant" | EnablerRole | "unknown";

export const ACCOUNT_TYPES = ["admin", "teammate", "guest"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Section 6 "Role labels" — feminine forms included (open item in §13). */
export const DEFAULT_ROLE_LABELS: Record<EnablerRole, string[]> = {
  guider: ["مرشد", "مرشدة", "Guider"],
  coach: ["مدرب", "مدربة", "Coach"],
  expert: ["خبير", "خبيرة", "Expert"],
  speaker: ["متحدث ملهم", "متحدثة ملهمة", "Inspirational Speaker"],
  supervisor: ["مشرف", "مشرفة", "Supervisor"],
};

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const campSettingsSchema = z.object({
  /** Day 1 of the camp, Riyadh date. */
  startDate: isoDate.default("2026-10-04"),
  dayCount: z.number().int().min(1).max(60).default(14),
  teamCount: z.number().int().min(1).max(999).default(29),

  /** BR-ATT-01: minutes in the room for "present". */
  attendMinutes: z.number().int().min(1).max(120).default(10),
  /** BR-ATT-03: late when the first join is more than this after the start. */
  lateMinutes: z.number().int().min(0).max(120).default(10),
  /** A03: alert when attendance is below this percent … */
  lowAttendancePercent: z.number().int().min(1).max(100).default(70),
  /** … this many minutes into a session. */
  lowAttendanceAfterMinutes: z.number().int().min(1).max(120).default(15),
  /** BR-ATT-04 fallback window when the agenda has no mentoring items that day. */
  mentoringWindowStart: hhmm.default("20:30"),
  mentoringWindowEnd: hhmm.default("21:50"),
  /**
   * Workshops and talks expect "Everyone". Whether guiders and coaches are
   * part of that everyone for the enabler rate (FR-ATT-10).
   */
  everyoneIncludesEnablers: z.boolean().default(true),

  /** FR-DUP-03 levels. */
  duplicateSuspectedScore: z.number().int().min(50).max(100).default(90),
  duplicateLookalikeScore: z.number().int().min(50).max(100).default(80),
  /** Registry matching: automatic link at or above this score. */
  autoLinkScore: z.number().int().min(50).max(100).default(90),

  /** FR-ATT-04: a team owns a meeting when its members are this share of it. */
  roomMixShare: z.number().min(0.1).max(1).default(0.5),
  /**
   * A meeting this large with no topic match is the main hall. Not in the
   * requirements: added because 98 of 100 meetings on day 1 had no topic, so
   * the main hall could not otherwise be told from an unplaced room.
   */
  mainHallMinParticipants: z.number().int().min(2).max(1000).default(15),

  /** FR-REC-01: library item start within this many seconds of the meeting. */
  libraryMatchSeconds: z.number().int().min(30).max(1800).default(180),
  libraryRetryMinutes: z.number().int().min(1).max(240).default(30),

  /** FR-USR-10 refresh cadence. */
  refreshAgendaMinutes: z.number().int().min(1).max(120).default(5),
  refreshIdleMinutes: z.number().int().min(1).max(240).default(30),

  /** FR-NOT-04. */
  maxNudgesPerDay: z.number().int().min(0).max(20).default(2),
  /** P04 repeats at this time daily, at most this many sends. */
  namingReminderTime: hhmm.default("17:00"),
  namingReminderMax: z.number().int().min(0).max(20).default(3),
  /** A09 daily summary times. */
  dailySummaryTime: hhmm.default("22:05"),
  lastDaySummaryTime: hhmm.default("19:30"),
  /** A07: no events for this long during agenda hours. */
  eventSilenceMinutes: z.number().int().min(1).max(120).default(10),

  /**
   * Global switch for EVERYTHING the dashboard sends on its own (cues,
   * nudges, alert DMs, the daily summary). Off until an operator turns it on.
   * Manual sends from the screens are separate: each is confirmed (M03).
   */
  sendingEnabled: z.boolean().default(false),

  /** FR-NAM-07. */
  roleLabels: z
    .object({
      guider: z.array(z.string()),
      coach: z.array(z.string()),
      expert: z.array(z.string()),
      speaker: z.array(z.string()),
      supervisor: z.array(z.string()),
    })
    .default(DEFAULT_ROLE_LABELS),
  honorifics: z.array(z.string()).default([...DEFAULT_HONORIFICS]),

  /** BR-USR-04: expected account type per event role (unset = not checked). */
  expectedAccountTypes: z
    .object({
      participant: z.enum(ACCOUNT_TYPES).nullable(),
      guider: z.enum(ACCOUNT_TYPES).nullable(),
      coach: z.enum(ACCOUNT_TYPES).nullable(),
      expert: z.enum(ACCOUNT_TYPES).nullable(),
      speaker: z.enum(ACCOUNT_TYPES).nullable(),
      supervisor: z.enum(ACCOUNT_TYPES).nullable(),
    })
    .default({
      participant: null,
      guider: null,
      coach: null,
      expert: null,
      speaker: null,
      supervisor: null,
    }),

  /** Channel for S00-style channel posts; empty = the office's default public channel. */
  announcementChannelId: z.string().default(""),
  /** Private channel for the A09 daily summary (the API cannot create one). */
  summaryChannelId: z.string().default(""),
  /** Main hall zone for wayfinding NPCs (S09). */
  mainHallZoneId: z.string().default(""),
  /** The NPC the dashboard created and reuses for wayfinding. */
  wayfindingNpcId: z.string().default(""),
  /**
   * SoWork accounts that receive operations alerts as direct messages
   * (FR-NOT-06, §13 "name the operators on duty").
   */
  alertRecipientIds: z
    .array(z.string().regex(/^[a-zA-Z0-9]{4,36}$/))
    .max(30)
    .default([]),
  /** Opened by "فتح إعدادات SoWork" (FR-USR-07). */
  soworkAdminUrl: z.string().default("https://app.sowork.com"),
});

export type CampSettings = z.infer<typeof campSettingsSchema>;

/** Partial patch an operator saves. */
/**
 * Only for validating a whole document. Do NOT use it to read a patch: under
 * zod 4 `.partial()` keeps every field's `.default()`, so parsing
 * `{ lateMinutes: 12 }` returns all keys filled with defaults — and a save
 * built from that resets every other setting. Use parseCampSettingsPatch.
 */
export const campSettingsPatchSchema = campSettingsSchema.partial();
export type CampSettingsPatch = Partial<CampSettings>;

/**
 * Validate exactly the keys that were sent, each against its own field
 * schema; unknown keys are refused. What comes back holds only those keys.
 */
export function parseCampSettingsPatch(raw: unknown): CampSettingsPatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Settings must be an object");
  const shape = campSettingsSchema.shape as Record<string, z.ZodType>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = shape[key];
    if (!field) throw new Error(`Unknown setting: ${key}`);
    if (value === undefined) continue;
    const parsed = field.safeParse(value);
    if (!parsed.success) throw new Error(`Invalid value for ${key}`);
    out[key] = parsed.data;
  }
  return out as CampSettingsPatch;
}

/**
 * Merge a stored document over the defaults. A stored value that no longer
 * validates (a setting whose shape changed) falls back to its default rather
 * than taking the whole module down.
 */
export function resolveCampSettings(stored: unknown): CampSettings {
  const defaults = campSettingsSchema.parse({});
  if (!stored || typeof stored !== "object") return defaults;
  const out: Record<string, unknown> = { ...defaults };
  const shape = campSettingsSchema.shape as Record<string, z.ZodType>;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const field = shape[key];
    if (!field) continue;
    const parsed = field.safeParse(value);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as CampSettings;
}
