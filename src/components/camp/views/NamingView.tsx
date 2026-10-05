/**
 * Camp operations — مطابقة الأسماء (Module 3: naming compliance).
 *
 *   Summary       counts by status, by team and by event role, and the trend
 *                 per camp day (FR-NAM-06)
 *   Non-compliance list   every account with a note or a violation, its
 *                 issues (N01–N13), suggested name and phone, مخالف first
 *                 (FR-NAM-03/04); the correction message to one person or a
 *                 bulk selection, M01 or M02 per person (FR-NAM-05)
 *   Export        الأسماء المخالفة (FR-EXP-02), the rows filtered on screen
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Download, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, QueryState } from "@/components/ui/query-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { getCampNaming } from "@/lib/camp-read.functions";
import { NAMING_CODE_AR, NAMING_STATUS_AR } from "@/lib/camp/copy-ar";
import { VIOLATION_CODES } from "@/lib/camp/naming";
import { formatDateAr, formatTimeAr, riyadhDate } from "@/lib/camp/text";
import type {
  AccountRow,
  EventRole,
  NamingCode,
  NamingDayCount,
  NamingPayload,
  NamingStatus,
} from "@/lib/camp/types";
import { downloadWorkbook } from "../export-xlsx";
import {
  AccountTypeBadge,
  campKey,
  FilterSelect,
  NAMING_KEY,
  NamingBadge,
  matchesSearch,
  PageTitle,
  PersonLink,
  ROLE_KEY,
  SearchBox,
  SendMessageDialog,
  StatCard,
  ToneBadge,
  toneColor,
  useCampAbilities,
  useCampFormat,
  type Tone,
} from "../camp-ui";

const CODES = Object.keys(NAMING_CODE_AR) as NamingCode[];
const LISTED: Exclude<NamingStatus, "ok">[] = ["violation", "note"];
const ROLE_ORDER: EventRole[] = [
  "participant",
  "guider",
  "coach",
  "expert",
  "speaker",
  "supervisor",
  "unknown",
];
const STATUS_TONE: Record<NamingStatus, Tone> = { ok: "good", note: "warn", violation: "bad" };

const codeKey = (code: NamingCode) => `camp.naming.code.${code}` as MessageKey;

/** "5 أكتوبر 2026 8:30 مساءً" in Riyadh time: exports are Arabic whatever the UI language. */
function arDateTime(value: string | null): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return `${formatDateAr(riyadhDate(ms))} ${formatTimeAr(ms)}`;
}

export function NamingView() {
  const { t } = useTranslation();
  const fn = useServerFn(getCampNaming);
  const query = useQuery({
    queryKey: campKey("naming"),
    queryFn: () => fn(),
    refetchInterval: 120_000,
  });
  const d = query.data;
  // The breakdown panels drive the list's filters, so both live here.
  const [team, setTeam] = useState<string>("all");
  const [role, setRole] = useState<EventRole | "all">("all");

  return (
    <div className="space-y-6">
      <PageTitle title={t("camp.nav.naming")} description={t("camp.naming.description")} />
      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        skeletonRows={8}
      >
        {d ? (
          <>
            <Summary
              data={d}
              team={team}
              role={role}
              onTeam={(v) => setTeam((cur) => (cur === v ? "all" : v))}
              onRole={(v) => setRole((cur) => (cur === v ? "all" : v))}
            />
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{t("camp.naming.list")}</h3>
              {d.rows.length ? (
                <NonComplianceList
                  rows={d.rows}
                  team={team}
                  setTeam={setTeam}
                  role={role}
                  setRole={setRole}
                />
              ) : (
                <EmptyState icon={CheckCircle2} title={t("camp.msg.M13")} />
              )}
            </section>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary (FR-NAM-06)
// ---------------------------------------------------------------------------

function Summary({
  data,
  team,
  role,
  onTeam,
  onRole,
}: {
  data: NamingPayload;
  team: string;
  role: EventRole | "all";
  onTeam: (team: string) => void;
  onRole: (role: EventRole) => void;
}) {
  const { t } = useTranslation();
  const { counts } = data;
  const total = counts.ok + counts.note + counts.violation;
  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const byRole = [...data.byRole].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  );
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-3">
        {(["ok", "note", "violation"] as const).map((s) => (
          <StatCard
            key={s}
            label={t(NAMING_KEY[s])}
            value={counts[s]}
            tone={s === "ok" || counts[s] === 0 ? "good" : STATUS_TONE[s]}
            hint={t("camp.naming.share", { percent: share(counts[s]) })}
          />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <BreakdownPanel title={t("camp.naming.byTeam")} empty={!data.byTeam.length}>
          {data.byTeam.map((r) => (
            <BreakdownRow
              key={r.teamNo}
              label={t("camp.common.teamN", { n: r.teamNo })}
              violation={r.violation}
              note={r.note}
              active={team === String(r.teamNo)}
              onClick={() => onTeam(String(r.teamNo))}
            />
          ))}
        </BreakdownPanel>
        <BreakdownPanel title={t("camp.naming.byRole")} empty={!byRole.length}>
          {byRole.map((r) => (
            <BreakdownRow
              key={r.role}
              label={t(ROLE_KEY[r.role])}
              violation={r.violation}
              note={r.note}
              active={role === r.role}
              onClick={() => onRole(r.role)}
            />
          ))}
        </BreakdownPanel>
        <TrendPanel trend={data.trend} />
      </section>
    </>
  );
}

function BreakdownPanel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {!empty ? (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("camp.naming.filterHint")}</p>
          <div className="mt-3 max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1.5 text-start font-normal" />
                  <th className="pb-1.5 text-end font-normal">
                    {t("camp.status.namingViolation")}
                  </th>
                  <th className="pb-1.5 text-end font-normal">{t("camp.status.namingNote")}</th>
                </tr>
              </thead>
              <tbody>{children}</tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{t("camp.msg.M13")}</p>
      )}
    </div>
  );
}

function BreakdownRow({
  label,
  violation,
  note,
  active,
  onClick,
}: {
  label: string;
  violation: number;
  note: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <tr className={cn("border-t", active && "bg-muted/60")}>
      <td className="py-1.5">
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          className="text-start hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {label}
        </button>
      </td>
      <td
        className="py-1.5 text-end tabular-nums"
        style={violation ? { color: toneColor("bad") } : undefined}
      >
        {violation}
      </td>
      <td
        className="py-1.5 text-end tabular-nums"
        style={note ? { color: toneColor("warn") } : undefined}
      >
        {note}
      </td>
    </tr>
  );
}

function TrendPanel({ trend }: { trend: NamingDayCount[] }) {
  const { t } = useTranslation();
  const order: NamingStatus[] = ["violation", "note", "ok"];
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{t("camp.naming.trend")}</h3>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {order.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: toneColor(STATUS_TONE[s]) }}
              aria-hidden
            />
            {t(NAMING_KEY[s])}
          </span>
        ))}
      </div>
      {trend.length ? (
        <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          {trend.map((day) => {
            const total = day.ok + day.note + day.violation;
            return (
              <li
                key={day.dayNo}
                className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-xs"
              >
                <span className="text-muted-foreground">
                  {t("camp.common.dayN", { n: day.dayNo })}
                </span>
                <div
                  className="flex h-2.5 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={t("camp.naming.daySummary", {
                    day: day.dayNo,
                    violation: day.violation,
                    note: day.note,
                    ok: day.ok,
                  })}
                >
                  {total
                    ? order.map((s) =>
                        day[s] ? (
                          <span
                            key={s}
                            className="h-full"
                            style={{
                              width: `${(day[s] / total) * 100}%`,
                              backgroundColor: toneColor(STATUS_TONE[s]),
                            }}
                          />
                        ) : null,
                      )
                    : null}
                </div>
                <span className="whitespace-nowrap tabular-nums" aria-hidden>
                  <span style={{ color: toneColor("bad") }}>{day.violation}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span style={{ color: toneColor("warn") }}>{day.note}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{t("camp.naming.noTrend")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Non-compliance list (FR-NAM-03/05, FR-EXP-02)
// ---------------------------------------------------------------------------

function NonComplianceList({
  rows: all,
  team,
  setTeam,
  role,
  setRole,
}: {
  rows: AccountRow[];
  team: string;
  setTeam: (v: string) => void;
  role: EventRole | "all";
  setRole: (v: EventRole | "all") => void;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Exclude<NamingStatus, "ok"> | "all">("all");
  const [code, setCode] = useState<NamingCode | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [sendIds, setSendIds] = useState<string[]>([]);
  const openSend = (ids: string[]) => {
    setSendIds(ids);
    setSendOpen(true);
  };

  // Offer only values that occur in the list, so no filter can empty it by itself.
  const options = useMemo(() => {
    const codes = new Set<NamingCode>();
    const teams = new Set<number>();
    const roles = new Set<EventRole>();
    for (const r of all) {
      r.issues.forEach((c) => codes.add(c));
      if (r.teamNo !== null) teams.add(r.teamNo);
      roles.add(r.eventRole);
    }
    return {
      codes: CODES.filter((c) => codes.has(c)),
      teams: [...teams].sort((a, b) => a - b),
      roles: ROLE_ORDER.filter((r) => roles.has(r)),
    };
  }, [all]);

  // The server already sorts مخالف first, then by team and name.
  const rows = useMemo(
    () =>
      all
        .filter((r) => status === "all" || r.naming === status)
        .filter((r) => code === "all" || r.issues.includes(code))
        .filter((r) => team === "all" || String(r.teamNo ?? "") === team)
        .filter((r) => role === "all" || r.eventRole === role)
        .filter((r) =>
          matchesSearch(search, [
            r.name,
            r.registryName,
            r.suggestedName,
            r.phone,
            r.teamNo,
            r.guiderName,
          ]),
        ),
    [all, status, code, team, role, search],
  );

  // Selection survives filtering, but never outlives the account's row.
  const selectedIds = all.filter((r) => selected.has(r.swUserId)).map((r) => r.swUserId);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.swUserId));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((r) => next.delete(r.swUserId));
      else rows.forEach((r) => next.add(r.swUserId));
      return next;
    });
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportRows = (list: AccountRow[]) =>
    downloadWorkbook("الأسماء المخالفة", [
      {
        name: "الأسماء المخالفة",
        headers: [
          "الاسم كما يظهر",
          "الملاحظات",
          "الاسم المقترح",
          "الجوال",
          "الفريق",
          "المرشد",
          "تاريخ إرسال الرسالة",
          "تاريخ التصحيح",
          "الحالة",
        ],
        rows: list.map((r) => [
          r.name,
          r.issues.map((c) => NAMING_CODE_AR[c]).join("، "),
          r.suggestedName,
          r.phone,
          r.teamNo,
          r.guiderName,
          arDateTime(r.lastNamingMessageAt),
          arDateTime(r.nameFixedAt),
          NAMING_STATUS_AR[r.naming],
        ]),
      },
    ]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder={t("camp.users.searchHint")} />
        <FilterSelect
          label={t("camp.common.status")}
          value={status}
          onChange={setStatus}
          options={LISTED.map((s) => ({ value: s, label: t(NAMING_KEY[s]) }))}
        />
        <FilterSelect
          label={t("camp.naming.check")}
          value={code}
          onChange={setCode}
          options={options.codes.map((c) => ({ value: c, label: `${c} · ${t(codeKey(c))}` }))}
        />
        <FilterSelect
          label={t("camp.col.team")}
          value={team}
          onChange={setTeam}
          options={options.teams.map((n) => ({ value: String(n), label: String(n) }))}
        />
        <FilterSelect
          label={t("camp.col.role")}
          value={role}
          onChange={setRole}
          options={options.roles.map((r) => ({ value: r, label: t(ROLE_KEY[r]) }))}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {t("camp.users.showing", { shown: rows.length, total: all.length })}
          {selectedIds.length
            ? ` · ${t("camp.users.selected", { count: selectedIds.length })}`
            : ""}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void exportRows(rows)}>
            <Download className="me-1 h-4 w-4" />
            {t("camp.btn.exportExcel")}
          </Button>
          {edit && selectedIds.length ? (
            <>
              <Button size="sm" onClick={() => openSend(selectedIds)}>
                <Send className="me-1 h-4 w-4" />
                {t("camp.btn.sendMessage")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                <X className="me-1 h-4 w-4" />
                {t("camp.users.clearSelection")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {edit ? (
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label={t("camp.users.selectAll")}
                  />
                </TableHead>
              ) : null}
              <TableHead>{t("camp.col.name")}</TableHead>
              <TableHead>{t("camp.naming.col.issues")}</TableHead>
              <TableHead>{t("camp.naming.suggested")}</TableHead>
              <TableHead>{t("camp.col.phone")}</TableHead>
              <TableHead>{t("camp.col.team")}</TableHead>
              <TableHead>{t("camp.col.guider")}</TableHead>
              <TableHead>{t("camp.col.role")}</TableHead>
              <TableHead>{t("camp.col.accountType")}</TableHead>
              <TableHead>{t("camp.person.firstSeen")}</TableHead>
              <TableHead>{t("camp.naming.col.messageSentOn")}</TableHead>
              <TableHead>{t("camp.naming.col.fixedOn")}</TableHead>
              <TableHead>{t("camp.common.status")}</TableHead>
              {edit ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.swUserId}
                data-state={selected.has(r.swUserId) ? "selected" : undefined}
              >
                {edit ? (
                  <TableCell>
                    <Checkbox
                      checked={selected.has(r.swUserId)}
                      onCheckedChange={() => toggle(r.swUserId)}
                      aria-label={r.name}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="min-w-44">
                  <PersonLink personKey={r.personKey}>
                    <span dir="auto">{r.name || "—"}</span>
                  </PersonLink>
                </TableCell>
                <TableCell className="min-w-56">
                  <ul className="flex flex-wrap gap-1">
                    {r.issues.map((c) => (
                      <li key={c}>
                        <ToneBadge
                          tone={VIOLATION_CODES.has(c) ? "bad" : "warn"}
                          className="whitespace-normal text-start"
                        >
                          <span className="me-1 tabular-nums text-muted-foreground" dir="ltr">
                            {c}
                          </span>
                          {t(codeKey(c))}
                        </ToneBadge>
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell className="min-w-40" dir="auto">
                  {r.suggestedName ?? "—"}
                </TableCell>
                <TableCell className={r.phone ? "whitespace-nowrap" : "min-w-48"}>
                  {r.phone ? (
                    <span dir="ltr">{r.phone}</span>
                  ) : r.issues.includes("N11") ? (
                    <span className="text-xs text-muted-foreground">{t("camp.msg.M08")}</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{r.teamNo ?? "—"}</TableCell>
                <TableCell className="max-w-40 truncate" dir="auto">
                  {r.guiderName ?? "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap">{t(ROLE_KEY[r.eventRole])}</TableCell>
                <TableCell>
                  <AccountTypeBadge type={r.accountType} expected={r.expectedType} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {fmt.dateTime(r.firstSeenAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {fmt.dateTime(r.lastNamingMessageAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {fmt.dateTime(r.nameFixedAt)}
                </TableCell>
                <TableCell>
                  <NamingBadge status={r.naming} />
                </TableCell>
                {edit ? (
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => openSend([r.swUserId])}
                      aria-label={t("camp.naming.sendOne", { name: r.name })}
                      title={t("camp.btn.sendMessage")}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("camp.common.noResults")}
          </p>
        ) : null}
      </div>

      {edit ? (
        <SendMessageDialog
          open={sendOpen}
          onOpenChange={setSendOpen}
          swUserIds={sendIds}
          defaultTemplate="M01"
        />
      ) : null}
    </div>
  );
}
