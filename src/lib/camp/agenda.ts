/**
 * Camp operations — agenda session types (FR-IMP-05, the §3 table).
 *
 * Classification is by title, in the order the table implies: anything on
 * Zoom is off-platform whatever it is called; breaks are breaks; anything
 * shorter than 10 minutes cannot reach the 10-minute rule and is a
 * transition; then the six counted kinds. Operators can override any item.
 */
import { normalizeArabicLetters, toWesternDigits } from "./text.ts";

export const SESSION_TYPES = [
  "workshop",
  "mentoring",
  "checkpoint",
  "inspirational",
  "pitch_coaching",
  "judging",
  "break",
  "zoom",
  "transition",
  "other",
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export type SessionWhere = "main_hall" | "team_rooms" | "committee_rooms" | "none" | "zoom";

export type SessionTypeDef = {
  where: SessionWhere;
  counted: boolean;
  /** Arabic label, section 3. */
  labelAr: string;
};

export const SESSION_TYPE_DEFS: Record<SessionType, SessionTypeDef> = {
  workshop: { where: "main_hall", counted: true, labelAr: "ورشة" },
  mentoring: { where: "team_rooms", counted: true, labelAr: "الجلسة الإرشادية" },
  checkpoint: { where: "committee_rooms", counted: true, labelAr: "نقطة التحقق" },
  inspirational: { where: "main_hall", counted: true, labelAr: "لقاء ملهم" },
  pitch_coaching: { where: "team_rooms", counted: true, labelAr: "جلسة التدريب على الإلقاء" },
  judging: { where: "main_hall", counted: true, labelAr: "عروض الفرق" },
  break: { where: "none", counted: false, labelAr: "استراحة" },
  zoom: { where: "zoom", counted: false, labelAr: "Zoom" },
  transition: { where: "none", counted: false, labelAr: "انتقال" },
  other: { where: "main_hall", counted: false, labelAr: "أخرى" },
};

function norm(value: string): string {
  return normalizeArabicLetters(toWesternDigits(value)).toLowerCase().replace(/\s+/g, " ").trim();
}

const RULES: { type: SessionType; needles: string[] }[] = [
  { type: "workshop", needles: ["ورشه"] },
  { type: "mentoring", needles: ["الجلسه الارشاديه", "جلسه ارشاديه", "الجلسات الارشاديه"] },
  { type: "checkpoint", needles: ["نقطه التحقق", "نقاط التحقق"] },
  { type: "inspirational", needles: ["لقاء ملهم", "اللقاء الملهم"] },
  { type: "pitch_coaching", needles: ["التدريب على الالقاء", "التدريب علي الالقاء"] },
  { type: "judging", needles: ["عروض الفرق", "عرض الفرق"] },
];

export function classifySession(title: string, minutes: number): SessionType {
  const t = norm(title);
  if (t.includes("zoom") || t.includes("زوم")) return "zoom";
  if (t.includes("استراحه") || t.includes("صلاه")) return "break";
  if (minutes < 10) return "transition";
  for (const rule of RULES) {
    if (rule.needles.some((needle) => t.includes(needle))) return rule.type;
  }
  return "other";
}

/** "من 1 إلى 10" / "1 - 10" in a judging round title → the teams in it. */
export function roundTeams(title: string, teamCount: number): number[] | null {
  const t = norm(title);
  // norm() has already folded إلى/إلي to "الي".
  const m =
    /من\s*(\d{1,3})\s*(?:الي|الى|حتي|حتى|-)\s*(\d{1,3})/.exec(t) ??
    /(\d{1,3})\s*-\s*(\d{1,3})/.exec(t);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Math.min(Number(m[2]), teamCount);
  if (!(from >= 1 && to >= from)) return null;
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Natural key that survives a time edit (see camp_sessions.natural_key). */
export function sessionNaturalKey(dayNo: number, title: string, occurrence: number): string {
  return `${dayNo}|${norm(title)}|${occurrence}`;
}

export const PHASES = ["الاستكشاف", "التصميم", "البناء", "الإطلاق"] as const;
