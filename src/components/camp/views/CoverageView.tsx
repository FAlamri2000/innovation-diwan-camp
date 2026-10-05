/**
 * Camp operations — تغطية المرشدين (FR-ATT-13/14, BR-ATT-04).
 *
 * A guider covers a team's mentoring when they spend 10 minutes or more in
 * that team's room inside the day's mentoring window; each assigned team is
 * scored on its own. The grid is teams × mentoring days; below it, one line
 * per guider. An editor can override a cell with a required reason (M12).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { getGuiderCoverage } from "@/lib/camp-read.functions";
import { setCampAttendanceOverride } from "@/lib/camp-actions.functions";
import type { CoveragePayload } from "@/lib/camp/types";
import { downloadWorkbook } from "../export-xlsx";
import {
  campKey,
  FilterSelect,
  matchesSearch,
  PageTitle,
  PersonLink,
  ReasonDialog,
  SearchBox,
  StatCard,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
} from "../camp-ui";
import { coverageGridSheet, guiderListSheet } from "./attendance/coverage-export";
import { rateTone, useCampAgenda, useDayLabel } from "./attendance/model";

type CoverageCell = CoveragePayload["cells"][number];

export function CoverageView() {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const fn = useServerFn(getGuiderCoverage);
  const query = useQuery({
    queryKey: campKey("coverage"),
    queryFn: () => fn(),
    refetchInterval: 120_000,
  });
  const agenda = useCampAgenda();
  const dayLabel = useDayLabel(agenda.data?.days ?? []);
  const [search, setSearch] = useState("");
  const [guider, setGuider] = useState<string>("all");
  const [missedOnly, setMissedOnly] = useState(false);
  const [target, setTarget] = useState<CoverageCell | null>(null);
  const d = query.data;

  /** Cells after the guider and search filters (search matches team or guider). */
  const cells = useMemo(
    () =>
      (d?.cells ?? []).filter(
        (c) =>
          (guider === "all" || c.guiderKey === guider) &&
          matchesSearch(search, [c.teamNo, c.guiderName]),
      ),
    [d, guider, search],
  );
  const teamNos = useMemo(() => {
    const missedTeams = new Set(cells.filter((c) => !c.covered).map((c) => c.teamNo));
    return [...new Set(cells.map((c) => c.teamNo))]
      .filter((n) => !missedOnly || missedTeams.has(n))
      .sort((a, b) => a - b);
  }, [cells, missedOnly]);
  const shownCells = useMemo(() => {
    const keep = new Set(teamNos);
    return cells.filter((c) => keep.has(c.teamNo));
  }, [cells, teamNos]);
  const byTeamDay = useMemo(() => {
    const map = new Map<string, CoverageCell[]>();
    for (const c of shownCells) {
      const key = `${c.teamNo}:${c.dayNo}`;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return map;
  }, [shownCells]);
  const guiders = useMemo(
    () =>
      (d?.guiders ?? []).filter(
        (g) =>
          (guider === "all" || g.key === guider) &&
          (!missedOnly || g.missed > 0) &&
          matchesSearch(search, [g.name, ...g.teams]),
      ),
    [d, guider, missedOnly, search],
  );
  const teamsWithManyGuiders = useMemo(() => {
    const count = new Map<number, Set<string>>();
    for (const c of d?.cells ?? []) {
      if (!count.has(c.teamNo)) count.set(c.teamNo, new Set());
      count.get(c.teamNo)!.add(c.guiderKey);
    }
    return new Set([...count].filter(([, keys]) => keys.size > 1).map(([n]) => n));
  }, [d]);

  const covered = d?.cells.filter((c) => c.covered).length ?? 0;
  const total = d?.cells.length ?? 0;
  const rate = total ? Math.round((covered / total) * 1000) / 10 : null;

  return (
    <div className="space-y-4">
      <PageTitle
        title={t("camp.nav.coverage")}
        description={t("camp.coverage.description")}
        actions={
          d ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!shownCells.length && !guiders.length}
              onClick={() =>
                void downloadWorkbook("تغطية المرشدين", [
                  coverageGridSheet(d.days, shownCells),
                  guiderListSheet(guiders),
                ])
              }
            >
              <Download className="me-1 h-4 w-4" />
              {t("camp.btn.exportExcel")}
            </Button>
          ) : null
        }
      />
      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        skeletonRows={8}
      >
        {d ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={t("camp.overview.guiderCoverage")}
                value={fmt.percent(rate)}
                tone={rateTone(rate)}
                hint={t("camp.coverage.coveredOf", { covered, total })}
              />
              <StatCard
                label={t("camp.coverage.missed")}
                value={total - covered}
                tone={total - covered ? "bad" : "good"}
              />
              <StatCard label={t("camp.coverage.guiders")} value={d.guiders.length} />
              <StatCard label={t("camp.coverage.days")} value={d.days.length} />
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={t("camp.coverage.searchHint")}
              />
              <FilterSelect
                label={t("camp.col.guider")}
                value={guider}
                onChange={setGuider}
                options={d.guiders.map((g) => ({ value: g.key, label: g.name }))}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={missedOnly} onCheckedChange={(v) => setMissedOnly(v === true)} />
                {t("camp.coverage.missedOnly")}
              </label>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("camp.coverage.grid")}</h3>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <ToneBadge tone="good">✓</ToneBadge>
                  {t("camp.coverage.legendCovered")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ToneBadge tone="bad">✗</ToneBadge>
                  {t("camp.coverage.legendMissed")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <PencilLine className="h-3.5 w-3.5" aria-hidden />
                  {t("camp.att.overridden")}
                </span>
              </div>
              {d.days.length ? (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky start-0 z-10 bg-card">
                          {t("camp.col.team")}
                        </TableHead>
                        {d.days.map((day) => (
                          <TableHead
                            key={day}
                            className="whitespace-nowrap text-center"
                            title={dayLabel(day)}
                          >
                            {t("camp.common.dayN", { n: day })}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teamNos.map((teamNo) => (
                        <TableRow key={teamNo}>
                          <TableCell className="sticky start-0 z-10 bg-card tabular-nums">
                            {teamNo}
                          </TableCell>
                          {d.days.map((day) => (
                            <TableCell key={day} className="text-center">
                              <div className="flex flex-col items-center gap-1">
                                {(byTeamDay.get(`${teamNo}:${day}`) ?? []).map((c) => (
                                  <CoverageMark
                                    key={c.guiderKey}
                                    cell={c}
                                    showName={teamsWithManyGuiders.has(teamNo)}
                                    editable={edit && !!d.mentoringSessions[day]?.length}
                                    onEdit={() => setTarget(c)}
                                  />
                                ))}
                                {byTeamDay.has(`${teamNo}:${day}`) ? null : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </div>
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {!teamNos.length ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                      {t("camp.common.noResults")}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t("camp.coverage.noMentoring")}
                </p>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("camp.coverage.list")}</h3>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("camp.col.guider")}</TableHead>
                      <TableHead>{t("camp.coverage.teams")}</TableHead>
                      <TableHead className="whitespace-nowrap">
                        {t("camp.coverage.covered")}
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        {t("camp.coverage.missed")}
                      </TableHead>
                      <TableHead>{t("camp.coverage.minutesByTeam")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {guiders.map((g) => (
                      <TableRow key={g.key}>
                        <TableCell className="min-w-44">
                          <PersonLink personKey={g.key}>
                            <span dir="auto">{g.name}</span>
                          </PersonLink>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {g.teams.length ? g.teams.join("، ") : "—"}
                        </TableCell>
                        <TableCell className="tabular-nums">{g.covered}</TableCell>
                        <TableCell>
                          {g.missed ? (
                            <ToneBadge tone="bad">{g.missed}</ToneBadge>
                          ) : (
                            <span className="tabular-nums">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ul className="flex flex-wrap gap-1.5">
                            {g.minutesByTeam.map((x) => (
                              <li
                                key={x.teamNo}
                                className="whitespace-nowrap rounded border px-1.5 py-0.5 text-xs"
                              >
                                {t("camp.common.teamN", { n: x.teamNo })}
                                <span className="ms-1 text-muted-foreground tabular-nums">
                                  {fmt.minutes(x.minutes)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!guiders.length ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    {d.guiders.length ? t("camp.common.noResults") : t("camp.coverage.noGuiders")}
                  </p>
                ) : null}
              </div>
            </section>

            <CoverageOverrideDialog
              target={target}
              sessionId={target ? (d.mentoringSessions[target.dayNo]?.[0] ?? null) : null}
              dayText={target ? dayLabel(target.dayNo) : ""}
              onClose={() => setTarget(null)}
            />
          </>
        ) : null}
      </QueryState>
    </div>
  );
}

function CoverageMark({
  cell,
  showName,
  editable,
  onEdit,
}: {
  cell: CoverageCell;
  showName: boolean;
  editable: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const title = [
    cell.guiderName,
    cell.covered ? t("camp.att.covered") : t("camp.att.notCovered"),
    fmt.minutes(cell.minutes),
    cell.overridden ? t("camp.att.overridden") : null,
    editable ? t("camp.att.override.hint") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <span className="inline-flex items-center gap-1">
      <ToneBadge tone={cell.covered ? "good" : "bad"}>
        {cell.covered ? "✓" : "✗"}
        <span className="ms-1 tabular-nums">{fmt.minutes(cell.minutes)}</span>
      </ToneBadge>
      {cell.overridden ? (
        <PencilLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      {showName ? (
        <span className="max-w-24 truncate text-xs text-muted-foreground" dir="auto">
          {cell.guiderName.split(/\s+/)[0]}
        </span>
      ) : null}
    </span>
  );
  if (!editable)
    return (
      <span title={title} aria-label={title}>
        {body}
      </span>
    );
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onEdit}
    >
      {body}
    </button>
  );
}

function CoverageOverrideDialog({
  target,
  sessionId,
  dayText,
  onClose,
}: {
  target: CoverageCell | null;
  sessionId: string | null;
  dayText: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const invalidate = useInvalidateCamp();
  const fn = useServerFn(setCampAttendanceOverride);
  const [status, setStatus] = useState<"present" | "absent" | "clear">("present");
  const [shownFor, setShownFor] = useState<CoverageCell | null>(null);
  // Reset the choice whenever a different cell opens the dialog.
  if (target && target !== shownFor) {
    setShownFor(target);
    setStatus(target.covered ? "absent" : "present");
  }
  return (
    <ReasonDialog
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title={t("camp.coverage.override.title")}
      description={
        target
          ? `${target.guiderName} · ${t("camp.common.teamN", { n: target.teamNo })} · ${dayText}`
          : undefined
      }
      onSubmit={async (reason) => {
        if (!target || !sessionId) return;
        await fn({
          data: {
            sessionId,
            personKey: target.guiderKey,
            teamNo: target.teamNo,
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
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as "present" | "absent" | "clear")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="present">{t("camp.att.covered")}</SelectItem>
              <SelectItem value="absent">{t("camp.att.notCovered")}</SelectItem>
              {target.overridden ? (
                <SelectItem value="clear">{t("camp.att.override.clear")}</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("camp.coverage.override.note", { time: fmt.minutes(target.minutes) })}
          </p>
        </div>
      ) : null}
    </ReasonDialog>
  );
}
