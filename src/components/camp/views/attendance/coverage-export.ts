/**
 * Guider coverage sheets (FR-ATT-13/14), shared by the coverage screen's
 * export and the "تغطية المرشدين" sheet of ملخص الحضور (FR-EXP-08).
 */
import type { CoveragePayload } from "@/lib/camp/types";
import type { ExportSheet } from "../../export-xlsx";
import { dayAr, minutesAr } from "./model";

type CoverageCell = CoveragePayload["cells"][number];
type CoverageGuider = CoveragePayload["guiders"][number];

/** "✓ 45 د" / "✗ 3 د", with "(معدّل يدويًا)" when an operator overrode it. */
export function coverageMarkAr(cell: CoverageCell): string {
  const mark = `${cell.covered ? "✓" : "✗"} ${minutesAr(cell.minutes)}`;
  return cell.overridden ? `${mark} (معدّل يدويًا)` : mark;
}

/**
 * Teams × mentoring days. One row per team and assigned guider, so a team
 * with two guiders shows each on its own line (BR-ATT-04 scores each pair).
 */
export function coverageGridSheet(
  days: readonly number[],
  cells: readonly CoverageCell[],
): ExportSheet {
  const pairs = new Map<
    string,
    { teamNo: number; guiderName: string; byDay: Map<number, CoverageCell> }
  >();
  for (const c of cells) {
    const key = `${c.teamNo}|${c.guiderKey}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { teamNo: c.teamNo, guiderName: c.guiderName, byDay: new Map() };
      pairs.set(key, pair);
    }
    pair.byDay.set(c.dayNo, c);
  }
  const rows = [...pairs.values()].sort(
    (a, b) => a.teamNo - b.teamNo || a.guiderName.localeCompare(b.guiderName, "ar"),
  );
  return {
    name: "تغطية المرشدين",
    headers: ["الفريق", "المرشد", ...days.map(dayAr), "الجلسات المغطاة", "الجلسات غير المغطاة"],
    rows: rows.map((r) => {
      const list = [...r.byDay.values()];
      return [
        r.teamNo,
        r.guiderName,
        ...days.map((d) => {
          const cell = r.byDay.get(d);
          return cell ? coverageMarkAr(cell) : "";
        }),
        list.filter((c) => c.covered).length,
        list.filter((c) => !c.covered).length,
      ];
    }),
  };
}

export function guiderListSheet(guiders: readonly CoverageGuider[]): ExportSheet {
  return {
    name: "قائمة المرشدين",
    headers: [
      "المرشد",
      "الفرق المسندة",
      "الجلسات المغطاة",
      "الجلسات غير المغطاة",
      "الدقائق لكل فريق",
      "مجموع الدقائق",
    ],
    rows: guiders.map((g) => [
      g.name,
      g.teams.join("، "),
      g.covered,
      g.missed,
      g.minutesByTeam.map((x) => `الفريق ${x.teamNo}: ${minutesAr(x.minutes)}`).join("، "),
      g.minutesByTeam.reduce((sum, x) => sum + x.minutes, 0),
    ]),
  };
}
