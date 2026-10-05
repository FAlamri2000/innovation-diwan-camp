/**
 * كشف الحضور لفترة محددة — FR-ATT-07, export FR-EXP-06.
 *
 * Pick a session of the day (its window) or any from/to time on that day
 * (Riyadh wall time, BR-ATT-05), and list everyone with time in meetings
 * inside it.
 */
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTranslation } from "@/i18n/use-translation";
import { getAttendanceWindow } from "@/lib/camp-read.functions";
import { ROLE_AR } from "@/lib/camp/copy-ar";
import { fromRiyadh, riyadhHHMM } from "@/lib/camp/text";
import type { AgendaPayload, WindowRow } from "@/lib/camp/types";
import { downloadWorkbook } from "../../export-xlsx";
import { campKey, PersonLink, ROLE_KEY, SESSION_TYPE_KEY, useCampFormat } from "../../camp-ui";
import { DaySelect, PersonFilterBar } from "./controls";
import {
  EMPTY_FILTER,
  filterPeople,
  minutesAr,
  roomAr,
  teamOptions,
  timeAr,
  type PersonFilter,
} from "./model";

type Mode = "session" | "custom";

export function WindowTab({
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
  const day = agenda.days.find((d) => d.dayNo === dayNo);
  const daySessions = useMemo(
    () => agenda.sessions.filter((s) => s.dayNo === dayNo && s.type !== "break"),
    [agenda.sessions, dayNo],
  );
  const [mode, setMode] = useState<Mode>("session");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);
  const [filter, setFilter] = useState<PersonFilter>(EMPTY_FILTER);

  // Defaults follow the chosen day: the session running now, else the day's
  // first counted session; the custom window spans the day's agenda.
  const now = Date.now();
  const session =
    daySessions.find((s) => s.id === pickedId) ??
    daySessions.find((s) => s.counted && s.start <= now && now < s.end) ??
    daySessions.find((s) => s.counted) ??
    daySessions[0] ??
    null;
  const fromHHMM = customFrom ?? (daySessions[0] ? riyadhHHMM(daySessions[0].start) : "17:30");
  const toHHMM =
    customTo ??
    (daySessions.length ? riyadhHHMM(daySessions[daySessions.length - 1]!.end) : "22:00");

  let from: number | null = null;
  let to: number | null = null;
  if (mode === "session" && session) {
    from = session.start;
    to = session.end;
  } else if (mode === "custom" && day && fromHHMM && toHHMM) {
    from = fromRiyadh(day.date, fromHHMM).getTime();
    to = fromRiyadh(day.date, toHHMM).getTime();
  }
  const invalid = mode === "custom" && from !== null && to !== null && to <= from;
  const ready = from !== null && to !== null && !invalid;

  const fn = useServerFn(getAttendanceWindow);
  const query = useQuery({
    queryKey: campKey("attWindow", from, to),
    queryFn: () => fn({ data: { from: from!, to: to! } }),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
  const all = useMemo(() => query.data ?? [], [query.data]);
  const rows = useMemo(() => filterPeople(all, filter), [all, filter]);
  const teams = useMemo(() => teamOptions(all), [all]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
        <div className="space-y-1.5">
          <Label>{t("camp.common.day")}</Label>
          <DaySelect
            days={agenda.days}
            value={dayNo}
            onChange={(n) => {
              setPickedId(null);
              setCustomFrom(null);
              setCustomTo(null);
              onDayChange(n);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("camp.att.window.by")}</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(v) => v && setMode(v as Mode)}
          >
            <ToggleGroupItem value="session" className="px-3">
              {t("camp.common.session")}
            </ToggleGroupItem>
            <ToggleGroupItem value="custom" className="px-3">
              {t("camp.att.window.custom")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {mode === "session" ? (
          <div className="min-w-0 space-y-1.5">
            <Label>{t("camp.common.session")}</Label>
            {daySessions.length ? (
              <Select value={session?.id ?? ""} onValueChange={setPickedId}>
                <SelectTrigger className="h-9 w-full min-w-64 sm:w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {daySessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span dir="auto">{s.title}</span>
                      <span className="ms-2 text-xs text-muted-foreground">
                        {fmt.time(s.start)} · {t(SESSION_TYPE_KEY[s.type])}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">{t("camp.att.noSessionsDay")}</p>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="att-window-from">{t("camp.att.window.from")}</Label>
              <Input
                id="att-window-from"
                type="time"
                dir="ltr"
                className="h-9 w-32"
                value={fromHHMM}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="att-window-to">{t("camp.att.window.to")}</Label>
              <Input
                id="att-window-to"
                type="time"
                dir="ltr"
                className="h-9 w-32"
                value={toHHMM}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-invalid={invalid}
              />
            </div>
          </>
        )}
      </div>
      {invalid ? (
        <p className="text-sm text-[var(--destructive)]">{t("camp.att.window.invalid")}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <PersonFilterBar value={filter} onChange={setFilter} teams={teams} />
      </div>

      {ready ? (
        <QueryState
          isPending={query.isPending}
          isError={query.isError}
          error={query.error}
          onRetry={() => void query.refetch()}
          skeletonRows={6}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {t("camp.att.timeRange", { from: fmt.time(from), to: fmt.time(to) })}
              {" · "}
              {t("camp.users.showing", { shown: rows.length, total: all.length })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!rows.length}
              onClick={() => void exportWindow(rows)}
            >
              <Download className="me-1 h-4 w-4" />
              {t("camp.btn.exportExcel")}
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky start-0 z-10 min-w-48 bg-card">
                    {t("camp.att.person")}
                  </TableHead>
                  <TableHead>{t("camp.col.role")}</TableHead>
                  <TableHead>{t("camp.col.team")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("camp.att.entry")}</TableHead>
                  <TableHead className="whitespace-nowrap">
                    {t("camp.att.window.minutes")}
                  </TableHead>
                  <TableHead>{t("camp.att.window.meetings")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="sticky start-0 z-10 bg-card">
                      <PersonLink personKey={r.key}>
                        <span dir="auto">{r.name}</span>
                      </PersonLink>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{t(ROLE_KEY[r.role])}</TableCell>
                    <TableCell className="tabular-nums">{r.teamNo ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmt.time(r.entry)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmt.minutes(r.minutes)}
                    </TableCell>
                    <TableCell>
                      <ul className="flex flex-wrap gap-1.5">
                        {r.meetings.map((m) => (
                          <li
                            key={m.meetingId}
                            className="whitespace-nowrap rounded border px-1.5 py-0.5 text-xs"
                          >
                            <span dir="auto">{m.roomLabel ?? t("camp.status.undetermined")}</span>
                            <span className="ms-1 text-muted-foreground tabular-nums">
                              {fmt.minutes(m.minutes)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!rows.length ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {all.length ? t("camp.common.noResults") : t("camp.att.window.empty")}
              </p>
            ) : null}
          </div>
        </QueryState>
      ) : null}
    </div>
  );
}

function exportWindow(rows: WindowRow[]) {
  return downloadWorkbook("كشف الحضور لفترة محددة", [
    {
      name: "كشف الحضور لفترة محددة",
      headers: [
        "الاسم",
        "الدور",
        "الفريق",
        "وقت الدخول",
        "الدقائق في الفترة",
        "الاجتماعات في الفترة",
      ],
      rows: rows.map((r) => [
        r.name,
        ROLE_AR[r.role],
        r.teamNo,
        timeAr(r.entry),
        r.minutes,
        r.meetings.map((m) => `${roomAr(m.roomLabel)} (${minutesAr(m.minutes)})`).join("، "),
      ]),
    },
  ]);
}
