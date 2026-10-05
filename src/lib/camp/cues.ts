/**
 * Camp operations — scheduled cues and message templates (Module 6), pure.
 */

/** FR-NOT-02 limits: gong and announcement popups, NPC speech bubbles. */
export const CHANNEL_LIMITS = {
  gong: 100,
  announcement: 100,
  npc: 120,
  channel: 40_000,
  dm: 40_000,
} as const;
export type CueChannel = "channel" | "gong" | "announcement" | "npc";

/** Placeholders the templates of §9/§11 use. */
export const PLACEHOLDERS = [
  "الاسم",
  "الاسم المقترح",
  "الفقرة",
  "الوقت",
  "المكان",
  "الرقم",
  "اسم الحساب",
  "التاريخ",
  "الفقرات وأوقاتها",
  "العدد",
  "المدة",
] as const;

/** Replace {placeholder}; an unknown or empty one is left visible for review. */
export function renderTemplate(
  text: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return text.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
    const value = vars[name.trim()];
    return value === undefined || value === null || value === "" ? whole : String(value);
  });
}

/** Placeholders still unfilled after rendering — a send with any is refused. */
export function unfilled(text: string): string[] {
  return [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1] ?? "");
}

export type CueLite = {
  key: string;
  timeOfDay: string;
  endTime: string | null;
  days: number[];
  disabledDays: number[];
  dayTimes: Record<string, string>;
  enabled: boolean;
};

export const hhmm = (value: string) => value.slice(0, 5);

const toMinutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const fromMinutes = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(((minutes % 60) + 60) % 60).padStart(2, "0")}`;

/** The cue's time on a given camp day (a shifted time wins). */
export function cueTimeOn(cue: CueLite, dayNo: number): string {
  return hhmm(cue.dayTimes[String(dayNo)] ?? cue.timeOfDay);
}

export function cueRunsOn(cue: CueLite, dayNo: number): boolean {
  return cue.enabled && cue.days.includes(dayNo) && !cue.disabledDays.includes(dayNo);
}

/**
 * FR-NOT-07. When a re-imported agenda moves a session on a day, every cue on
 * that day timed from 15 minutes before the old start up to the old start
 * itself moves by the same amount — S01 ("in 10 minutes") and S02 ("has
 * started") follow the first item without anyone re-entering them. Times
 * written INSIDE a cue's text are not rewritten; the import preview lists
 * every shifted cue so its text can be checked.
 */
export function cueShifts(
  cues: readonly CueLite[],
  moved: readonly { dayNo: number; oldStart: string; newStart: string }[],
): { cue: string; dayNo: number; from: string; to: string }[] {
  const out: { cue: string; dayNo: number; from: string; to: string }[] = [];
  for (const cue of cues) {
    for (const day of new Set(moved.map((m) => m.dayNo))) {
      if (!cue.days.includes(day)) continue;
      const current = cueTimeOn(cue, day);
      const at = toMinutes(current);
      const hit = moved.find(
        (m) => m.dayNo === day && at >= toMinutes(m.oldStart) - 15 && at <= toMinutes(m.oldStart),
      );
      if (!hit) continue;
      const delta = toMinutes(hit.newStart) - toMinutes(hit.oldStart);
      if (!delta) continue;
      out.push({ cue: cue.key, dayNo: day, from: current, to: fromMinutes(at + delta) });
    }
  }
  return out;
}

/** Is `nowHHMM` inside [time, time + graceMinutes)? Both Riyadh wall times. */
export function isDue(time: string, nowHHMM: string, graceMinutes: number): boolean {
  const t = toMinutes(time);
  const n = toMinutes(nowHHMM);
  return n >= t && n < t + graceMinutes;
}
