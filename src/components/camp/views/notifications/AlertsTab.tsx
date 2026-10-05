/**
 * تنبيهات التشغيل — the A01–A09 operations alerts (FR-NOT-06): what was
 * raised, when it went to the operators on duty, and who has seen it.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, CheckCheck, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { QueryState } from "@/components/ui/query-state";
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
import { listCampAlerts } from "@/lib/camp-read.functions";
import { acknowledgeCampAlerts } from "@/lib/camp-actions.functions";
import { ALERT_TITLE_AR, NAMING_CODE_AR, type AlertCode } from "@/lib/camp/copy-ar";
import type { AlertRow, Json, NamingCode } from "@/lib/camp/types";
import { formatDateAr, formatTimeAr, riyadhDate } from "@/lib/camp/text";
import { downloadWorkbook } from "../../export-xlsx";
import {
  campKey,
  errorMessage,
  FilterSelect,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
  type Tone,
} from "../../camp-ui";
import { useAgenda } from "./lib";

const CODES = Object.keys(ALERT_TITLE_AR) as AlertCode[];
/** acknowledgeCampAlerts takes at most 500 ids per call. */
const ACK_BATCH = 500;

const isCode = (code: string): code is AlertCode => code in ALERT_TITLE_AR;

function alertTone(a: AlertRow): Tone {
  if (a.acknowledgedAt) return "muted";
  if (a.code === "A09") return "info";
  if (a.code === "A07" || a.code === "A01" || a.code === "A02") return "bad";
  return "warn";
}

const num = (v: Json | undefined): number | null => (typeof v === "number" ? v : null);
const str = (v: Json | undefined): string | null => (typeof v === "string" && v ? v : null);

function coverageOf(v: Json | undefined): { covered: number; total: number } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const total = num(v.total);
  return total ? { covered: num(v.covered) ?? 0, total } : null;
}

const arDateTime = (iso: string | null) =>
  iso ? `${formatDateAr(riyadhDate(Date.parse(iso)))} ${formatTimeAr(Date.parse(iso))}` : "";

export function AlertsTab() {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const [showReviewed, setShowReviewed] = useState(false);
  const [code, setCode] = useState<AlertCode | "all">("all");
  const fn = useServerFn(listCampAlerts);
  const query = useQuery({
    queryKey: campKey("alerts", showReviewed),
    queryFn: () => fn({ data: { includeAcknowledged: showReviewed } }),
    refetchInterval: 60_000,
  });
  const agenda = useAgenda();
  const sessionTitle = useMemo(
    () => new Map((agenda.data?.sessions ?? []).map((s) => [s.id, s.title])),
    [agenda.data],
  );
  const ackFn = useServerFn(acknowledgeCampAlerts);
  const ack = useMutation({
    mutationFn: async (ids: string[]) => {
      for (let i = 0; i < ids.length; i += ACK_BATCH)
        await ackFn({ data: { ids: ids.slice(i, i + ACK_BATCH) } });
    },
    onSuccess: async () => {
      toast.success(t("camp.notif.alerts.acked"));
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const rows = (query.data ?? []).filter((a) => code === "all" || a.code === code);
  const open = rows.filter((a) => !a.acknowledgedAt);

  /** The detail worth a glance, by alert kind (see detectAlerts). */
  const summary = (a: AlertRow): string[] => {
    const d = a.detail;
    const parts: string[] = [];
    const session =
      str(d.session) ?? (str(d.sessionId) ? sessionTitle.get(str(d.sessionId)!) : null);
    if (session) parts.push(session);
    const teamNo = num(d.teamNo);
    if (teamNo !== null) parts.push(t("camp.common.teamN", { n: teamNo }));
    const guider = str(d.guider);
    if (guider) parts.push(guider);
    const name = str(d.name);
    if (name) parts.push(name);
    const sideA = str(d.a);
    const sideB = str(d.b);
    if (sideA && sideB) parts.push(`${sideA} / ${sideB}`);
    if (Array.isArray(d.issues) && d.issues.length)
      parts.push(
        d.issues
          .filter((c): c is string => typeof c === "string")
          .map((c) => t(`camp.naming.code.${c}` as MessageKey))
          .join(fmt.ar ? "، " : ", "),
      );
    const score = num(d.score);
    if (score !== null) parts.push(t("camp.notif.alerts.score", { score }));
    const percent = num(d.percent);
    const here = num(d.here);
    const expected = num(d.expected);
    if (percent !== null) parts.push(fmt.percent(percent));
    if (here !== null && expected !== null)
      parts.push(t("camp.notif.alerts.here", { here, expected }));
    const meetings = num(d.meetings);
    if (meetings !== null) parts.push(t("camp.notif.alerts.meetings", { count: meetings }));
    if (a.code === "A07")
      parts.push(
        str(d.lastEventAt)
          ? t("camp.notif.alerts.lastEvent", { time: fmt.dateTime(str(d.lastEventAt)) })
          : t("camp.notif.alerts.noEvent"),
      );
    if (a.code === "A09") {
      const cov = coverageOf(d.guiderCoverage);
      parts.push(
        `${t("camp.overview.participantRate")} ${fmt.percent(num(d.participantRate))}`,
        `${t("camp.overview.enablerRate")} ${fmt.percent(num(d.enablerRate))}`,
        `${t("camp.overview.guiderCoverage")} ${cov ? `${cov.covered} / ${cov.total}` : "—"}`,
        `${t("camp.notif.alerts.namesFixed")} ${num(d.namesFixed) ?? 0}`,
        `${t("camp.overview.openDuplicates")} ${num(d.openDuplicates) ?? 0}`,
      );
    }
    return parts;
  };

  /** Arabic twin of `summary` for the Excel file (§10). */
  const summaryAr = (a: AlertRow): string => {
    const d = a.detail;
    const parts: string[] = [];
    const session =
      str(d.session) ?? (str(d.sessionId) ? sessionTitle.get(str(d.sessionId)!) : null);
    if (session) parts.push(session);
    if (num(d.teamNo) !== null) parts.push(`الفريق ${num(d.teamNo)}`);
    for (const key of ["guider", "name"] as const) if (str(d[key])) parts.push(str(d[key])!);
    if (str(d.a) && str(d.b)) parts.push(`${str(d.a)} / ${str(d.b)}`);
    if (Array.isArray(d.issues))
      parts.push(
        d.issues
          .filter((c): c is string => typeof c === "string" && c in NAMING_CODE_AR)
          .map((c) => NAMING_CODE_AR[c as NamingCode])
          .join("، "),
      );
    if (num(d.percent) !== null) parts.push(`${num(d.percent)}%`);
    if (num(d.here) !== null && num(d.expected) !== null)
      parts.push(`${num(d.here)} من ${num(d.expected)} حاضرين`);
    if (a.code === "A09") {
      const cov = coverageOf(d.guiderCoverage);
      parts.push(
        `نسبة حضور المشاركين ${num(d.participantRate) ?? "—"}%`,
        `نسبة حضور الممكّنين ${num(d.enablerRate) ?? "—"}%`,
        `تغطية المرشدين ${cov ? `${cov.covered} من ${cov.total}` : "—"}`,
        `الأسماء المصححة ${num(d.namesFixed) ?? 0}`,
        `الحسابات المكررة المفتوحة ${num(d.openDuplicates) ?? 0}`,
      );
    }
    return parts.filter(Boolean).join("، ");
  };

  const exportRows = () =>
    downloadWorkbook("تنبيهات التشغيل", [
      {
        name: "تنبيهات التشغيل",
        headers: [
          "الرمز",
          "التنبيه",
          "التفاصيل",
          "اليوم",
          "وقت التنبيه",
          "أُرسل لفريق العمليات",
          "روجع",
        ],
        rows: rows.map((a) => [
          a.code,
          isCode(a.code) ? ALERT_TITLE_AR[a.code] : a.title,
          summaryAr(a),
          a.dayNo,
          arDateTime(a.createdAt),
          arDateTime(a.notifiedAt),
          arDateTime(a.acknowledgedAt),
        ]),
      },
    ]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("camp.notif.alerts.hint")}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            label={t("camp.notif.alerts.code")}
            value={code}
            onChange={setCode}
            options={CODES.map((c) => ({
              value: c,
              label: `${c} · ${t(`camp.alert.${c}` as MessageKey)}`,
            }))}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showReviewed} onCheckedChange={(v) => setShowReviewed(v === true)} />
            {t("camp.notif.alerts.showReviewed")}
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {edit && open.length ? (
            <Button
              size="sm"
              variant="outline"
              disabled={ack.isPending}
              onClick={() => ack.mutate(open.map((a) => a.id))}
            >
              {ack.isPending ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="me-1 h-4 w-4" />
              )}
              {t("camp.alerts.ackAll")} ({open.length})
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => void exportRows()}>
            <Download className="me-1 h-4 w-4" />
            {t("camp.btn.exportExcel")}
          </Button>
        </div>
      </div>

      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        isEmpty={!rows.length}
        emptyTitle={showReviewed ? t("camp.notif.alerts.empty") : t("camp.alerts.none")}
        skeletonRows={6}
      >
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("camp.notif.alerts.code")}</TableHead>
                <TableHead>{t("camp.notif.alerts.alert")}</TableHead>
                <TableHead>{t("camp.notif.alerts.detail")}</TableHead>
                <TableHead>{t("camp.common.day")}</TableHead>
                <TableHead>{t("camp.notif.alerts.created")}</TableHead>
                <TableHead>{t("camp.notif.alerts.notified")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => {
                const parts = summary(a);
                return (
                  <TableRow key={a.id} className={a.acknowledgedAt ? "opacity-70" : undefined}>
                    <TableCell>
                      <ToneBadge tone={alertTone(a)}>{a.code}</ToneBadge>
                    </TableCell>
                    <TableCell className="min-w-44 font-medium">
                      {isCode(a.code) ? t(`camp.alert.${a.code}` as MessageKey) : a.title}
                    </TableCell>
                    <TableCell className="min-w-56 max-w-md text-sm">
                      {parts.length ? (
                        <span dir="auto" className="text-muted-foreground">
                          {parts.join(" · ")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{a.dayNo ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {fmt.dateTime(a.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {a.notifiedAt ? (
                        fmt.dateTime(a.notifiedAt)
                      ) : (
                        <span className="text-muted-foreground">
                          {t("camp.notif.alerts.notNotified")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-end text-xs">
                      {a.acknowledgedAt ? (
                        <span className="text-muted-foreground">
                          {t("camp.notif.alerts.reviewedAt", {
                            time: fmt.dateTime(a.acknowledgedAt),
                          })}
                        </span>
                      ) : edit ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          disabled={ack.isPending}
                          onClick={() => ack.mutate([a.id])}
                        >
                          <Check className="me-1 h-3.5 w-3.5" />
                          {t("camp.alerts.ack")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </QueryState>
    </div>
  );
}
