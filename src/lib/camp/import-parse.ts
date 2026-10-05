/**
 * Camp operations — reading the registry and agenda workbooks (§3).
 *
 * The browser reads the file (SheetJS, raw cell values) and sends plain grids;
 * everything that UNDERSTANDS the grids is here, pure, so a parsing rule can be
 * tested without a browser or a database.
 *
 * Layout is found, not assumed: header rows are recognised by their words
 * (Arabic or English) wherever they appear — once at the top or repeated per
 * team block — and merged cells (team number, application, guider spanning a
 * block) are filled down. Anything the parser could not read becomes an
 * issue in the preview instead of a silent gap (FR-IMP-03, M11).
 */
import { classifySession, PHASES, sessionNaturalKey, type SessionType } from "./agenda.ts";
import { isValidSaudiMobile, normalizeEmail, normalizePhone } from "./match.ts";
import {
  addDays,
  compareTokenLists,
  daysBetween,
  fromRiyadh,
  nameTokens,
  normalizeArabicLetters,
  toWesternDigits,
} from "./text.ts";

export type Cell = string | number | boolean | null;
export type SheetGrid = { name: string; rows: Cell[][] };

export type IssueCode =
  | "sheet_missing"
  | "column_missing"
  | "phone_invalid"
  | "phone_duplicate"
  | "email_duplicate"
  | "count_mismatch"
  | "total_mismatch"
  | "guider_missing"
  | "member_without_team"
  | "date_missing"
  | "phase_missing"
  | "time_unreadable"
  | "end_before_start"
  | "day_outside_camp"
  | "day_duplicate";

export type ImportIssue = {
  code: IssueCode;
  sheet?: string;
  /** 1-based row number as Excel shows it. */
  row?: number;
  /** Free values for the message: name, value, team, expected, actual… */
  params?: Record<string, string | number>;
};

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function text(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return "";
  return toWesternDigits(String(cell)).replace(/\s+/g, " ").trim();
}

function norm(value: string): string {
  return normalizeArabicLetters(value)
    .toLowerCase()
    .replace(/[:：.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function intOf(cell: Cell | undefined): number | null {
  if (typeof cell === "number" && Number.isFinite(cell)) return Math.trunc(cell);
  const m = /(\d{1,5})/.exec(text(cell));
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Header recognition
// ---------------------------------------------------------------------------

type Field =
  | "team"
  | "application"
  | "guider"
  | "order"
  | "name"
  | "title"
  | "email"
  | "phone"
  | "notes"
  | "count"
  | "teams";

/** Longest keyword wins, so "رقم الفريق" is team and not a bare "رقم". */
const FIELD_KEYWORDS: Record<Field, { contains: string[]; exact: string[] }> = {
  team: {
    contains: ["رقم الفريق", "الفريق", "team no", "team number", "team #"],
    exact: ["فريق", "team"],
  },
  application: {
    contains: ["رقم الطلب", "الطلب", "application", "app no", "app #"],
    exact: ["طلب"],
  },
  guider: { contains: ["المرشد", "guider", "mentor"], exact: ["مرشد"] },
  order: {
    contains: ["الترتيب", "رقم العضو", "order"],
    exact: ["م", "#", "no", "ن", "ترتيب", "s/n", "sn"],
  },
  name: {
    contains: [
      "الاسم",
      "اسم المشارك",
      "اسم العضو",
      "اسم المرشد",
      "اسم المدرب",
      "full name",
      "name",
    ],
    exact: ["اسم"],
  },
  title: { contains: ["الصفه", "الدور", "المسمى", "title", "role", "position"], exact: ["صفه"] },
  email: { contains: ["البريد", "الايميل", "الإيميل", "email", "e-mail", "mail"], exact: [] },
  phone: { contains: ["الجوال", "رقم الجوال", "الهاتف", "phone", "mobile", "جوال"], exact: [] },
  notes: { contains: ["ملاحظات", "ملاحظه", "notes", "note", "remarks"], exact: [] },
  count: { contains: ["عدد الاعضاء", "عدد", "members", "count"], exact: [] },
  teams: { contains: ["الفرق", "الفرق المسنده", "assigned teams", "teams"], exact: [] },
};

function fieldOf(header: string): { field: Field; weight: number } | null {
  const h = norm(header);
  if (!h || h.length > 40) return null;
  let best: { field: Field; weight: number } | null = null;
  for (const [field, kw] of Object.entries(FIELD_KEYWORDS) as [
    Field,
    (typeof FIELD_KEYWORDS)[Field],
  ][]) {
    for (const e of kw.exact)
      if (h === norm(e) && (!best || 100 > best.weight)) best = { field, weight: 100 };
    for (const c of kw.contains) {
      const k = norm(c);
      if (h.includes(k) && (!best || k.length > best.weight)) best = { field, weight: k.length };
    }
  }
  return best;
}

type ColumnMap = Partial<Record<Field, number>>;

/** A row is a header when ≥2 distinct fields are recognised and one of them is `name`. */
function headerOf(row: Cell[]): ColumnMap | null {
  const map: ColumnMap = {};
  const weights: Partial<Record<Field, number>> = {};
  row.forEach((cell, index) => {
    if (typeof cell === "number") return;
    const hit = fieldOf(text(cell));
    if (!hit) return;
    if (map[hit.field] === undefined || (weights[hit.field] ?? 0) < hit.weight) {
      map[hit.field] = index;
      weights[hit.field] = hit.weight;
    }
  });
  const fields = Object.keys(map) as Field[];
  // A guiders sheet titles its name column "Guider name" / "المرشد": with no
  // separate name column, the guider column IS the name.
  if (map.name === undefined && map.guider !== undefined && fields.length >= 2) {
    map.name = map.guider;
    delete map.guider;
  }
  if (fields.length < 2 || map.name === undefined) return null;
  // "المرشد" in a registry team header is the guider column, but a guiders
  // sheet's NAME column is often titled "اسم المرشد": name wins there.
  if (map.guider === map.name) delete map.guider;
  if (map.team === map.teams) delete map.team;
  return map;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type ParsedPerson = {
  kind: "participant" | "guider" | "coach";
  name: string;
  teamNo: number | null;
  memberOrder: number | null;
  title: "leader" | "member" | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  sourceSheet: string;
  sourceRow: number;
  naturalKey: string;
};

export type ParsedTeam = {
  teamNo: number;
  applicationNo: string | null;
  guiderName: string | null;
  declaredMembers: number | null;
  notes: string | null;
};

export type ParsedRegistry = {
  teams: ParsedTeam[];
  people: ParsedPerson[];
  /** guider natural key → team numbers */
  guiderTeams: { guiderKey: string; teamNo: number }[];
  /** The registry's own "total" row, when it has one. */
  declaredTotal: number | null;
};

export function personNaturalKey(
  kind: ParsedPerson["kind"],
  name: string,
  teamNo: number | null,
): string {
  const n = nameTokens(name).join(" ");
  return kind === "participant" ? `p|${teamNo ?? 0}|${n}` : `${kind[0]}|${n}`;
}

type SheetRole = "teams" | "guiders" | "coaches";

export function sheetRole(name: string): SheetRole | null {
  const n = norm(name);
  if (/مرشد|guider|mentor/.test(n)) return "guiders";
  if (/مدرب|coach|trainer/.test(n)) return "coaches";
  if (/فرق|فريق|مشارك|team|participant/.test(n)) return "teams";
  return null;
}

const TEAM_MARKER = /(?:^|\s)(?:الفريق|فريق|team)\s*(?:رقم|no|#)?\s*(\d{1,3})(?:\s|$)/;
const COUNT_MARKER =
  /(?:عدد(?:\s*الاعضاء)?\s*(\d{1,3}))|(?:(\d{1,3})\s*(?:اعضاء|عضو|members?))|(?:members?\s*(?:count)?\s*(\d{1,3}))/;
const APP_MARKER = /(?:رقم\s*الطلب|الطلب|application|app)\s*(?:no|#)?\s*(\d{3,8})/;
const GUIDER_MARKER =
  /(?:المرشد|مرشد|guider|mentor)\s+(.+?)(?:\s+(?:عدد|رقم|application|members)|$)/;
const TOTAL_MARKER = /(?:المجموع|الاجمالي|الإجمالي|اجمالي|total)/;

function titleOf(value: string): "leader" | "member" | null {
  const n = norm(value);
  if (!n) return null;
  if (/قائد|رئيس|leader|lead|captain/.test(n)) return "leader";
  return "member";
}

/** Rows of one sheet as people, with team context filled down. */
function readPeopleSheet(
  sheet: SheetGrid,
  kind: ParsedPerson["kind"],
  issues: ImportIssue[],
  teams: Map<number, ParsedTeam>,
  totals: { declared: number | null },
): ParsedPerson[] {
  const people: ParsedPerson[] = [];
  let cols: ColumnMap | null = null;
  let team: number | null = null;
  let application: string | null = null;
  let guider: string | null = null;

  const ensureTeam = (teamNo: number): ParsedTeam => {
    const existing = teams.get(teamNo);
    if (existing) return existing;
    const created: ParsedTeam = {
      teamNo,
      applicationNo: null,
      guiderName: null,
      declaredMembers: null,
      notes: null,
    };
    teams.set(teamNo, created);
    return created;
  };

  sheet.rows.forEach((row, index) => {
    const rowNo = index + 1;
    const header = headerOf(row);
    if (header) {
      cols = header;
      return;
    }
    const joined = norm(row.map(text).filter(Boolean).join(" "));
    if (!joined) return;

    if (kind === "participant" && TOTAL_MARKER.test(joined)) {
      const n = /(\d{1,4})/.exec(joined);
      if (n) totals.declared = Number(n[1]);
      return;
    }

    const c = cols as ColumnMap | null;
    const nameCell = c?.name !== undefined ? text(row[c.name]) : "";

    if (kind === "participant") {
      // Team context: an explicit team column (merged cells fill down), or a
      // block header line such as "الفريق 5 — رقم الطلب 10626 — المرشد …".
      const teamCell = c?.team !== undefined ? intOf(row[c.team]) : null;
      const marker = TEAM_MARKER.exec(joined);
      const blockHeader = !nameCell && (teamCell !== null || !!marker);
      if (teamCell !== null || (marker && !nameCell)) {
        const next = teamCell ?? Number(marker?.[1]);
        if (next !== team) {
          team = next;
          application = null;
          guider = null;
        }
        const t = ensureTeam(team);
        const app =
          c?.application !== undefined
            ? text(row[c.application])
            : (APP_MARKER.exec(joined)?.[1] ?? "");
        if (app) application = app;
        const g = c?.guider !== undefined ? text(row[c.guider]) : "";
        const gm = !g && blockHeader ? GUIDER_MARKER.exec(joined)?.[1]?.trim() : "";
        if (g || gm) guider = g || gm || null;
        const countCell = c?.count !== undefined ? intOf(row[c.count]) : null;
        const countMatch = blockHeader ? COUNT_MARKER.exec(joined) : null;
        const declared =
          countCell ??
          (countMatch ? Number(countMatch[1] ?? countMatch[2] ?? countMatch[3]) : null);
        if (declared !== null && (blockHeader || c?.count !== undefined))
          t.declaredMembers = declared;
        if (application) t.applicationNo = application;
        if (guider) t.guiderName = guider;
      }
      if (!nameCell) return;
      if (team === null) {
        issues.push({
          code: "member_without_team",
          sheet: sheet.name,
          row: rowNo,
          params: { name: nameCell },
        });
        return;
      }
    } else if (!nameCell) {
      return;
    }

    const email = c?.email !== undefined ? text(row[c.email]) || null : null;
    const phoneRaw = c?.phone !== undefined ? text(row[c.phone]) || null : null;
    const person: ParsedPerson = {
      kind,
      name: nameCell,
      teamNo: kind === "participant" ? team : null,
      memberOrder: c?.order !== undefined ? intOf(row[c.order]) : null,
      title: kind === "participant" && c?.title !== undefined ? titleOf(text(row[c.title])) : null,
      email,
      phone: phoneRaw,
      notes: c?.notes !== undefined ? text(row[c.notes]) || null : null,
      sourceSheet: sheet.name,
      sourceRow: rowNo,
      naturalKey: personNaturalKey(kind, nameCell, kind === "participant" ? team : null),
    };
    people.push(person);

    if (kind === "guider" && c?.teams !== undefined) {
      const teamList = text(row[c.teams]).match(/\d{1,3}/g) ?? [];
      (person as ParsedPerson & { teams?: number[] }).teams = teamList.map(Number);
    }
  });

  if (!cols && sheet.rows.length)
    issues.push({ code: "column_missing", sheet: sheet.name, params: { field: "name" } });
  return people;
}

export function parseRegistry(sheets: readonly SheetGrid[]): {
  parsed: ParsedRegistry;
  issues: ImportIssue[];
} {
  const issues: ImportIssue[] = [];
  const byRole = new Map<SheetRole, SheetGrid>();
  sheets.forEach((sheet) => {
    const role = sheetRole(sheet.name);
    if (role && !byRole.has(role)) byRole.set(role, sheet);
  });
  // Unnamed sheets: fall back to the documented order (teams, guiders, coaches).
  const order: SheetRole[] = ["teams", "guiders", "coaches"];
  sheets.forEach((sheet, index) => {
    const role = order[index];
    if (role && !byRole.has(role) && ![...byRole.values()].includes(sheet)) byRole.set(role, sheet);
  });
  for (const role of order)
    if (!byRole.has(role)) issues.push({ code: "sheet_missing", params: { sheet: role } });

  const teams = new Map<number, ParsedTeam>();
  const totals = { declared: null as number | null };
  const participants = byRole.has("teams")
    ? readPeopleSheet(byRole.get("teams")!, "participant", issues, teams, totals)
    : [];
  const guiders = byRole.has("guiders")
    ? readPeopleSheet(byRole.get("guiders")!, "guider", issues, teams, totals)
    : [];
  const coaches = byRole.has("coaches")
    ? readPeopleSheet(byRole.get("coaches")!, "coach", issues, teams, totals)
    : [];

  // Guider assignments: the team sheet names a guider per team; the guiders
  // sheet may also list teams. Both feed the same table.
  const guiderTeams: { guiderKey: string; teamNo: number }[] = [];
  const guiderTokens = guiders.map((g) => ({ g, tokens: nameTokens(g.name) }));
  for (const t of [...teams.values()].sort((a, b) => a.teamNo - b.teamNo)) {
    if (!t.guiderName) continue;
    const want = nameTokens(t.guiderName);
    let best: { key: string; score: number } | null = null;
    for (const { g, tokens } of guiderTokens) {
      const score = compareTokenLists(want, tokens).score;
      if (!best || score > best.score) best = { key: g.naturalKey, score };
    }
    if (best && best.score >= 85) guiderTeams.push({ guiderKey: best.key, teamNo: t.teamNo });
    else issues.push({ code: "guider_missing", params: { team: t.teamNo, guider: t.guiderName } });
  }
  for (const g of guiders as (ParsedPerson & { teams?: number[] })[]) {
    for (const teamNo of g.teams ?? []) {
      if (!guiderTeams.some((x) => x.guiderKey === g.naturalKey && x.teamNo === teamNo)) {
        guiderTeams.push({ guiderKey: g.naturalKey, teamNo });
      }
    }
    delete g.teams;
  }

  const people = [...participants, ...guiders, ...coaches];

  // FR-IMP-03 validation.
  const phoneOwners = new Map<string, ParsedPerson[]>();
  const emailOwners = new Map<string, ParsedPerson[]>();
  for (const p of people) {
    if (p.phone) {
      if (!isValidSaudiMobile(p.phone)) {
        issues.push({
          code: "phone_invalid",
          sheet: p.sourceSheet,
          row: p.sourceRow,
          params: { name: p.name, value: p.phone },
        });
      }
      const key = normalizePhone(p.phone);
      if (key) phoneOwners.set(key, [...(phoneOwners.get(key) ?? []), p]);
    }
    const email = normalizeEmail(p.email);
    if (email) emailOwners.set(email, [...(emailOwners.get(email) ?? []), p]);
  }
  for (const [value, owners] of phoneOwners) {
    // One person in two sheets (a guider who is also a coach) shares a phone
    // with themself; that is FR-DUP-04's finding, not an import error.
    if (new Set(owners.map((o) => nameTokens(o.name).join(" "))).size > 1) {
      issues.push({
        code: "phone_duplicate",
        params: { value, names: owners.map((o) => o.name).join("، ") },
      });
    }
  }
  for (const [value, owners] of emailOwners) {
    if (new Set(owners.map((o) => nameTokens(o.name).join(" "))).size > 1) {
      issues.push({
        code: "email_duplicate",
        params: { value, names: owners.map((o) => o.name).join("، ") },
      });
    }
  }
  for (const t of teams.values()) {
    const listed = participants.filter((p) => p.teamNo === t.teamNo).length;
    if (t.declaredMembers !== null && t.declaredMembers !== listed) {
      issues.push({
        code: "count_mismatch",
        params: { team: t.teamNo, expected: t.declaredMembers, actual: listed },
      });
    }
  }
  if (totals.declared !== null && totals.declared !== participants.length) {
    issues.push({
      code: "total_mismatch",
      params: { expected: totals.declared, actual: participants.length },
    });
  }

  // Same natural key twice in one upload (a pasted row) would collide on save.
  const seen = new Set<string>();
  const unique = people.filter((p) => {
    if (seen.has(p.naturalKey)) return false;
    seen.add(p.naturalKey);
    return true;
  });

  return {
    parsed: {
      teams: [...teams.values()].sort((a, b) => a.teamNo - b.teamNo),
      people: unique,
      guiderTeams,
      declaredTotal: totals.declared,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

export type ParsedDay = {
  dayNo: number;
  date: string;
  phase: string | null;
  header: string;
  sheetName: string;
};
export type ParsedSession = {
  dayNo: number;
  seq: number;
  /** ISO instants. */
  startsAt: string;
  endsAt: string;
  title: string;
  autoType: SessionType;
  naturalKey: string;
};
export type ParsedAgenda = { days: ParsedDay[]; sessions: ParsedSession[] };

const AR_MONTH_INDEX: Record<string, number> = {
  يناير: 1,
  فبراير: 2,
  مارس: 3,
  ابريل: 4,
  مايو: 5,
  يونيو: 6,
  يوليو: 7,
  اغسطس: 8,
  سبتمبر: 9,
  اكتوبر: 10,
  نوفمبر: 11,
  ديسمبر: 12,
  october: 10,
  oct: 10,
  september: 9,
  sep: 9,
  november: 11,
  nov: 11,
};

/** Excel serial day 1 = 1900-01-01 (with the 1900 leap-year bug: base 1899-12-30). */
function excelDate(serial: number): string {
  return addDays("1899-12-30", Math.floor(serial));
}

function dateOf(cell: Cell | undefined, year: number): string | null {
  if (typeof cell === "number" && cell > 30000 && cell < 80000) return excelDate(cell);
  const t = norm(text(cell));
  if (!t) return null;
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /(\d{1,2})\s*[/\\]\s*(\d{1,2})(?:\s*[/\\]\s*(\d{2,4}))?/.exec(t);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
    return `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  m = /(\d{1,2})\s+([\p{L}]+)(?:\s+(\d{4}))?/u.exec(t);
  if (m) {
    const month = AR_MONTH_INDEX[m[2] ?? ""];
    if (month) return `${m[3] ?? year}-${String(month).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

function phaseOf(value: string): string | null {
  const n = norm(value);
  for (const phase of PHASES) if (n.includes(norm(phase))) return phase;
  return null;
}

/** Minutes after midnight, or null. Hours 1–11 with no am/pm read as pm: the camp runs 1:35 pm–10 pm. */
function clockMinutes(hour: number, minute: number, marker: string): number | null {
  if (minute > 59 || hour > 23) return null;
  const m = norm(marker);
  let h = hour;
  if (/^(م|مساء|مساءا|مساءً|ظهرا|ظهرًا|عصرا|pm|p)$/.test(m)) {
    if (h < 12) h += 12;
  } else if (/^(ص|صباحا|صباحًا|am|a)$/.test(m)) {
    if (h === 12) h = 0;
  } else if (h >= 1 && h <= 11) {
    h += 12;
  }
  return h * 60 + minute;
}

// The marker must end the word: "5:30 صالة" is not "5:30 ص".
const CLOCK =
  /(\d{1,2})\s*[:.٫]\s*(\d{2})\s*(صباحًا|صباحا|مساءً|مساءا|مساء|ظهرًا|ظهرا|عصرا|ص|م|am|pm|a|p)?(?![\p{L}])/giu;

/** Every clock time in a cell, in order. */
function clocksOf(cell: Cell | undefined): number[] {
  if (typeof cell === "number") {
    if (cell > 0 && cell < 1) return [Math.round(cell * 1440)];
    if (cell > 1 && cell % 1 !== 0) return [Math.round((cell % 1) * 1440)];
    return [];
  }
  const t = text(cell);
  const out: number[] = [];
  for (const m of t.matchAll(CLOCK)) {
    const minutes = clockMinutes(Number(m[1]), Number(m[2]), m[3] ?? "");
    if (minutes !== null) out.push(minutes);
  }
  return out;
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// Matched against norm(): إلى arrives as "الي".
const AGENDA_HEADER =
  /^(?:الوقت|من|الي|الى|البدايه|النهايه|الفقره|الفقرات|البرنامج|العنوان|start|end|time|title|item|session)$/;

export function parseAgenda(
  sheets: readonly SheetGrid[],
  opts: { startDate: string; dayCount: number },
): { parsed: ParsedAgenda; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const days: ParsedDay[] = [];
  const sessions: ParsedSession[] = [];
  const year = Number(opts.startDate.slice(0, 4));

  sheets.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows;
    if (!rows.some((r) => r.some((c) => text(c)))) return;
    // Date and phase: the sheet's second row (§3), with the first rows as a fallback.
    let date: string | null = null;
    let phase: string | null = null;
    for (const r of [rows[1] ?? [], rows[0] ?? [], rows[2] ?? []]) {
      for (const c of r) {
        date ??= dateOf(c, year);
        phase ??= phaseOf(text(c));
      }
    }
    const nameDay = /(\d{1,2})/.exec(toWesternDigits(sheet.name));
    let dayNo: number;
    if (date) dayNo = daysBetween(opts.startDate, date) + 1;
    else if (nameDay) dayNo = Number(nameDay[1]);
    else dayNo = sheetIndex + 1;
    if (!date) {
      issues.push({ code: "date_missing", sheet: sheet.name });
      date = addDays(opts.startDate, dayNo - 1);
    }
    if (!phase) issues.push({ code: "phase_missing", sheet: sheet.name });
    if (dayNo < 1 || dayNo > opts.dayCount) {
      issues.push({ code: "day_outside_camp", sheet: sheet.name, params: { date, day: dayNo } });
      return;
    }
    if (days.some((d) => d.dayNo === dayNo)) {
      issues.push({ code: "day_duplicate", sheet: sheet.name, params: { day: dayNo } });
      return;
    }
    days.push({
      dayNo,
      date,
      phase,
      header: rows[0]?.map(text).filter(Boolean).join(" ") ?? "",
      sheetName: sheet.name,
    });

    const items: { start: number; end: number | null; title: string; row: number }[] = [];
    for (let i = 2; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      const cells = row.map(text);
      if (!cells.some(Boolean)) continue;
      if (cells.filter(Boolean).every((c) => AGENDA_HEADER.test(norm(c)))) continue;
      const clocks = row.flatMap((c) => clocksOf(c));
      // Title: the longest cell with letters that is not itself a time.
      const title = cells
        .filter((c) => /\p{L}{2,}/u.test(c) && clocksOf(c).length === 0)
        .sort((a, b) => b.length - a.length)[0];
      if (!title) continue;
      if (!clocks.length) {
        issues.push({ code: "time_unreadable", sheet: sheet.name, row: i + 1, params: { title } });
        continue;
      }
      items.push({ start: clocks[0]!, end: clocks[1] ?? null, title, row: i + 1 });
    }
    const occurrences = new Map<string, number>();
    items.forEach((item, index) => {
      const end = item.end ?? items[index + 1]?.start ?? item.start;
      if (end < item.start) {
        issues.push({
          code: "end_before_start",
          sheet: sheet.name,
          row: item.row,
          params: { title: item.title },
        });
        return;
      }
      const key = norm(item.title);
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      sessions.push({
        dayNo,
        seq: index + 1,
        startsAt: fromRiyadh(date!, hhmm(item.start)).toISOString(),
        endsAt: fromRiyadh(date!, hhmm(end)).toISOString(),
        title: item.title,
        autoType: classifySession(item.title, end - item.start),
        naturalKey: sessionNaturalKey(dayNo, item.title, occurrence),
      });
    });
  });

  days.sort((a, b) => a.dayNo - b.dayNo);
  return { parsed: { days, sessions }, issues };
}

// ---------------------------------------------------------------------------
// Diff (FR-IMP-07)
// ---------------------------------------------------------------------------

export type RecordDiff<T> = {
  added: T[];
  removed: T[];
  changed: { before: T; after: T; fields: string[] }[];
  unchanged: number;
};

export function diffRecords<T extends { naturalKey: string }>(
  current: readonly T[],
  next: readonly T[],
  fields: readonly (keyof T & string)[],
): RecordDiff<T> {
  const before = new Map(current.map((r) => [r.naturalKey, r]));
  const after = new Map(next.map((r) => [r.naturalKey, r]));
  const out: RecordDiff<T> = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [key, row] of after) {
    const old = before.get(key);
    if (!old) {
      out.added.push(row);
      continue;
    }
    const changedFields = fields.filter((f) => String(old[f] ?? "") !== String(row[f] ?? ""));
    if (changedFields.length) out.changed.push({ before: old, after: row, fields: changedFields });
    else out.unchanged += 1;
  }
  for (const [key, row] of before) if (!after.has(key)) out.removed.push(row);
  return out;
}
