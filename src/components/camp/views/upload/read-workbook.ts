/**
 * Camp operations — reading an uploaded workbook in the browser (FR-IMP-01, FR-IMP-04).
 *
 * SheetJS turns each sheet into a grid of RAW cell values: numbers stay
 * numbers, so Excel dates and times arrive as serials, which the server parser
 * (camp/import-parse.ts) understands. Nothing is interpreted here; the grids
 * are only trimmed to what previewCampImport accepts.
 */
export type ImportCell = string | number | boolean | null;
export type ImportSheet = { name: string; rows: ImportCell[][] };

/** previewCampImport's limits (camp-admin.functions.ts). */
export const MAX_ROWS = 3000;
export const MAX_COLS = 80;
export const MAX_SHEETS = 60;
const MAX_TEXT = 2000;
const MAX_SHEET_NAME = 120;
/** A registry or agenda workbook is a few hundred kilobytes; this only stops a wrong file. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [".xlsx", ".xls"];

export type ReadResult = {
  sheets: ImportSheet[];
  /** True when non-empty cells beyond the row or column limits were dropped. */
  truncated: boolean;
  /** Sheets beyond MAX_SHEETS that were not read. */
  skippedSheets: number;
};

type XlsxModule = typeof import("xlsx");

async function loadXlsx(): Promise<XlsxModule> {
  const mod = (await import("xlsx")) as XlsxModule & { default?: XlsxModule };
  return typeof mod.read === "function" ? mod : (mod.default ?? mod);
}

function toCell(value: unknown): ImportCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return String(value).slice(0, MAX_TEXT);
}

const isEmpty = (cell: ImportCell) => cell === null || (typeof cell === "string" && !cell.trim());

export function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function readWorkbook(file: File): Promise<ReadResult> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  let truncated = false;
  const sheets: ImportSheet[] = [];
  for (const name of wb.SheetNames.slice(0, MAX_SHEETS)) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    // blankrows keeps Excel's row numbers: row 2 of an agenda sheet holds the
    // date and phase, and issues quote the row as Excel shows it.
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: true,
    });
    const rows: ImportCell[][] = [];
    raw.forEach((source, index) => {
      const cells = (Array.isArray(source) ? source : []).map(toCell);
      if (index >= MAX_ROWS) {
        if (cells.some((c) => !isEmpty(c))) truncated = true;
        return;
      }
      if (cells.slice(MAX_COLS).some((c) => !isEmpty(c))) truncated = true;
      const row = cells.slice(0, MAX_COLS);
      // Trailing empty cells carry nothing: the parser reads columns by index.
      while (row.length && row[row.length - 1] === null) row.pop();
      rows.push(row);
    });
    while (rows.length && rows[rows.length - 1]!.every(isEmpty)) rows.pop();
    sheets.push({ name: name.slice(0, MAX_SHEET_NAME), rows });
  }
  return {
    sheets,
    truncated,
    skippedSheets: Math.max(0, wb.SheetNames.length - MAX_SHEETS),
  };
}
