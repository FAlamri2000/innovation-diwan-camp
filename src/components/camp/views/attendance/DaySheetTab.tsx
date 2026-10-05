/**
 * كشف الحضور اليومي — FR-ATT-05/06/09, export FR-EXP-05.
 *
 * One row per person seen or expected that day: entry, exit, time on the
 * platform, time in meetings, then one column per counted session. A row
 * expands into that person's meetings; an editor can override any session
 * status with a required reason (M12).
 */
import { Fragment, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Download, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/ui/query-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "@/i18n/use-translation";
import { getAttendanceDay } from "@/lib/camp-read.functions";
import { setCampAttendanceOverride } from "@/lib/camp-actions.functions";
import { ROLE_AR } from "@/lib/camp/copy-ar";
import type {
  AgendaPayload,
  AttCellDto,
  AttStatus,
  DaySheetPayload,
  DaySheetRow,
  SessionRow,
} from "@/lib/camp/types";
import { downloadWorkbook } from "../../export-xlsx";
import {
  ATT_KEY,
  AttBadge,
  campKey,
  PersonLink,
  ReasonDialog,
  ROLE_KEY,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
} from "../../camp-ui";
import { PersonMeetings } from "./PersonMeetings";
import { DaySelect, PersonFilterBar } from "./controls";
import {
  cellStatusAr,
  EMPTY_FILTER,
  filterPeople,
  minutesAr,
  sessionHeadersAr,
  teamOptions,
  timeAr,
  type PersonFilter,
} from "./model";

type OverrideStatus = Exclude<AttStatus, "not_expected">;
const OVERRIDE_STATUSES: OverrideStatus[] = [
  "present",
  "partial",
  "absent",
  "elsewhere",
  "off_platform",
];

type OverrideTarget = { row: DaySheetRow; session: SessionRow; cell: AttCellDto };

const platformMinutes = (seconds: number) => Math.round(seconds / 60);

export function DaySheetTab({
  agenda,
  dayNo,
  onDayChange,
}: {
  agenda: AgendaPayload;
  dayNo: number;
  onDayChange: (dayNo: number) => void;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const fn = useServerFn(getAttendanceDay);
  const query = useQuery({
    queryKey: campKey("attDay", dayNo),
    queryFn: () => fn({ data: { dayNo } }),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const [filter, setFilter] = useState<PersonFilter>(EMPTY_FILTER);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<OverrideTarget | null>(null);

  const d = query.data;
  const sessions = useMemo(() => (d?.sessions ?? []).filter((s) => s.counted), [d]);
  const rows = useMemo(() => filterPeople(d?.rows ?? [], filter), [d, filter]);
  const teams = useMemo(() => teamOptions(d?.rows ?? []), [d]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const colCount = 7 + sessions.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DaySelect days={agenda.days} value={dayNo} onChange={onDayChange} />
        <PersonFilterBar value={filter} onChange={setFilter} teams={teams} />
      </div>

      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        skeletonRows={8}
      >
        {d ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {t("camp.users.showing", { shown: rows.length, total: d.rows.length })}
                {" · "}
                {t("camp.att.countedSessions", { count: sessions.length })}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!rows.length}
                onClick={() => void exportDaySheet(d, sessions, rows)}
              >
                <Download className="me-1 h-4 w-4" />
                {t("camp.btn.exportExcel")}
              </Button>
            </div>

            {!sessions.length ? (
              <p className="text-sm text-muted-foreground">{t("camp.att.noCountedSessions")}</p>
            ) : null}

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky start-0 z-10 min-w-56 bg-card">
                      {t("camp.att.person")}
                    </TableHead>
                    <TableHead>{t("camp.col.role")}</TableHead>
                    <TableHead>{t("camp.col.team")}</TableHead>
                    <TableHead className="whitespace-nowrap">{t("camp.att.entry")}</TableHead>
                    <TableHead className="whitespace-nowrap">{t("camp.att.exit")}</TableHead>
                    <TableHead className="whitespace-nowrap">
                      {t("camp.att.platformTime")}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">{t("camp.att.meetingTime")}</TableHead>
                    {sessions.map((s) => (
                      <TableHead key={s.id} className="min-w-36 align-bottom">
                        <span className="block max-w-44 truncate" dir="auto" title={s.title}>
                          {s.title}
                        </span>
                        <span className="block text-xs font-normal">{fmt.time(s.start)}</span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const open = expanded.has(r.key);
                    return (
                      <Fragment key={r.key}>
                        <TableRow data-state={open ? "selected" : undefined}>
                          <TableCell className="sticky start-0 z-10 bg-card">
                            <div className="flex items-center justify-between gap-2">
                              <PersonLink personKey={r.key}>
                                <span dir="auto">{r.name}</span>
                              </PersonLink>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 shrink-0 px-2 text-xs"
                                aria-expanded={open}
                                onClick={() => toggle(r.key)}
                              >
                                {t("camp.att.meetings")}
                                {open ? (
                                  <ChevronUp className="ms-1 h-3.5 w-3.5" />
                                ) : (
                                  <ChevronDown className="ms-1 h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{t(ROLE_KEY[r.role])}</TableCell>
                          <TableCell className="tabular-nums">{r.teamNo ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{fmt.time(r.entry)}</TableCell>
                          <TableCell className="whitespace-nowrap">{fmt.time(r.exit)}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {r.platformSeconds
                              ? fmt.minutes(platformMinutes(r.platformSeconds))
                              : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {r.meetingMinutes ? fmt.minutes(r.meetingMinutes) : "—"}
                          </TableCell>
                          {sessions.map((s) => (
                            <TableCell key={s.id}>
                              <SessionCell
                                cell={r.cells[s.id]}
                                editable={edit}
                                onEdit={(cell) => setTarget({ row: r, session: s, cell })}
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                        {open ? (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={colCount} className="bg-muted/20">
                              <PersonMeetings personKey={r.key} name={r.name} dayNo={dayNo} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              {!rows.length ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {d.rows.length ? t("camp.common.noResults") : t("camp.person.noAttendance")}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </QueryState>

      <OverrideDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function SessionCell({
  cell,
  editable,
  onEdit,
}: {
  cell: AttCellDto | undefined;
  editable: boolean;
  onEdit: (cell: AttCellDto) => void;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  if (!cell || cell.status === "not_expected") {
    return (
      <span className="text-muted-foreground" title={t("camp.status.notExpected")}>
        —
      </span>
    );
  }
  const title = [
    t(ATT_KEY[cell.status]),
    fmt.minutes(cell.minutes),
    ...(cell.perTeam ?? []).map(
      (x) => `${t("camp.common.teamN", { n: x.teamNo })}: ${fmt.minutes(x.minutes)}`,
    ),
    cell.overridden ? t("camp.att.overridden") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <span className="inline-flex items-center gap-1">
      <AttBadge status={cell.status} late={cell.late} minutes={cell.minutes} />
      {cell.overridden ? (
        <PencilLine
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-label={t("camp.att.overridden")}
        />
      ) : null}
    </span>
  );
  if (!editable) return <span title={title}>{body}</span>;
  return (
    <button
      type="button"
      title={`${title} · ${t("camp.att.override.hint")}`}
      className="rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onEdit(cell)}
    >
      {body}
    </button>
  );
}

function OverrideDialog({
  target,
  onClose,
}: {
  target: OverrideTarget | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateCamp();
  const fn = useServerFn(setCampAttendanceOverride);
  const [status, setStatus] = useState<OverrideStatus | "clear">("present");
  const [shownFor, setShownFor] = useState<OverrideTarget | null>(null);
  // Reset the choice whenever a different cell opens the dialog.
  if (target && target !== shownFor) {
    setShownFor(target);
    setStatus(
      target.cell.overridden && target.cell.status !== "not_expected"
        ? target.cell.status
        : "present",
    );
  }
  return (
    <ReasonDialog
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title={t("camp.att.override.title")}
      description={target ? `${target.row.name} · ${target.session.title}` : undefined}
      onSubmit={async (reason) => {
        if (!target) return;
        await fn({
          data: {
            sessionId: target.session.id,
            personKey: target.row.key,
            status: status === "clear" ? null : status,
            reason,
          },
        });
        toast.success(t("camp.common.saved"));
        await invalidate();
      }}
    >
      {target ? (
        <div className="space-y-1.5">
          <Label>{t("camp.att.override.status")}</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as OverrideStatus | "clear")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OVERRIDE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(ATT_KEY[s])}
                </SelectItem>
              ))}
              {target.cell.overridden ? (
                <SelectItem value="clear">{t("camp.att.override.clear")}</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("camp.att.override.note")}</p>
        </div>
      ) : null}
    </ReasonDialog>
  );
}

function exportDaySheet(d: DaySheetPayload, sessions: SessionRow[], rows: DaySheetRow[]) {
  const titles = sessionHeadersAr(sessions);
  return downloadWorkbook("كشف الحضور اليومي", [
    {
      name: "كشف الحضور اليومي",
      headers: [
        "الاسم",
        "الدور",
        "الفريق",
        "وقت الدخول",
        "وقت الخروج",
        "الوقت على المنصة",
        "الوقت في الاجتماعات",
        ...sessions.flatMap((s) => [`${titles.get(s.id)} الحالة`, `${titles.get(s.id)} الدقائق`]),
      ],
      rows: rows.map((r) => [
        r.name,
        ROLE_AR[r.role],
        r.teamNo,
        timeAr(r.entry),
        timeAr(r.exit),
        r.platformSeconds ? minutesAr(platformMinutes(r.platformSeconds)) : "",
        r.meetingMinutes ? minutesAr(r.meetingMinutes) : "",
        ...sessions.flatMap((s) => {
          const cell = r.cells[s.id];
          return [cellStatusAr(cell), cell && cell.status !== "not_expected" ? cell.minutes : null];
        }),
      ]),
    },
  ]);
}
