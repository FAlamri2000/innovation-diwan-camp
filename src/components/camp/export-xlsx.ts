/**
 * Camp operations — Excel exports (§10).
 *
 * Built in the browser from the rows already on screen, so "the filters on
 * screen applied" is true by construction. Every file is right-to-left with
 * Arabic sheet names and headers, a frozen header row, and the export time in
 * the file name — whatever language the operator's interface is in.
 */
type ExcelJSModule = typeof import("exceljs");

async function loadExcelJS(): Promise<ExcelJSModule> {
  const mod = (await import("exceljs")) as ExcelJSModule & { default?: ExcelJSModule };
  return mod.Workbook ? mod : (mod.default ?? mod);
}

export type ExportCell = string | number | null | undefined | { text: string; hyperlink: string };

export type ExportSheet = {
  /** Arabic sheet name (Excel caps it at 31 characters). */
  name: string;
  headers: string[];
  rows: ExportCell[][];
  /** Optional column widths in characters. */
  widths?: number[];
};

/** "دليل المستخدمين 2026-10-05 2130.xlsx" — export time in Riyadh. */
export function exportFileName(base: string, at = new Date()): string {
  const riyadh = new Date(at.getTime() + 3 * 3_600_000);
  const stamp = `${riyadh.toISOString().slice(0, 10)} ${riyadh.toISOString().slice(11, 16).replace(":", "")}`;
  return `${base} ${stamp}.xlsx`;
}

const SHEET_NAME_BAD = /[\\/?*[\]:]/g;

export async function downloadWorkbook(fileBase: string, sheets: ExportSheet[]): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Innovation Diwan — Camp operations";
  wb.created = new Date();
  const used = new Set<string>();
  for (const sheet of sheets) {
    let name = sheet.name.replace(SHEET_NAME_BAD, " ").slice(0, 31).trim() || "ورقة";
    for (let i = 2; used.has(name); i += 1) name = `${name.slice(0, 28)} ${i}`;
    used.add(name);
    const ws = wb.addWorksheet(name, {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });
    ws.addRow(sheet.headers);
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle", horizontal: "right", wrapText: true };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE7DB" } };
    });
    for (const row of sheet.rows) {
      ws.addRow(row.map((cell) => (cell === null || cell === undefined ? "" : cell)));
    }
    sheet.headers.forEach((h, i) => {
      const col = ws.getColumn(i + 1);
      const longest = Math.max(
        h.length,
        ...sheet.rows.slice(0, 200).map((r) => {
          const v = r[i];
          return typeof v === "object" && v ? v.text.length : String(v ?? "").length;
        }),
      );
      col.width = sheet.widths?.[i] ?? Math.min(60, Math.max(10, longest + 2));
      col.alignment = { horizontal: "right", vertical: "top", wrapText: true };
    });
    if (sheet.rows.length)
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.headers.length } };
  }
  const bytes = await wb.xlsx.writeBuffer();
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName(fileBase);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
