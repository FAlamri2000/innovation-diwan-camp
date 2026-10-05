/**
 * Camp operations — رفع البيانات › اللجان والعروض (§13).
 *
 *   Committees  which committee room each team uses on each checkpoint day
 *               (FR-ATT-16): the days whose agenda has a checkpoint item.
 *   Judging     each team's own start time in the last day's rounds, so P07
 *               reaches every team 10 minutes before it presents.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, ListRestart, Loader2, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useConfirm } from "@/components/ui/use-confirm";
import { useTranslation } from "@/i18n/use-translation";
import { saveCampCommittees, saveCampJudging } from "@/lib/camp-actions.functions";
import { roundTeams } from "@/lib/camp/agenda";
import { formatHHMMAr, addDays, fromRiyadh, riyadhHHMM } from "@/lib/camp/text";
import type { AgendaPayload, CampSettings } from "@/lib/camp/types";
import { downloadWorkbook } from "../../export-xlsx";
import { errorMessage, useCampAbilities, useCampFormat, useInvalidateCamp } from "../../camp-ui";
import { Section, ToneBox } from "./parts";
import { isHHMM } from "./shared";

/** §3: 4 committee rooms. */
const DEFAULT_COMMITTEES = [1, 2, 3, 4];
const NONE = "none";

export function CommitteesTab({
  agenda,
  settings,
}: {
  agenda: AgendaPayload;
  settings: CampSettings;
}) {
  const teams = useMemo(() => {
    const set = new Set(Array.from({ length: settings.teamCount }, (_, i) => i + 1));
    for (const c of agenda.committees) set.add(c.teamNo);
    return [...set].sort((a, b) => a - b);
  }, [settings.teamCount, agenda.committees]);
  return (
    <div className="space-y-4">
      <CommitteesSection agenda={agenda} teams={teams} />
      <JudgingSection agenda={agenda} settings={settings} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Committees per checkpoint day
// ---------------------------------------------------------------------------

type CommitteeEdits = Record<number, Record<number, number | null>>;

function CommitteesSection({ agenda, teams }: { agenda: AgendaPayload; teams: number[] }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const saveFn = useServerFn(saveCampCommittees);
  const [edits, setEdits] = useState<CommitteeEdits>({});

  const checkpointDays = useMemo(
    () =>
      [...new Set(agenda.sessions.filter((s) => s.type === "checkpoint").map((s) => s.dayNo))].sort(
        (a, b) => a - b,
      ),
    [agenda.sessions],
  );
  const dateOf = (dayNo: number) => agenda.days.find((d) => d.dayNo === dayNo)?.date ?? null;
  const committeeRooms = agenda.rooms.filter((r) => r.kind === "committee");
  const committees = [
    ...new Set([
      ...DEFAULT_COMMITTEES,
      ...committeeRooms.map((r) => r.committeeNo).filter((n): n is number => n !== null),
      ...agenda.committees.map((c) => c.committeeNo),
    ]),
  ].sort((a, b) => a - b);
  const roomLabel = (n: number) => committeeRooms.find((r) => r.committeeNo === n)?.label ?? null;

  const saved = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of agenda.committees) map.set(`${c.dayNo}:${c.teamNo}`, c.committeeNo);
    return map;
  }, [agenda.committees]);
  const savedOf = (day: number, team: number) => saved.get(`${day}:${team}`) ?? null;
  const valueOf = (day: number, team: number) => {
    const e = edits[day];
    return e && team in e ? (e[team] ?? null) : savedOf(day, team);
  };
  const dirty = (day: number) =>
    Object.entries(edits[day] ?? {}).some(([team, v]) => v !== savedOf(day, Number(team)));

  const save = useMutation({
    mutationFn: (day: number) =>
      saveFn({
        data: {
          dayNo: day,
          assignments: teams
            .map((teamNo) => ({ teamNo, committeeNo: valueOf(day, teamNo) }))
            .filter((a): a is { teamNo: number; committeeNo: number } => a.committeeNo !== null),
        },
      }),
    onSuccess: async (_res, day) => {
      toast.success(t("camp.common.saved"));
      setEdits((prev) => {
        const next = { ...prev };
        delete next[day];
        return next;
      });
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const setCell = (day: number, team: number, value: number | null) =>
    setEdits((prev) => ({ ...prev, [day]: { ...(prev[day] ?? {}), [team]: value } }));

  const exportRows = () =>
    downloadWorkbook("لجان نقاط التحقق", [
      {
        name: "لجان نقاط التحقق",
        headers: ["الفريق", ...checkpointDays.map((d) => `اللجنة في اليوم ${d}`)],
        rows: teams.map((team) => [team, ...checkpointDays.map((d) => valueOf(d, team))]),
      },
    ]);

  return (
    <Section
      title={t("camp.upload.committees.title")}
      description={t("camp.upload.committees.description")}
      actions={
        checkpointDays.length ? (
          <Button size="sm" variant="outline" onClick={() => void exportRows()}>
            <Download className="me-1 h-4 w-4" />
            {t("camp.btn.exportExcel")}
          </Button>
        ) : null
      }
    >
      {checkpointDays.length ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t("camp.col.team")}</TableHead>
                {checkpointDays.map((day) => {
                  const counts = committees
                    .map((n) => ({
                      n,
                      count: teams.filter((team) => valueOf(day, team) === n).length,
                    }))
                    .filter((x) => x.count);
                  return (
                    <TableHead key={day} className="min-w-48 py-2 align-top">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <span className="block text-foreground">
                            {t("camp.common.dayN", { n: day })}
                          </span>
                          <span className="block text-xs font-normal">{fmt.date(dateOf(day))}</span>
                        </span>
                        {edit ? (
                          <Button
                            size="sm"
                            variant={dirty(day) ? "default" : "outline"}
                            className="h-7 px-2"
                            disabled={!dirty(day) || save.isPending}
                            onClick={() => save.mutate(day)}
                          >
                            {save.isPending && save.variables === day ? (
                              <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Save className="me-1 h-3.5 w-3.5" />
                            )}
                            {t("camp.btn.save")}
                          </Button>
                        ) : null}
                      </div>
                      {counts.length ? (
                        <p className="mt-1 text-xs font-normal">
                          {counts.map((x) => t("camp.upload.committees.count", x)).join(" · ")}
                        </p>
                      ) : null}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((team) => (
                <TableRow key={team}>
                  <TableCell className="font-medium tabular-nums">{team}</TableCell>
                  {checkpointDays.map((day) => {
                    const value = valueOf(day, team);
                    return (
                      <TableCell key={day} className="py-1.5">
                        {edit ? (
                          <Select
                            value={value === null ? NONE : String(value)}
                            onValueChange={(v) => setCell(day, team, v === NONE ? null : Number(v))}
                          >
                            <SelectTrigger
                              className="h-8 w-44"
                              aria-label={t("camp.upload.committees.cellLabel", { team, day })}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>
                                {t("camp.upload.committees.none")}
                              </SelectItem>
                              {committees.map((n) => (
                                <SelectItem key={n} value={String(n)}>
                                  {t("camp.upload.committees.option", { n })}
                                  {roomLabel(n) ? ` · ${roomLabel(n)}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : value === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span dir="auto">
                            {t("camp.upload.committees.option", { n: value })}
                            {roomLabel(value) ? ` · ${roomLabel(value)}` : ""}
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <ToneBox tone="muted">{t("camp.upload.committees.noDays")}</ToneBox>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Judging order on the last day
// ---------------------------------------------------------------------------

type SlotDraft = { uid: string; teamNo: string; round: string; time: string };

let uidCounter = 0;
const uid = () => `slot-${(uidCounter += 1)}`;

function sortSlots(rows: SlotDraft[]): SlotDraft[] {
  return [...rows].sort(
    (a, b) =>
      (Number(a.round) || 99) - (Number(b.round) || 99) ||
      a.time.localeCompare(b.time) ||
      (Number(a.teamNo) || 999) - (Number(b.teamNo) || 999),
  );
}

function JudgingSection({ agenda, settings }: { agenda: AgendaPayload; settings: CampSettings }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const { confirm, confirmDialog } = useConfirm();
  const saveFn = useServerFn(saveCampJudging);
  const lastDay = settings.dayCount;
  const lastDate =
    agenda.days.find((d) => d.dayNo === lastDay)?.date ?? addDays(settings.startDate, lastDay - 1);

  const savedRows = useMemo(
    () =>
      sortSlots(
        agenda.judging.map((j, index) => ({
          uid: `saved-${index}`,
          teamNo: String(j.teamNo),
          round: String(j.round),
          time: riyadhHHMM(Date.parse(j.startsAt)),
        })),
      ),
    [agenda.judging],
  );
  const [draft, setDraft] = useState<SlotDraft[] | null>(null);
  const rows = draft ?? savedRows;
  const dirty = draft !== null;

  const judgingSessions = agenda.sessions
    .filter((s) => s.dayNo === lastDay && s.type === "judging")
    .sort((a, b) => a.start - b.start);

  const errors = useMemo(() => {
    const out = new Map<string, Set<"team" | "round" | "time">>();
    const flag = (row: SlotDraft, field: "team" | "round" | "time") =>
      out.set(row.uid, new Set([...(out.get(row.uid) ?? []), field]));
    const seen = new Map<number, string>();
    for (const row of rows) {
      const team = /^\d+$/.test(row.teamNo.trim()) ? Number(row.teamNo) : NaN;
      if (!(team >= 1 && team <= Math.max(settings.teamCount, 1))) flag(row, "team");
      else if (seen.has(team)) {
        flag(row, "team");
        const first = rows.find((r) => r.uid === seen.get(team));
        if (first) flag(first, "team");
      } else seen.set(team, row.uid);
      const round = /^\d+$/.test(row.round.trim()) ? Number(row.round) : NaN;
      if (!(round >= 1 && round <= 20)) flag(row, "round");
      if (!isHHMM(row.time)) flag(row, "time");
    }
    return out;
  }, [rows, settings.teamCount]);

  const update = (rowUid: string, patch: Partial<SlotDraft>) =>
    setDraft(rows.map((r) => (r.uid === rowUid ? { ...r, ...patch } : r)));

  const fillFromAgenda = async () => {
    if (rows.length) {
      const ok = await confirm({
        title: t("camp.upload.judging.fillTitle"),
        description: t("camp.upload.judging.fillBody"),
        confirmLabel: t("camp.upload.judging.fill"),
        cancelLabel: t("camp.btn.cancel"),
      });
      if (!ok) return;
    }
    const next: SlotDraft[] = [];
    judgingSessions.forEach((session, index) => {
      const teamsInRound = roundTeams(session.title, settings.teamCount) ?? [];
      for (const teamNo of teamsInRound) {
        next.push({
          uid: uid(),
          teamNo: String(teamNo),
          round: String(index + 1),
          time: riyadhHHMM(session.start),
        });
      }
    });
    if (!next.length) {
      toast.info(t("camp.upload.judging.nothingToFill"));
      return;
    }
    setDraft(next);
  };

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          slots: sortSlots(rows).map((r) => ({
            teamNo: Number(r.teamNo),
            round: Number(r.round),
            startsAt: fromRiyadh(lastDate, r.time).toISOString(),
          })),
        },
      }),
    onSuccess: async () => {
      toast.success(t("camp.common.saved"));
      setDraft(null);
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const exportRows = () =>
    downloadWorkbook("ترتيب عروض الفرق", [
      {
        name: "ترتيب عروض الفرق",
        headers: ["الجولة", "الفريق", "وقت البداية"],
        rows: sortSlots(rows).map((r) => [
          Number(r.round) || r.round,
          Number(r.teamNo) || r.teamNo,
          isHHMM(r.time) ? formatHHMMAr(r.time) : r.time,
        ]),
      },
    ]);

  return (
    <Section
      title={t("camp.upload.judging.title")}
      description={t("camp.upload.judging.description", {
        day: lastDay,
        date: fmt.date(lastDate),
      })}
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportRows()}
            disabled={!rows.length}
          >
            <Download className="me-1 h-4 w-4" />
            {t("camp.btn.exportExcel")}
          </Button>
          {edit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void fillFromAgenda()}
              disabled={!judgingSessions.length}
              title={judgingSessions.length ? undefined : t("camp.upload.judging.nothingToFill")}
            >
              <Wand2 className="me-1 h-4 w-4" />
              {t("camp.upload.judging.fill")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-3">
        {rows.length ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("camp.upload.judging.round")}</TableHead>
                  <TableHead>{t("camp.col.team")}</TableHead>
                  <TableHead>{t("camp.upload.judging.startTime")}</TableHead>
                  {edit ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const bad = errors.get(row.uid);
                  return (
                    <TableRow key={row.uid}>
                      <TableCell className="py-1.5">
                        {edit ? (
                          <Input
                            className="h-8 w-20"
                            inputMode="numeric"
                            dir="ltr"
                            value={row.round}
                            onChange={(e) => update(row.uid, { round: e.target.value })}
                            aria-label={t("camp.upload.judging.round")}
                            aria-invalid={bad?.has("round")}
                          />
                        ) : (
                          <span className="tabular-nums">{row.round}</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5">
                        {edit ? (
                          <Input
                            className="h-8 w-20"
                            inputMode="numeric"
                            dir="ltr"
                            value={row.teamNo}
                            onChange={(e) => update(row.uid, { teamNo: e.target.value })}
                            aria-label={t("camp.col.team")}
                            aria-invalid={bad?.has("team")}
                          />
                        ) : (
                          <span className="tabular-nums">{row.teamNo}</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5">
                        {edit ? (
                          <Input
                            type="time"
                            className="h-8 w-32"
                            dir="ltr"
                            value={row.time}
                            onChange={(e) => update(row.uid, { time: e.target.value })}
                            aria-label={t("camp.upload.judging.startTime")}
                            aria-invalid={bad?.has("time")}
                          />
                        ) : (
                          <span className="whitespace-nowrap">
                            {isHHMM(row.time) ? fmt.hhmm(row.time) : row.time}
                          </span>
                        )}
                      </TableCell>
                      {edit ? (
                        <TableCell className="py-1.5 text-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => setDraft(rows.filter((r) => r.uid !== row.uid))}
                            aria-label={t("camp.upload.judging.removeRow")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("camp.upload.judging.empty")}</p>
        )}

        {errors.size ? (
          <p className="text-xs text-[var(--destructive)]">
            {t("camp.upload.judging.invalid", { max: settings.teamCount })}
          </p>
        ) : null}

        {edit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const last = rows[rows.length - 1];
                setDraft([
                  ...rows,
                  { uid: uid(), teamNo: "", round: last?.round ?? "1", time: last?.time ?? "" },
                ]);
              }}
            >
              <Plus className="me-1 h-4 w-4" />
              {t("camp.upload.judging.addRow")}
            </Button>
            {dirty ? (
              <>
                <Button
                  size="sm"
                  disabled={save.isPending || errors.size > 0}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? (
                    <Loader2 className="me-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="me-1 h-4 w-4" />
                  )}
                  {t("camp.btn.save")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  <ListRestart className="me-1 h-4 w-4" />
                  {t("camp.upload.judging.discard")}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t("camp.upload.judging.unsaved")}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {confirmDialog}
    </Section>
  );
}
