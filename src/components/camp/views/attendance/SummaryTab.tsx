/**
 * الملخص — FR-ATT-10..12, 15..17, export FR-EXP-08 (ملخص الحضور).
 *
 *   participants versus enablers per phase, day and session (FR-ATT-10)
 *   team × day rates with all-present / none-present days (FR-ATT-11)
 *   enablers by role, scored or presence only (FR-ATT-12)
 *   checkpoint attendance per team (FR-ATT-16)
 *   pitch coaching per team (FR-ATT-15)
 *   absent from every counted session two days in a row (FR-ATT-17)
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/ui/query-state";
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
import { getAttendanceSummary, getGuiderCoverage } from "@/lib/camp-read.functions";
import { ROLE_AR } from "@/lib/camp/copy-ar";
import { formatTimeAr } from "@/lib/camp/text";
import type { AgendaPayload, RateDto, SummaryPayload } from "@/lib/camp/types";
import { downloadWorkbook, type ExportSheet } from "../../export-xlsx";
import {
  campKey,
  errorMessage,
  PersonLink,
  ROLE_KEY,
  SendMessageDialog,
  SESSION_TYPE_KEY,
  StatCard,
  ToneBadge,
  toneColor,
  useCampAbilities,
  useCampFormat,
} from "../../camp-ui";
import { coverageGridSheet } from "./coverage-export";
import { RateCell } from "./controls";
import { dayAr, minutesAr, percentAr, rateTone, useDayLabel } from "./model";

type Level = "phase" | "day" | "session";

function sumRates(list: readonly RateDto[]): RateDto {
  const expected = list.reduce((s, r) => s + r.expected, 0);
  const attended = list.reduce((s, r) => s + r.attended, 0);
  return {
    expected,
    attended,
    rate: expected ? Math.round((attended / expected) * 1000) / 10 : null,
  };
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SummaryTab({ agenda }: { agenda: AgendaPayload }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const dayLabel = useDayLabel(agenda.days);
  const fn = useServerFn(getAttendanceSummary);
  const coverageFn = useServerFn(getGuiderCoverage);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: campKey("attSummary"),
    queryFn: () => fn(),
    refetchInterval: 120_000,
  });
  const [level, setLevel] = useState<Level>("day");
  const [exporting, setExporting] = useState(false);
  const d = query.data;

  const totals = useMemo(
    () =>
      d
        ? {
            participants: sumRates(d.days.map((x) => x.participants)),
            enablers: sumRates(d.days.map((x) => x.enablers)),
          }
        : null,
    [d],
  );

  const runExport = async () => {
    if (!d) return;
    setExporting(true);
    try {
      const coverage = await client.fetchQuery({
        queryKey: campKey("coverage"),
        queryFn: () => coverageFn(),
      });
      await downloadWorkbook("ملخص الحضور", [
        ...summarySheets(d, agenda),
        coverageGridSheet(coverage.days, coverage.cells),
        ...extraSheets(d),
      ]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <QueryState
      isPending={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeletonRows={8}
    >
      {d && totals ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t("camp.att.summary.hint")}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={exporting}
              onClick={() => void runExport()}
            >
              {exporting ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Download className="me-1 h-4 w-4" />
              )}
              {t("camp.btn.exportExcel")}
            </Button>
          </div>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t("camp.overview.participantRate")}
              value={fmt.percent(totals.participants.rate)}
              tone={rateTone(totals.participants.rate)}
              hint={t("camp.overview.attendedOf", {
                attended: totals.participants.attended,
                expected: totals.participants.expected,
              })}
            />
            <StatCard
              label={t("camp.overview.enablerRate")}
              value={fmt.percent(totals.enablers.rate)}
              tone={rateTone(totals.enablers.rate)}
              hint={t("camp.overview.attendedOf", {
                attended: totals.enablers.attended,
                expected: totals.enablers.expected,
              })}
            />
            <StatCard label={t("camp.att.summary.scoredSessions")} value={d.sessions.length} />
            <StatCard
              label={t("camp.att.summary.absentTwoDays")}
              value={d.absentTwoDays.length}
              tone={d.absentTwoDays.length ? "warn" : "good"}
            />
          </section>

          {/* FR-ATT-10 */}
          <Section
            title={t("camp.att.summary.groups")}
            description={t("camp.att.summary.groupsHint")}
          >
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="justify-start"
              value={level}
              onValueChange={(v) => v && setLevel(v as Level)}
            >
              <ToggleGroupItem value="phase" className="px-3">
                {t("camp.att.summary.byPhase")}
              </ToggleGroupItem>
              <ToggleGroupItem value="day" className="px-3">
                {t("camp.att.summary.byDay")}
              </ToggleGroupItem>
              <ToggleGroupItem value="session" className="px-3">
                {t("camp.att.summary.bySession")}
              </ToggleGroupItem>
            </ToggleGroup>
            <GroupRatesTable
              firstHeader={
                level === "phase"
                  ? t("camp.att.summary.phase")
                  : level === "day"
                    ? t("camp.common.day")
                    : t("camp.common.session")
              }
              rows={
                level === "phase"
                  ? d.phases.map((p) => ({
                      key: p.phase,
                      label: <span dir="auto">{p.phase}</span>,
                      participants: p.participants,
                      enablers: p.enablers,
                    }))
                  : level === "day"
                    ? d.days.map((x) => ({
                        key: String(x.dayNo),
                        label: (
                          <span>
                            {dayLabel(x.dayNo)}
                            {x.phase ? (
                              <span className="ms-2 text-xs text-muted-foreground" dir="auto">
                                {x.phase}
                              </span>
                            ) : null}
                          </span>
                        ),
                        participants: x.participants,
                        enablers: x.enablers,
                      }))
                    : d.sessions.map((s) => ({
                        key: s.id,
                        label: (
                          <span className="block min-w-48">
                            <span dir="auto">{s.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {t("camp.common.dayN", { n: s.dayNo })} · {fmt.time(s.start)} ·{" "}
                              {t(SESSION_TYPE_KEY[s.type])}
                            </span>
                          </span>
                        ),
                        participants: s.participants,
                        enablers: s.enablers,
                      }))
              }
            />
          </Section>

          {/* FR-ATT-11 */}
          <Section
            title={t("camp.att.summary.teams")}
            description={t("camp.att.summary.teamsHint")}
          >
            <TeamGrid teams={d.teams} />
          </Section>

          {/* FR-ATT-12 */}
          <Section
            title={t("camp.att.summary.enablers")}
            description={t("camp.att.summary.enablersHint")}
          >
            {d.enablersByRole.length ? (
              <div className="space-y-4">
                {d.enablersByRole.map((group) => (
                  <EnablerRoleTable key={group.role} group={group} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("camp.att.summary.noEnablers")}</p>
            )}
          </Section>

          {/* FR-ATT-16 */}
          <Section
            title={t("camp.att.summary.checkpoints")}
            description={t("camp.att.summary.checkpointsHint")}
          >
            <CheckpointGrid summary={d} />
          </Section>

          {/* FR-ATT-15 */}
          <Section
            title={t("camp.att.summary.pitch")}
            description={t("camp.att.summary.pitchHint")}
          >
            {d.pitchCoaching.length ? (
              d.pitchCoaching.map((p) => (
                <div key={p.sessionId} className="space-y-2">
                  <p className="text-sm font-medium">
                    {dayLabel(p.dayNo)}
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      {t("camp.att.summary.pitchCovered", {
                        covered: p.teams.filter((x) => x.covered).length,
                        total: p.teams.length,
                      })}
                    </span>
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("camp.col.team")}</TableHead>
                          <TableHead>{t("camp.att.summary.coach10")}</TableHead>
                          <TableHead>{t("camp.common.minutes")}</TableHead>
                          <TableHead>{t("camp.att.summary.coaches")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.teams.map((x) => (
                          <TableRow key={x.teamNo}>
                            <TableCell className="tabular-nums">{x.teamNo}</TableCell>
                            <TableCell>
                              <ToneBadge tone={x.covered ? "good" : "bad"}>
                                {x.covered ? t("camp.att.covered") : t("camp.att.notCovered")}
                              </ToneBadge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums">
                              {x.minutes ? fmt.minutes(x.minutes) : "—"}
                            </TableCell>
                            <TableCell dir="auto">{x.coaches.join("، ") || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("camp.att.summary.noPitch")}</p>
            )}
          </Section>

          {/* FR-ATT-17 */}
          <Section
            title={t("camp.att.summary.absentTwoDays")}
            description={t("camp.att.summary.absentHint")}
          >
            {d.absentTwoDays.length ? (
              <AbsentMessage
                accountIds={d.absentTwoDays.flatMap((x) => x.accountIds.slice(0, 1))}
              />
            ) : null}
            {d.absentTwoDays.length ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("camp.att.person")}</TableHead>
                      <TableHead>{t("camp.col.role")}</TableHead>
                      <TableHead>{t("camp.col.team")}</TableHead>
                      <TableHead>{t("camp.att.summary.days")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.absentTwoDays.map((x) => (
                      <TableRow key={x.key}>
                        <TableCell>
                          <PersonLink personKey={x.key}>
                            <span dir="auto">{x.name}</span>
                          </PersonLink>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{t(ROLE_KEY[x.role])}</TableCell>
                        <TableCell className="tabular-nums">{x.teamNo ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {t("camp.att.summary.twoDays", { a: x.days[0], b: x.days[1] })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("camp.att.summary.noAbsent")}</p>
            )}
          </Section>
        </div>
      ) : null}
    </QueryState>
  );
}

function GroupRatesTable({
  firstHeader,
  rows,
}: {
  firstHeader: string;
  rows: { key: string; label: ReactNode; participants: RateDto; enablers: RateDto }[];
}) {
  const { t } = useTranslation();
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">{t("camp.att.summary.noData")}</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{firstHeader}</TableHead>
            <TableHead className="whitespace-nowrap">{t("camp.role.participants")}</TableHead>
            <TableHead className="whitespace-nowrap">{t("camp.role.enablers")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell>{r.label}</TableCell>
              <TableCell>
                <RateCell value={r.participants} />
              </TableCell>
              <TableCell>
                <RateCell value={r.enablers} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        {t("camp.att.summary.rateLegend")}
      </p>
    </div>
  );
}

function TeamGrid({ teams }: { teams: SummaryPayload["teams"] }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const days = [...new Set(teams.map((x) => x.dayNo))].sort((a, b) => a - b);
  const teamNos = [...new Set(teams.map((x) => x.teamNo))].sort((a, b) => a - b);
  const byKey = new Map(teams.map((x) => [`${x.teamNo}:${x.dayNo}`, x]));
  if (!teamNos.length)
    return <p className="text-sm text-muted-foreground">{t("camp.att.summary.noData")}</p>;
  return (
    <>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" style={{ color: toneColor("good") }} aria-hidden />
          {t("camp.att.summary.allPresent")}
        </span>
        <span className="inline-flex items-center gap-1">
          <XCircle className="h-3.5 w-3.5" style={{ color: toneColor("bad") }} aria-hidden />
          {t("camp.att.summary.nonePresent")}
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky start-0 z-10 bg-card">{t("camp.col.team")}</TableHead>
              {days.map((d) => (
                <TableHead key={d} className="whitespace-nowrap text-center">
                  {t("camp.common.dayN", { n: d })}
                </TableHead>
              ))}
              <TableHead className="whitespace-nowrap">{t("camp.att.summary.allDays")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamNos.map((teamNo) => {
              const list = days
                .map((d) => byKey.get(`${teamNo}:${d}`))
                .filter((x): x is NonNullable<typeof x> => !!x);
              return (
                <TableRow key={teamNo}>
                  <TableCell className="sticky start-0 z-10 bg-card tabular-nums">
                    {teamNo}
                  </TableCell>
                  {days.map((d) => {
                    const x = byKey.get(`${teamNo}:${d}`);
                    if (!x)
                      return (
                        <TableCell key={d} className="text-center text-muted-foreground">
                          —
                        </TableCell>
                      );
                    return (
                      <TableCell
                        key={d}
                        className="whitespace-nowrap text-center tabular-nums"
                        title={`${x.rate.attended}/${x.rate.expected}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          <span style={{ color: toneColor(rateTone(x.rate.rate)) }}>
                            {fmt.percent(x.rate.rate)}
                          </span>
                          {x.allPresent ? (
                            <CheckCircle2
                              className="h-3.5 w-3.5"
                              style={{ color: toneColor("good") }}
                              aria-label={t("camp.att.summary.allPresent")}
                            />
                          ) : x.nonePresent ? (
                            <XCircle
                              className="h-3.5 w-3.5"
                              style={{ color: toneColor("bad") }}
                              aria-label={t("camp.att.summary.nonePresent")}
                            />
                          ) : null}
                        </span>
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <RateCell value={sumRates(list.map((x) => x.rate))} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function EnablerRoleTable({ group }: { group: SummaryPayload["enablersByRole"][number] }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const scored = group.people.some((p) => p.scored);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {t(ROLE_KEY[group.role])}
        <span className="ms-2 text-xs font-normal text-muted-foreground">
          {scored ? t("camp.att.summary.scored") : t("camp.att.summary.presenceOnly")}
        </span>
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("camp.att.person")}</TableHead>
              {scored ? <TableHead>{t("camp.att.attendance")}</TableHead> : null}
              <TableHead>{t("camp.att.summary.presenceMinutes")}</TableHead>
              <TableHead>{t("camp.att.summary.daysSeen")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.people.map((p) => (
              <TableRow key={p.key}>
                <TableCell>
                  <PersonLink personKey={p.key}>
                    <span dir="auto">{p.name}</span>
                  </PersonLink>
                </TableCell>
                {scored ? (
                  <TableCell>
                    <RateCell value={p.rate} />
                  </TableCell>
                ) : null}
                <TableCell className="whitespace-nowrap tabular-nums">
                  {p.minutes ? fmt.minutes(p.minutes) : "—"}
                </TableCell>
                <TableCell className="tabular-nums">{p.daysSeen}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CheckpointGrid({ summary }: { summary: SummaryPayload }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const sessionById = new Map(summary.sessions.map((s) => [s.id, s]));
  const checkpoints = summary.checkpoints;
  const teamNos = [...new Set(checkpoints.flatMap((c) => c.teams.map((x) => x.teamNo)))].sort(
    (a, b) => a - b,
  );
  if (!checkpoints.length || !teamNos.length)
    return <p className="text-sm text-muted-foreground">{t("camp.att.summary.noCheckpoints")}</p>;
  const rateOf = new Map(
    checkpoints.flatMap((c) => c.teams.map((x) => [`${c.sessionId}:${x.teamNo}`, x.rate] as const)),
  );
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky start-0 z-10 bg-card">{t("camp.col.team")}</TableHead>
            {checkpoints.map((c) => {
              const s = sessionById.get(c.sessionId);
              return (
                <TableHead key={c.sessionId} className="whitespace-nowrap">
                  {t("camp.common.dayN", { n: c.dayNo })}
                  {s ? (
                    <span className="block text-xs font-normal">{fmt.time(s.start)}</span>
                  ) : null}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {teamNos.map((teamNo) => (
            <TableRow key={teamNo}>
              <TableCell className="sticky start-0 z-10 bg-card tabular-nums">{teamNo}</TableCell>
              {checkpoints.map((c) => {
                const rate = rateOf.get(`${c.sessionId}:${teamNo}`);
                return (
                  <TableCell key={c.sessionId}>
                    {rate ? (
                      <RateCell value={rate} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-EXP-08 — ملخص الحضور
// ---------------------------------------------------------------------------

const rateCellsAr = (r: RateDto) => [r.expected, r.attended, percentAr(r.rate)];

function summarySheets(d: SummaryPayload, agenda: AgendaPayload): ExportSheet[] {
  const dayOf = new Map(agenda.days.map((x) => [x.dayNo, x]));
  const groups: ExportSheet = {
    name: "المشاركون والممكّنون",
    headers: [
      "المستوى",
      "البند",
      "المرحلة",
      "المشاركون المطلوب حضورهم",
      "المشاركون الحاضرون",
      "نسبة حضور المشاركين",
      "الممكّنون المطلوب حضورهم",
      "الممكّنون الحاضرون",
      "نسبة حضور الممكّنين",
    ],
    rows: [
      ...d.phases.map((p) => [
        "المرحلة",
        p.phase,
        p.phase,
        ...rateCellsAr(p.participants),
        ...rateCellsAr(p.enablers),
      ]),
      ...d.days.map((x) => [
        "اليوم",
        dayAr(x.dayNo),
        x.phase ?? dayOf.get(x.dayNo)?.phase ?? "",
        ...rateCellsAr(x.participants),
        ...rateCellsAr(x.enablers),
      ]),
      ...d.sessions.map((s) => [
        "الفقرة",
        `${dayAr(s.dayNo)} · ${s.title} · ${formatTimeAr(s.start)}`,
        dayOf.get(s.dayNo)?.phase ?? "",
        ...rateCellsAr(s.participants),
        ...rateCellsAr(s.enablers),
      ]),
    ],
  };

  const days = [...new Set(d.teams.map((x) => x.dayNo))].sort((a, b) => a - b);
  const teamNos = [...new Set(d.teams.map((x) => x.teamNo))].sort((a, b) => a - b);
  const byKey = new Map(d.teams.map((x) => [`${x.teamNo}:${x.dayNo}`, x]));
  const teams: ExportSheet = {
    name: "الفرق",
    headers: [
      "الفريق",
      ...days.map(dayAr),
      "كل الأيام",
      "أيام حضر فيها الجميع",
      "أيام لم يحضر فيها أحد",
    ],
    rows: teamNos.map((teamNo) => {
      const list = days
        .map((day) => byKey.get(`${teamNo}:${day}`))
        .filter((x): x is NonNullable<typeof x> => !!x);
      return [
        teamNo,
        ...days.map((day) => {
          const x = byKey.get(`${teamNo}:${day}`);
          if (!x) return "";
          const mark = x.allPresent ? " ✓" : x.nonePresent ? " ✗" : "";
          return `${percentAr(x.rate.rate)}${mark}`;
        }),
        percentAr(sumRates(list.map((x) => x.rate)).rate),
        list
          .filter((x) => x.allPresent)
          .map((x) => x.dayNo)
          .join("، "),
        list
          .filter((x) => x.nonePresent)
          .map((x) => x.dayNo)
          .join("، "),
      ];
    }),
  };

  const enablers: ExportSheet = {
    name: "الممكّنون حسب الدور",
    headers: ["الاسم", "الدور", "المطلوب", "الحضور", "نسبة الحضور", "دقائق الحضور", "أيام الظهور"],
    rows: d.enablersByRole.flatMap((g) =>
      g.people.map((p) => [
        p.name,
        ROLE_AR[g.role],
        p.scored ? p.rate.expected : "",
        p.scored ? p.rate.attended : "",
        p.scored ? percentAr(p.rate.rate) : "",
        p.minutes,
        p.daysSeen,
      ]),
    ),
  };
  return [groups, teams, enablers];
}

function extraSheets(d: SummaryPayload): ExportSheet[] {
  const titleOf = new Map(d.sessions.map((s) => [s.id, s]));
  return [
    {
      name: "نقاط التحقق",
      headers: ["اليوم", "الفقرة", "الفريق", "المطلوب", "الحضور", "نسبة الحضور"],
      rows: d.checkpoints.flatMap((c) =>
        c.teams.map((x) => [
          dayAr(c.dayNo),
          titleOf.get(c.sessionId)?.title ?? "",
          x.teamNo,
          ...rateCellsAr(x.rate),
        ]),
      ),
    },
    {
      name: "التدريب على الإلقاء",
      headers: ["اليوم", "الفريق", "حضر مدرب 10 دقائق أو أكثر", "الدقائق", "المدربون"],
      rows: d.pitchCoaching.flatMap((p) =>
        p.teams.map((x) => [
          dayAr(p.dayNo),
          x.teamNo,
          x.covered ? "نعم" : "لا",
          minutesAr(x.minutes),
          x.coaches.join("، "),
        ]),
      ),
    },
    {
      name: "غياب يومين متتاليين",
      headers: ["الاسم", "الدور", "الفريق", "اليومان"],
      rows: d.absentTwoDays.map((x) => [
        x.name,
        ROLE_AR[x.role],
        x.teamNo,
        `${dayAr(x.days[0])} و${dayAr(x.days[1])}`,
      ]),
    },
  ];
}

/** P06 to everyone on the list (FR-ATT-17): one direct message per person. */
function AbsentMessage({ accountIds }: { accountIds: string[] }) {
  const { t } = useTranslation();
  const { edit } = useCampAbilities();
  const [open, setOpen] = useState(false);
  if (!edit || !accountIds.length) return null;
  return (
    <div className="mb-2 flex justify-end">
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("camp.btn.sendMessage")}
      </Button>
      <SendMessageDialog
        open={open}
        onOpenChange={setOpen}
        swUserIds={accountIds}
        defaultTemplate="P06"
      />
    </div>
  );
}
