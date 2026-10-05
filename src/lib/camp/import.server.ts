/**
 * Camp operations — registry and agenda imports (FR-IMP-01..07).
 *
 * Two steps, always: a PREVIEW parses, validates and diffs against what is
 * stored, and is saved as a camp_imports row; APPLY writes that exact preview
 * in one transaction. Nothing an operator has not seen is ever written.
 *
 * Records are upserted by natural key, so a re-upload keeps the ids that links,
 * overrides and decisions point at. A record missing from the new file is
 * removed (the preview lists it under "removed").
 */
import type { PoolClient } from "pg";
import { cueShifts, type CueLite } from "./cues";
import { audit, getState, loadSettings, q, setState, tx } from "./db.server";
import {
  diffRecords,
  parseAgenda,
  parseRegistry,
  type ParsedAgenda,
  type ParsedRegistry,
  type SheetGrid,
} from "./import-parse";
import { loadCues } from "./automation.server";
import { TEAM_ROOM_AR } from "./copy-ar";
import { riyadhHHMM } from "./text";
import type { ImportPreview } from "./types";

type StoredImport = {
  id: string;
  kind: "registry" | "agenda";
  file_name: string;
  status: "preview" | "applied" | "discarded";
  parsed: ParsedRegistry | ParsedAgenda;
  issues: ImportPreview["issues"];
  diff: {
    entities: ImportPreview["diff"];
    summary: Record<string, number>;
    cueShifts: ImportPreview["cueShifts"];
  };
  created_at: Date;
};

function toPreview(row: StoredImport): ImportPreview {
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.file_name,
    issues: row.issues,
    summary: row.diff.summary ?? {},
    diff: row.diff.entities ?? [],
    cueShifts: row.diff.cueShifts ?? [],
    createdAt: row.created_at.toISOString(),
    status: row.status,
  };
}

const label = {
  person: (p: { name: string; teamNo?: number | null; team_no?: number | null; kind: string }) => {
    const team = p.teamNo ?? p.team_no;
    return team ? `${p.name} (${team})` : p.name;
  },
};

async function registryDiff(parsed: ParsedRegistry) {
  const [people, teams, assignments] = await Promise.all([
    q<{
      natural_key: string;
      kind: string;
      name: string;
      team_no: number | null;
      member_order: number | null;
      title: string | null;
      email: string | null;
      phone: string | null;
      notes: string | null;
    }>(
      `select natural_key, kind, name, team_no, member_order, title, email, phone, notes from public.camp_people`,
    ),
    q<{
      team_no: number;
      application_no: string | null;
      guider_name: string | null;
      declared_members: number | null;
    }>(`select team_no, application_no, guider_name, declared_members from public.camp_teams`),
    q<{ natural_key: string; team_no: number }>(
      `select p.natural_key, g.team_no from public.camp_guider_teams g join public.camp_people p on p.id = g.guider_id`,
    ),
  ]);
  const peopleDiff = diffRecords(
    people.map((p) => ({
      naturalKey: p.natural_key,
      kind: p.kind,
      name: p.name,
      teamNo: p.team_no,
      memberOrder: p.member_order,
      title: p.title,
      email: p.email,
      phone: p.phone,
      notes: p.notes,
    })),
    parsed.people.map((p) => ({
      naturalKey: p.naturalKey,
      kind: p.kind,
      name: p.name,
      teamNo: p.teamNo,
      memberOrder: p.memberOrder,
      title: p.title,
      email: p.email,
      phone: p.phone,
      notes: p.notes,
    })),
    ["name", "memberOrder", "title", "email", "phone", "notes"],
  );
  const teamDiff = diffRecords(
    teams.map((t) => ({
      naturalKey: String(t.team_no),
      teamNo: t.team_no,
      applicationNo: t.application_no,
      guiderName: t.guider_name,
      declaredMembers: t.declared_members,
    })),
    parsed.teams.map((t) => ({
      naturalKey: String(t.teamNo),
      teamNo: t.teamNo,
      applicationNo: t.applicationNo,
      guiderName: t.guiderName,
      declaredMembers: t.declaredMembers,
    })),
    ["applicationNo", "guiderName", "declaredMembers"],
  );
  const assignDiff = diffRecords(
    assignments.map((a) => ({ naturalKey: `${a.natural_key}#${a.team_no}` })),
    parsed.guiderTeams.map((a) => ({ naturalKey: `${a.guiderKey}#${a.teamNo}` })),
    [],
  );
  const guiderName = (key: string) =>
    parsed.people.find((p) => p.naturalKey === key.split("#")[0])?.name ??
    key.split("#")[0]!.split("|")[1];
  const entities: ImportPreview["diff"] = [
    {
      entity: "people",
      added: peopleDiff.added.map((p) => ({ key: p.naturalKey, label: label.person(p) })),
      removed: peopleDiff.removed.map((p) => ({ key: p.naturalKey, label: label.person(p) })),
      changed: peopleDiff.changed.map((c) => ({
        key: c.after.naturalKey,
        label: label.person(c.after),
        fields: c.fields,
      })),
      unchanged: peopleDiff.unchanged,
    },
    {
      entity: "teams",
      added: teamDiff.added.map((t) => ({ key: t.naturalKey, label: String(t.teamNo) })),
      removed: teamDiff.removed.map((t) => ({ key: t.naturalKey, label: String(t.teamNo) })),
      changed: teamDiff.changed.map((c) => ({
        key: c.after.naturalKey,
        label: String(c.after.teamNo),
        fields: c.fields,
      })),
      unchanged: teamDiff.unchanged,
    },
    {
      entity: "guiderTeams",
      added: assignDiff.added.map((a) => ({
        key: a.naturalKey,
        label: `${guiderName(a.naturalKey)} ← ${a.naturalKey.split("#")[1]}`,
      })),
      removed: assignDiff.removed.map((a) => ({
        key: a.naturalKey,
        label: `${guiderName(a.naturalKey)} ← ${a.naturalKey.split("#")[1]}`,
      })),
      changed: [],
      unchanged: assignDiff.unchanged,
    },
  ];
  const summary = {
    participants: parsed.people.filter((p) => p.kind === "participant").length,
    guiders: parsed.people.filter((p) => p.kind === "guider").length,
    coaches: parsed.people.filter((p) => p.kind === "coach").length,
    teams: parsed.teams.length,
  };
  return { entities, summary, cueShifts: [] as ImportPreview["cueShifts"] };
}

async function agendaDiff(parsed: ParsedAgenda) {
  const [days, sessions] = await Promise.all([
    q<{ day_no: number; date: string; phase: string | null }>(
      `select day_no, to_char(date, 'YYYY-MM-DD') as date, phase from public.camp_days`,
    ),
    q<{
      natural_key: string;
      day_no: number;
      title: string;
      starts_at: Date;
      ends_at: Date;
      auto_type: string;
    }>(
      `select natural_key, day_no, title, starts_at, ends_at, auto_type from public.camp_sessions`,
    ),
  ]);
  const dayDiff = diffRecords(
    days.map((d) => ({
      naturalKey: String(d.day_no),
      dayNo: d.day_no,
      date: d.date,
      phase: d.phase,
    })),
    parsed.days.map((d) => ({
      naturalKey: String(d.dayNo),
      dayNo: d.dayNo,
      date: d.date,
      phase: d.phase,
    })),
    ["date", "phase"],
  );
  const current = sessions.map((s) => ({
    naturalKey: s.natural_key,
    dayNo: s.day_no,
    title: s.title,
    start: riyadhHHMM(s.starts_at),
    end: riyadhHHMM(s.ends_at),
    type: s.auto_type,
  }));
  const next = parsed.sessions.map((s) => ({
    naturalKey: s.naturalKey,
    dayNo: s.dayNo,
    title: s.title,
    start: riyadhHHMM(new Date(s.startsAt)),
    end: riyadhHHMM(new Date(s.endsAt)),
    type: s.autoType,
  }));
  const sessionDiff = diffRecords(current, next, ["start", "end", "type"]);
  const sessionLabel = (s: { dayNo: number; start: string; title: string }) =>
    `${s.dayNo} · ${s.start} · ${s.title}`;
  const moved = sessionDiff.changed
    .filter((c) => c.fields.includes("start"))
    .map((c) => ({ dayNo: c.after.dayNo, oldStart: c.before.start, newStart: c.after.start }));
  const cues: CueLite[] = await loadCues();
  const entities: ImportPreview["diff"] = [
    {
      entity: "days",
      added: dayDiff.added.map((d) => ({ key: d.naturalKey, label: `${d.dayNo} · ${d.date}` })),
      removed: dayDiff.removed.map((d) => ({ key: d.naturalKey, label: `${d.dayNo} · ${d.date}` })),
      changed: dayDiff.changed.map((c) => ({
        key: c.after.naturalKey,
        label: `${c.after.dayNo} · ${c.after.date}`,
        fields: c.fields,
      })),
      unchanged: dayDiff.unchanged,
    },
    {
      entity: "sessions",
      added: sessionDiff.added.map((s) => ({ key: s.naturalKey, label: sessionLabel(s) })),
      removed: sessionDiff.removed.map((s) => ({ key: s.naturalKey, label: sessionLabel(s) })),
      changed: sessionDiff.changed.map((c) => ({
        key: c.after.naturalKey,
        label: sessionLabel(c.after),
        fields: c.fields,
      })),
      unchanged: sessionDiff.unchanged,
    },
  ];
  const summary = {
    days: parsed.days.length,
    sessions: parsed.sessions.length,
    counted: parsed.sessions.filter((s) =>
      [
        "workshop",
        "mentoring",
        "checkpoint",
        "inspirational",
        "pitch_coaching",
        "judging",
      ].includes(s.autoType),
    ).length,
  };
  return { entities, summary, cueShifts: cueShifts(cues, moved) };
}

export async function previewImport(
  kind: "registry" | "agenda",
  fileName: string,
  sheets: SheetGrid[],
  actor: string,
): Promise<ImportPreview> {
  const settings = await loadSettings();
  let parsed: ParsedRegistry | ParsedAgenda;
  let issues: ImportPreview["issues"];
  let diff: StoredImport["diff"];
  if (kind === "registry") {
    const result = parseRegistry(sheets);
    parsed = result.parsed;
    issues = result.issues;
    diff = await registryDiff(result.parsed);
  } else {
    const result = parseAgenda(sheets, {
      startDate: settings.startDate,
      dayCount: settings.dayCount,
    });
    parsed = result.parsed;
    issues = result.issues;
    diff = await agendaDiff(result.parsed);
  }
  const rows = await q<StoredImport>(
    `insert into public.camp_imports (kind, file_name, parsed, issues, diff, created_by)
     values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6) returning *`,
    [kind, fileName, JSON.stringify(parsed), JSON.stringify(issues), JSON.stringify(diff), actor],
  );
  return toPreview(rows[0]!);
}

export async function listImports(): Promise<ImportPreview[]> {
  const rows = await q<StoredImport>(
    `select id, kind, file_name, status, '{}'::jsonb as parsed, issues, diff, created_at
       from public.camp_imports order by created_at desc limit 30`,
  );
  return rows.map(toPreview);
}

async function applyRegistry(db: PoolClient, parsed: ParsedRegistry): Promise<void> {
  await db.query(
    `insert into public.camp_teams (team_no, application_no, guider_name, declared_members, notes)
     select x.team_no, x.application_no, x.guider_name, x.declared_members, x.notes
       from jsonb_to_recordset($1::jsonb) as x(team_no int, application_no text, guider_name text, declared_members int, notes text)
     on conflict (team_no) do update set application_no = excluded.application_no, guider_name = excluded.guider_name,
       declared_members = excluded.declared_members, notes = excluded.notes`,
    [
      JSON.stringify(
        parsed.teams.map((t) => ({
          team_no: t.teamNo,
          application_no: t.applicationNo,
          guider_name: t.guiderName,
          declared_members: t.declaredMembers,
          notes: t.notes,
        })),
      ),
    ],
  );
  await db.query(`delete from public.camp_teams where not (team_no = any($1::int[]))`, [
    parsed.teams.map((t) => t.teamNo),
  ]);
  await db.query(
    `insert into public.camp_people (kind, name, team_no, member_order, title, email, phone, notes, source_sheet, source_row, natural_key, updated_at)
     select x.kind, x.name, x.team_no, x.member_order, x.title, x.email, x.phone, x.notes, x.source_sheet, x.source_row, x.natural_key, now()
       from jsonb_to_recordset($1::jsonb) as x(kind text, name text, team_no int, member_order int, title text, email text,
            phone text, notes text, source_sheet text, source_row int, natural_key text)
     on conflict (natural_key) do update set kind = excluded.kind, name = excluded.name, team_no = excluded.team_no,
       member_order = excluded.member_order, title = excluded.title, email = excluded.email, phone = excluded.phone,
       notes = excluded.notes, source_sheet = excluded.source_sheet, source_row = excluded.source_row, updated_at = now()`,
    [
      JSON.stringify(
        parsed.people.map((p) => ({
          kind: p.kind,
          name: p.name,
          team_no: p.teamNo,
          member_order: p.memberOrder,
          title: p.title,
          email: p.email,
          phone: p.phone,
          notes: p.notes,
          source_sheet: p.sourceSheet,
          source_row: p.sourceRow,
          natural_key: p.naturalKey,
        })),
      ),
    ],
  );
  await db.query(`delete from public.camp_people where not (natural_key = any($1::text[]))`, [
    parsed.people.map((p) => p.naturalKey),
  ]);
  await db.query(`delete from public.camp_guider_teams`);
  await db.query(
    `insert into public.camp_guider_teams (guider_id, team_no)
     select p.id, x.team_no from jsonb_to_recordset($1::jsonb) as x(guider_key text, team_no int)
       join public.camp_people p on p.natural_key = x.guider_key
     on conflict do nothing`,
    [
      JSON.stringify(
        parsed.guiderTeams.map((g) => ({ guider_key: g.guiderKey, team_no: g.teamNo })),
      ),
    ],
  );
  // Every team gets a room on the map (FR-IMP-06); its topic and zone id are
  // filled in by an operator on the Data upload screen.
  for (const t of parsed.teams) {
    await db.query(
      `insert into public.camp_rooms (kind, team_no, label) select 'team', $1, $2
        where not exists (select 1 from public.camp_rooms where kind = 'team' and team_no = $1)`,
      [t.teamNo, TEAM_ROOM_AR(t.teamNo)],
    );
  }
}

async function applyAgenda(
  db: PoolClient,
  parsed: ParsedAgenda,
  shifts: ImportPreview["cueShifts"],
): Promise<void> {
  await db.query(
    `insert into public.camp_days (day_no, date, phase, header, sheet_name)
     select x.day_no, x.date, x.phase, x.header, x.sheet_name
       from jsonb_to_recordset($1::jsonb) as x(day_no int, date date, phase text, header text, sheet_name text)
     on conflict (day_no) do update set date = excluded.date, phase = excluded.phase, header = excluded.header,
       sheet_name = excluded.sheet_name`,
    [
      JSON.stringify(
        parsed.days.map((d) => ({
          day_no: d.dayNo,
          date: d.date,
          phase: d.phase,
          header: d.header,
          sheet_name: d.sheetName,
        })),
      ),
    ],
  );
  await db.query(`delete from public.camp_days where not (day_no = any($1::int[]))`, [
    parsed.days.map((d) => d.dayNo),
  ]);
  await db.query(
    `insert into public.camp_sessions (day_no, seq, starts_at, ends_at, title, auto_type, natural_key)
     select x.day_no, x.seq, x.starts_at, x.ends_at, x.title, x.auto_type, x.natural_key
       from jsonb_to_recordset($1::jsonb) as x(day_no int, seq int, starts_at timestamptz, ends_at timestamptz, title text,
            auto_type text, natural_key text)
     on conflict (natural_key) do update set day_no = excluded.day_no, seq = excluded.seq, starts_at = excluded.starts_at,
       ends_at = excluded.ends_at, title = excluded.title, auto_type = excluded.auto_type`,
    [
      JSON.stringify(
        parsed.sessions.map((s) => ({
          day_no: s.dayNo,
          seq: s.seq,
          starts_at: s.startsAt,
          ends_at: s.endsAt,
          title: s.title,
          auto_type: s.autoType,
          natural_key: s.naturalKey,
        })),
      ),
    ],
  );
  await db.query(`delete from public.camp_sessions where not (natural_key = any($1::text[]))`, [
    parsed.sessions.map((s) => s.naturalKey),
  ]);
  // FR-NOT-07: move the cues that followed a moved session, for that day only.
  for (const shift of shifts) {
    await db.query(
      `update public.camp_cues set day_times = day_times || jsonb_build_object($2::text, $3::text), updated_at = now() where key = $1`,
      [shift.cue, String(shift.dayNo), shift.to],
    );
  }
}

export async function applyImport(id: string, actor: string): Promise<ImportPreview> {
  const applied = await tx(async (db) => {
    const rows = await db.query<StoredImport>(
      `select * from public.camp_imports where id = $1 for update`,
      [id],
    );
    const row = rows.rows[0];
    if (!row) throw new Error("Import not found");
    if (row.status !== "preview") throw new Error("This upload was already applied or discarded");
    if (row.kind === "registry") await applyRegistry(db, row.parsed as ParsedRegistry);
    else await applyAgenda(db, row.parsed as ParsedAgenda, row.diff.cueShifts ?? []);
    // An older preview of the same kind no longer describes the stored data.
    await db.query(
      `update public.camp_imports set status = 'discarded' where kind = $1 and status = 'preview' and id <> $2`,
      [row.kind, id],
    );
    const updated = await db.query<StoredImport>(
      `update public.camp_imports set status = 'applied', applied_by = $2, applied_at = now() where id = $1 returning *`,
      [id, actor],
    );
    return updated.rows[0]!;
  });
  if (applied.kind === "registry") {
    // Re-arm the silent alert baseline (automation.server.ts detectAlerts).
    const baseline = await getState<{ at: string }>("alerts_baseline");
    if (baseline) await setState("alerts_baseline", { ...baseline, rearm: true });
  }
  await audit(actor, `import.${applied.kind}`, [], {
    importId: id,
    fileName: applied.file_name,
    summary: applied.diff.summary,
  });
  return toPreview(applied);
}

export async function discardImport(id: string): Promise<void> {
  await q(
    `update public.camp_imports set status = 'discarded' where id = $1 and status = 'preview'`,
    [id],
  );
}
