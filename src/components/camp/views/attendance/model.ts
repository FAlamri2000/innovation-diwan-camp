/**
 * Camp operations — data helpers the attendance tabs and the coverage screen
 * share: the agenda query, the default camp day, person filters, rate tones,
 * and the Arabic formatters every Excel export uses (§10: exports are Arabic
 * whatever the interface language).
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "@/i18n/use-translation";
import { getCampAgenda } from "@/lib/camp-read.functions";
import { ATT_STATUS_AR, LATE_AR, UNDETERMINED_AR } from "@/lib/camp/copy-ar";
import { formatTimeAr, riyadhDate } from "@/lib/camp/text";
import type {
  AgendaPayload,
  AttCellDto,
  AttPersonDto,
  DayRow,
  EventRole,
  SessionRow,
} from "@/lib/camp/types";
import { campKey, matchesSearch, useCampFormat, type Tone } from "../../camp-ui";

export const ROLES: EventRole[] = [
  "participant",
  "guider",
  "coach",
  "expert",
  "speaker",
  "supervisor",
  "unknown",
];

// ---------------------------------------------------------------------------
// Agenda and camp days
// ---------------------------------------------------------------------------

export function useCampAgenda() {
  const fn = useServerFn(getCampAgenda);
  return useQuery({
    queryKey: campKey("agenda"),
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

/** Today's camp day when the camp is running, else the latest day already under way. */
export function defaultDayNo(agenda: AgendaPayload, now = Date.now()): number | null {
  const today = riyadhDate(now);
  const todayRow = agenda.days.find((d) => d.date === today);
  if (todayRow) return todayRow.dayNo;
  const started = agenda.sessions.filter((s) => s.start <= now).map((s) => s.dayNo);
  if (started.length) return Math.max(...started);
  return agenda.days[0]?.dayNo ?? agenda.sessions[0]?.dayNo ?? null;
}

/** "Day 3 · 6 October 2026" for headings and tooltips. */
export function useDayLabel(days: readonly DayRow[]) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  return (dayNo: number) => {
    const day = days.find((d) => d.dayNo === dayNo);
    return day
      ? t("camp.att.dayOption", { n: dayNo, date: fmt.date(day.date) })
      : t("camp.common.dayN", { n: dayNo });
  };
}

// ---------------------------------------------------------------------------
// Person filters (group, role, team, search)
// ---------------------------------------------------------------------------

export type Group = "participants" | "enablers";

export type PersonFilter = {
  search: string;
  group: Group | "all";
  role: EventRole | "all";
  team: string;
};

export const EMPTY_FILTER: PersonFilter = { search: "", group: "all", role: "all", team: "all" };

export function filterPeople<T extends Pick<AttPersonDto, "name" | "role" | "teamNo" | "phone">>(
  rows: readonly T[],
  f: PersonFilter,
): T[] {
  return rows.filter(
    (r) =>
      (f.group === "all" ||
        (f.group === "participants" ? r.role === "participant" : r.role !== "participant")) &&
      (f.role === "all" || r.role === f.role) &&
      (f.team === "all" || String(r.teamNo ?? "") === f.team) &&
      matchesSearch(f.search, [r.name, r.phone, r.teamNo]),
  );
}

export function teamOptions(rows: readonly { teamNo: number | null }[]) {
  return [...new Set(rows.map((r) => r.teamNo).filter((n): n is number => n !== null))]
    .sort((a, b) => a - b)
    .map((n) => ({ value: String(n), label: String(n) }));
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/** A03 fires below 70% (editable server side); the colour bands follow it. */
export function rateTone(rate: number | null): Tone {
  if (rate === null) return "muted";
  if (rate >= 85) return "good";
  if (rate >= 70) return "warn";
  return "bad";
}

// ---------------------------------------------------------------------------
// Arabic export formatting (§10, FR-UI-03)
// ---------------------------------------------------------------------------

export const timeAr = (ms: number | null | undefined): string =>
  ms === null || ms === undefined ? "" : formatTimeAr(ms);

export function minutesAr(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value < 60) return `${value} د`;
  return `${Math.floor(value / 60)} س ${value % 60} د`;
}

export const percentAr = (value: number | null): string => (value === null ? "" : `${value}%`);

export const dayAr = (dayNo: number): string => `اليوم ${dayNo}`;

export const roomAr = (label: string | null | undefined): string => label || UNDETERMINED_AR;

export function cellStatusAr(cell: AttCellDto | undefined): string {
  if (!cell || cell.status === "not_expected") return "";
  const base = ATT_STATUS_AR[cell.status];
  return cell.late ? `${base} (${LATE_AR})` : base;
}

/**
 * Column titles for a day's sessions: the title alone, or the title and its
 * start time when two sessions of the day share one (workshop parts).
 */
export function sessionHeadersAr(sessions: readonly SessionRow[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const s of sessions) counts.set(s.title, (counts.get(s.title) ?? 0) + 1);
  return new Map(
    sessions.map((s) => [
      s.id,
      (counts.get(s.title) ?? 0) > 1 ? `${s.title} ${formatTimeAr(s.start)}` : s.title,
    ]),
  );
}
