/**
 * Camp operations — التصدير (§10, FR-EXP-01..09).
 *
 * The nine workbooks, each built from fresh data with no filter (everything).
 * Each screen's own "تصدير إلى إكسل" exports exactly what is filtered there.
 * Files, sheets, headers and values are Arabic whatever the interface
 * language; recording links are the SoWork deepLink, never the video URL.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { QueryState } from "@/components/ui/query-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MessageKey } from "@/i18n";
import { useTranslation } from "@/i18n/use-translation";
import {
  getAttendanceDay,
  getAttendanceSummary,
  getAttendanceWindow,
  getCampAgenda,
  getCampDirectory,
  getCampDuplicates,
  getCampNaming,
  getCampSettings,
  getGuiderCoverage,
  getPersonMeetings,
} from "@/lib/camp-read.functions";
import {
  ACCOUNT_TYPE_AR,
  ATT_STATUS_AR,
  DECISION_AR,
  DUPLICATE_LEVEL_AR,
  LATE_AR,
  MATCH_STATE_AR,
  NAMING_CODE_AR,
  NAMING_STATUS_AR,
  ROLE_AR,
  SESSION_TYPE_AR,
  TYPE_CHANGE_STATUS_AR,
  UNDETERMINED_AR,
} from "@/lib/camp/copy-ar";
import {
  addDays,
  daysBetween,
  formatDateAr,
  formatTimeAr,
  fromRiyadh,
  riyadhDate,
  riyadhHHMM,
} from "@/lib/camp/text";
import type {
  AgendaPayload,
  AttCellDto,
  DirectoryPayload,
  DuplicateRow,
  RateDto,
  RegistryCheckRow,
} from "@/lib/camp/types";
import { downloadWorkbook, type ExportCell, type ExportSheet } from "../export-xlsx";
import { campKey, errorMessage, PageTitle, useCampFormat } from "../camp-ui";
import { ToneBox } from "./upload/parts";
import { isHHMM } from "./upload/shared";

type ExportId = "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09";

/** §10: the Arabic file and sheet name of each export. */
const FILE_NAME: Record<ExportId, string> = {
  "01": "دليل المستخدمين",
  "02": "الأسماء المخالفة",
  "03": "الحسابات المكررة",
  "04": "طلبات تغيير نوع الحساب",
  "05": "كشف الحضور اليومي",
  "06": "كشف الحضور لفترة محددة",
  "07": "اجتماعات المستخدمين",
  "08": "ملخص الحضور",
  "09": "لم يدخلوا المنصة",
};
const IDS = Object.keys(FILE_NAME) as ExportId[];

// Arabic values the shared copy file does not hold (duplicate reasons, registry checks).
const PAIR_REASON_AR: Record<DuplicateRow["reasons"][number], string> = {
  same_name: "الاسم نفسه",
  same_registry: "مرتبطان بسجل واحد",
  same_name_other_suffix: "الاسم نفسه بلاحقة مختلفة",
  middle_name: "أحد الاسمين يزيد اسمًا أوسط",
  score: "درجة تشابه عالية",
  lookalike: "تشابه أسماء",
};
const REGISTRY_CHECK_AR: Record<RegistryCheckRow["kind"], string> = {
  same_phone: "رقم جوال مشترك",
  same_email: "بريد إلكتروني مشترك",
  similar_email: "بريد إلكتروني متقارب",
  two_teams: "شخص في فريقين",
  guider_and_coach: "في ورقتي المرشدين والمدربين",
};
const YES_AR = "نعم";
const MINUTES_AR = "د";

// ---------------------------------------------------------------------------
// Arabic formatting for cells (FR-UI-03, Riyadh time)
// ---------------------------------------------------------------------------

const arTime = (ms: number | null | undefined): string =>
  ms === null || ms === undefined ? "" : formatTimeAr(ms);

function arDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return `${formatDateAr(riyadhDate(ms))} ${formatTimeAr(ms)}`;
}

function attCell(cell: AttCellDto | undefined): string {
  if (!cell || cell.status === "not_expected") return "";
  const minutes =
    cell.minutes > 0 && cell.status !== "off_platform" ? ` (${cell.minutes} ${MINUTES_AR})` : "";
  return `${ATT_STATUS_AR[cell.status]}${minutes}${cell.late ? ` · ${LATE_AR}` : ""}`;
}

const rateValue = (rate: RateDto): ExportCell => rate.rate;

// ---------------------------------------------------------------------------
// Workbook builders
// ---------------------------------------------------------------------------

function directorySheets(d: DirectoryPayload): ExportSheet[] {
  const guiderOfTeam = new Map(d.teams.map((team) => [team.teamNo, team.guiderName]));
  return [
    {
      name: FILE_NAME["01"],
      headers: [
        "الاسم كما يظهر",
        "الدور في المعسكر",
        "الفريق",
        "المرشد",
        "نوع الحساب",
        "الجوال",
        "حالة الربط بالسجل",
        "حالة التسمية",
        "التكرار",
      ],
      rows: [
        ...d.accounts.map((a): ExportCell[] => [
          a.name,
          ROLE_AR[a.eventRole],
          a.teamNo,
          a.guiderName,
          ACCOUNT_TYPE_AR[a.accountType],
          a.phone,
          MATCH_STATE_AR[a.matchState],
          NAMING_STATUS_AR[a.naming],
          a.duplicate ? DUPLICATE_LEVEL_AR[a.duplicate] : "",
        ]),
        // FR-USR-01: registry people with no account are part of the directory.
        ...d.missing.map((r): ExportCell[] => [
          r.name,
          ROLE_AR[r.kind],
          r.teamNo,
          r.kind === "participant" && r.teamNo !== null ? guiderOfTeam.get(r.teamNo) : "",
          ACCOUNT_TYPE_AR.none,
          r.phone,
          MATCH_STATE_AR.no_account,
          "",
          "",
        ]),
      ],
    },
  ];
}

function coverageText(minutes: number, covered: boolean): string {
  if (covered) return `${ATT_STATUS_AR.present} (${minutes} ${MINUTES_AR})`;
  if (minutes > 0) return `${ATT_STATUS_AR.partial} (${minutes} ${MINUTES_AR})`;
  return ATT_STATUS_AR.absent;
}

// ---------------------------------------------------------------------------

export function ExportsView() {
  const { t } = useTranslation();
  const settingsFn = useServerFn(getCampSettings);
  const agendaFn = useServerFn(getCampAgenda);
  const settings = useQuery({ queryKey: campKey("settings"), queryFn: () => settingsFn() });
  const agenda = useQuery({ queryKey: campKey("agenda"), queryFn: () => agendaFn() });
  return (
    <div className="space-y-4">
      <PageTitle title={t("camp.nav.exports")} description={t("camp.exports.description")} />
      <ToneBox tone="info">{t("camp.exports.note")}</ToneBox>
      <QueryState
        isPending={settings.isPending || agenda.isPending}
        isError={settings.isError || agenda.isError}
        error={settings.error ?? agenda.error}
        onRetry={() => {
          void settings.refetch();
          void agenda.refetch();
        }}
        skeletonRows={6}
      >
        {settings.data && agenda.data ? (
          <ExportList
            startDate={settings.data.settings.startDate}
            dayCount={settings.data.settings.dayCount}
            defaultWindow={[
              settings.data.settings.mentoringWindowStart,
              settings.data.settings.mentoringWindowEnd,
            ]}
            agenda={agenda.data}
          />
        ) : null}
      </QueryState>
    </div>
  );
}

function ExportList({
  startDate,
  dayCount,
  defaultWindow,
  agenda,
}: {
  startDate: string;
  dayCount: number;
  /** The mentoring window (BR-ATT-04): the window most often asked for. */
  defaultWindow: [string, string];
  agenda: AgendaPayload;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const client = useQueryClient();
  const directoryFn = useServerFn(getCampDirectory);
  const namingFn = useServerFn(getCampNaming);
  const duplicatesFn = useServerFn(getCampDuplicates);
  const dayFn = useServerFn(getAttendanceDay);
  const windowFn = useServerFn(getAttendanceWindow);
  const meetingsFn = useServerFn(getPersonMeetings);
  const summaryFn = useServerFn(getAttendanceSummary);
  const coverageFn = useServerFn(getGuiderCoverage);

  const days = useMemo(() => {
    const byNo = new Map(agenda.days.map((d) => [d.dayNo, d.date]));
    return Array.from({ length: dayCount }, (_, i) => ({
      n: i + 1,
      date: byNo.get(i + 1) ?? addDays(startDate, i),
    }));
  }, [agenda.days, dayCount, startDate]);
  const today = Math.min(dayCount, Math.max(1, daysBetween(startDate, riyadhDate(Date.now())) + 1));

  const [busy, setBusy] = useState<ExportId | null>(null);
  const [day05, setDay05] = useState(today);
  const [day07, setDay07] = useState(today);
  const [windowDay, setWindowDay] = useState(today);
  const [windowSession, setWindowSession] = useState<string>("custom");
  const [from, setFrom] = useState(defaultWindow[0]);
  const [to, setTo] = useState(defaultWindow[1]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelled = useRef(false);

  const dateOf = (n: number) => days.find((d) => d.n === n)?.date ?? addDays(startDate, n - 1);
  const windowSessions = agenda.sessions
    .filter((s) => s.dayNo === windowDay)
    .sort((a, b) => a.start - b.start);
  const windowError =
    !isHHMM(from) || !isHHMM(to)
      ? t("camp.exports.windowInvalid")
      : from >= to
        ? t("camp.exports.windowOrder")
        : null;

  const cached = <T,>(key: unknown[], fn: () => Promise<T>) =>
    client.fetchQuery({ queryKey: campKey(...key), queryFn: fn, staleTime: 30_000 });

  const run = async (id: ExportId, job: () => Promise<boolean | void>) => {
    setBusy(id);
    try {
      const done = await job();
      if (done !== false) toast.success(t("camp.exports.done", { file: FILE_NAME[id] }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const jobs: Record<ExportId, () => Promise<boolean | void>> = {
    "01": async () => {
      const d = await cached(["directory"], () => directoryFn());
      await downloadWorkbook(FILE_NAME["01"], directorySheets(d));
    },
    "02": async () => {
      const d = await cached(["naming"], () => namingFn());
      await downloadWorkbook(FILE_NAME["02"], [
        {
          name: FILE_NAME["02"],
          headers: [
            "الاسم كما يظهر",
            "حالة التسمية",
            "الملاحظات",
            "الاسم المقترح",
            "الجوال",
            "الفريق",
            "المرشد",
            "الدور في المعسكر",
            "نوع الحساب",
            "أول ظهور",
            "تاريخ إرسال الرسالة",
            "تاريخ التصحيح",
          ],
          rows: d.rows.map((a) => [
            a.name,
            NAMING_STATUS_AR[a.naming],
            a.issues.map((code) => NAMING_CODE_AR[code]).join("، "),
            a.suggestedName,
            a.phone,
            a.teamNo,
            a.guiderName,
            ROLE_AR[a.eventRole],
            ACCOUNT_TYPE_AR[a.accountType],
            arDateTime(a.firstSeenAt),
            arDateTime(a.lastNamingMessageAt),
            arDateTime(a.nameFixedAt),
          ]),
        },
      ]);
    },
    "03": async () => {
      const d = await cached(["exports", "duplicates"], () =>
        duplicatesFn({ data: { includeHidden: true } }),
      );
      await downloadWorkbook(FILE_NAME["03"], [
        {
          name: FILE_NAME["03"],
          headers: [
            "الحساب الأول",
            "الحساب الثاني",
            "الدرجة",
            "المستوى",
            "السبب",
            "القرار",
            "الحساب الأساسي",
            "صاحب القرار",
            "تاريخ القرار",
            "ملاحظة",
          ],
          rows: d.pairs.map((p) => [
            p.a.name,
            p.b.name,
            p.score,
            DUPLICATE_LEVEL_AR[p.level],
            p.reasons.map((r) => PAIR_REASON_AR[r]).join("، "),
            p.decision ? DECISION_AR[p.decision] : "",
            p.primaryId === p.a.swUserId ? p.a.name : p.primaryId === p.b.swUserId ? p.b.name : "",
            p.decidedBy,
            arDateTime(p.decidedAt),
            p.note,
          ]),
        },
        {
          name: "فحوص السجل",
          headers: ["الفحص", "القيمة", "الأشخاص"],
          rows: d.checks.map((c) => [
            REGISTRY_CHECK_AR[c.kind],
            c.value,
            c.people
              .map((person) =>
                person.teamNo !== null ? `${person.name} (${person.teamNo})` : person.name,
              )
              .join("، "),
          ]),
        },
      ]);
    },
    "04": async () => {
      const d = await cached(["directory"], () => directoryFn());
      await downloadWorkbook(FILE_NAME["04"], [
        {
          name: FILE_NAME["04"],
          headers: [
            "الاسم",
            "نوع الحساب الحالي",
            "نوع الحساب المطلوب",
            "السبب",
            "الحالة",
            "تاريخ الطلب",
          ],
          rows: d.typeChanges.map((r) => [
            r.name,
            r.currentType ? ACCOUNT_TYPE_AR[r.currentType] : "",
            r.kind === "remove"
              ? "حذف الحساب"
              : r.requestedType
                ? ACCOUNT_TYPE_AR[r.requestedType]
                : "",
            r.reason,
            TYPE_CHANGE_STATUS_AR[r.status],
            arDateTime(r.requestedAt),
          ]),
        },
      ]);
    },
    "05": async () => {
      const sheet = await cached(["exports", "day", day05], () =>
        dayFn({ data: { dayNo: day05 } }),
      );
      const counted = sheet.sessions.filter((s) => s.counted).sort((a, b) => a.start - b.start);
      await downloadWorkbook(`${FILE_NAME["05"]} (اليوم ${day05})`, [
        {
          name: FILE_NAME["05"],
          headers: [
            "الاسم",
            "الدور في المعسكر",
            "الفريق",
            "الدخول",
            "الخروج",
            "الوقت على المنصة (دقيقة)",
            "الوقت في الاجتماعات (دقيقة)",
            ...counted.map((s) => `${s.title} ${formatTimeAr(s.start)}`),
          ],
          rows: sheet.rows.map((r) => [
            r.name,
            ROLE_AR[r.role],
            r.teamNo,
            arTime(r.entry),
            arTime(r.exit),
            Math.round(r.platformSeconds / 60),
            r.meetingMinutes,
            ...counted.map((s) => attCell(r.cells[s.id])),
          ]),
        },
      ]);
    },
    "06": async () => {
      if (windowError) {
        toast.error(windowError);
        return false;
      }
      const date = dateOf(windowDay);
      const fromMs = fromRiyadh(date, from).getTime();
      const toMs = fromRiyadh(date, to).getTime();
      const rows = await windowFn({ data: { from: fromMs, to: toMs } });
      await downloadWorkbook(`${FILE_NAME["06"]} (اليوم ${windowDay})`, [
        {
          name: FILE_NAME["06"],
          headers: [
            "الاسم",
            "الدور في المعسكر",
            "الفريق",
            "الدخول",
            "الدقائق في الفترة",
            "الاجتماعات في الفترة",
            "بداية الفترة",
            "نهاية الفترة",
          ],
          rows: rows.map((r) => [
            r.name,
            ROLE_AR[r.role],
            r.teamNo,
            arTime(r.entry),
            r.minutes,
            r.meetings
              .map((m) => `${m.roomLabel ?? UNDETERMINED_AR} (${m.minutes} ${MINUTES_AR})`)
              .join("، "),
            arDateTime(fromMs),
            arDateTime(toMs),
          ]),
        },
      ]);
    },
    "07": async () => {
      const sheet = await cached(["exports", "day", day07], () =>
        dayFn({ data: { dayNo: day07 } }),
      );
      cancelled.current = false;
      const people = sheet.rows;
      setProgress({ done: 0, total: people.length });
      const rows: ExportCell[][] = [];
      // One person at a time: the meetings read is heavy on the server.
      for (let i = 0; i < people.length; i += 1) {
        if (cancelled.current) {
          toast.info(t("camp.exports.cancelled"));
          return false;
        }
        const person = people[i]!;
        const meetings = await meetingsFn({ data: { key: person.key, dayNo: day07 } });
        for (const m of meetings) {
          rows.push([
            person.name,
            m.topic ?? "",
            m.roomLabel ?? UNDETERMINED_AR,
            m.sessionTitle ?? "",
            arTime(m.joinedAt),
            arTime(m.leftAt),
            m.minutes,
            m.deepLink ? { text: m.deepLink, hyperlink: m.deepLink } : "",
          ]);
        }
        setProgress({ done: i + 1, total: people.length });
      }
      await downloadWorkbook(`${FILE_NAME["07"]} (اليوم ${day07})`, [
        {
          name: FILE_NAME["07"],
          headers: [
            "الاسم",
            "الاجتماع",
            "الغرفة",
            "الفقرة",
            "الدخول",
            "الخروج",
            "الدقائق",
            "رابط التسجيل",
          ],
          rows,
        },
      ]);
    },
    "08": async () => {
      const [summary, coverage] = await Promise.all([
        cached(["summary"], () => summaryFn()),
        cached(["coverage"], () => coverageFn()),
      ]);
      const phaseOfDay = new Map(summary.days.map((d) => [d.dayNo, d.phase]));
      const rateHeaders = [
        "المشاركون: المطلوب",
        "المشاركون: الحاضرون",
        "نسبة حضور المشاركين %",
        "الممكّنون: المطلوب",
        "الممكّنون: الحاضرون",
        "نسبة حضور الممكّنين %",
      ];
      const rates = (p: RateDto, e: RateDto): ExportCell[] => [
        p.expected,
        p.attended,
        rateValue(p),
        e.expected,
        e.attended,
        rateValue(e),
      ];
      const guiderRows = new Map<
        string,
        { teamNo: number; guider: string; byDay: Map<number, string> }
      >();
      for (const cell of coverage.cells) {
        const key = `${cell.teamNo}|${cell.guiderKey}`;
        const row = guiderRows.get(key) ?? {
          teamNo: cell.teamNo,
          guider: cell.guiderName,
          byDay: new Map<number, string>(),
        };
        row.byDay.set(cell.dayNo, coverageText(cell.minutes, cell.covered));
        guiderRows.set(key, row);
      }
      await downloadWorkbook(FILE_NAME["08"], [
        {
          name: "المشاركون والممكّنون",
          headers: ["المستوى", "اليوم", "المرحلة", "الفقرة", "النوع", ...rateHeaders],
          rows: [
            ...summary.sessions.map((s) => [
              "فقرة",
              s.dayNo,
              phaseOfDay.get(s.dayNo) ?? "",
              s.title,
              SESSION_TYPE_AR[s.type],
              ...rates(s.participants, s.enablers),
            ]),
            ...summary.days.map((d) => [
              "يوم",
              d.dayNo,
              d.phase ?? "",
              "",
              "",
              ...rates(d.participants, d.enablers),
            ]),
            ...summary.phases.map((p) => [
              "مرحلة",
              "",
              p.phase,
              "",
              "",
              ...rates(p.participants, p.enablers),
            ]),
          ],
        },
        {
          name: "الفرق",
          headers: [
            "الفريق",
            "اليوم",
            "المطلوب",
            "الحاضرون",
            "النسبة %",
            "حضر الجميع",
            "لم يحضر أحد",
          ],
          rows: [...summary.teams]
            .sort((a, b) => a.teamNo - b.teamNo || a.dayNo - b.dayNo)
            .map((team) => [
              team.teamNo,
              team.dayNo,
              team.rate.expected,
              team.rate.attended,
              rateValue(team.rate),
              team.allPresent ? YES_AR : "",
              team.nonePresent ? YES_AR : "",
            ]),
        },
        {
          name: "الممكّنون حسب الدور",
          headers: [
            "الدور في المعسكر",
            "الاسم",
            "طريقة القياس",
            "المطلوب",
            "الحضور",
            "النسبة %",
            "الدقائق",
            "أيام الظهور",
          ],
          rows: summary.enablersByRole.flatMap((group) =>
            group.people.map((p) => [
              ROLE_AR[group.role],
              p.name,
              p.scored ? "مقيس بالبرنامج" : "حضور ودقائق فقط",
              p.scored ? p.rate.expected : "",
              p.scored ? p.rate.attended : "",
              p.scored ? rateValue(p.rate) : "",
              p.minutes,
              p.daysSeen,
            ]),
          ),
        },
        {
          name: "تغطية المرشدين",
          headers: ["الفريق", "المرشد", ...coverage.days.map((n) => `اليوم ${n}`)],
          rows: [...guiderRows.values()]
            .sort((a, b) => a.teamNo - b.teamNo || a.guider.localeCompare(b.guider, "ar"))
            .map((row) => [
              row.teamNo,
              row.guider,
              ...coverage.days.map((n) => row.byDay.get(n) ?? ""),
            ]),
        },
      ]);
    },
    "09": async () => {
      const d = await cached(["directory"], () => directoryFn());
      await downloadWorkbook(FILE_NAME["09"], [
        {
          name: FILE_NAME["09"],
          headers: ["الاسم", "الفريق", "الدور في المعسكر", "الجوال", "البريد الإلكتروني"],
          rows: d.missing.map((r) => [r.name, r.teamNo, ROLE_AR[r.kind], r.phone, r.email]),
        },
      ]);
    },
  };

  const dayPicker = (value: number, onChange: (n: number) => void, id: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("camp.common.day")}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id={id} className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {days.map((d) => (
            <SelectItem key={d.n} value={String(d.n)}>
              {t("camp.common.dayN", { n: d.n })} · {fmt.date(d.date)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const controls: Partial<Record<ExportId, ReactNode>> = {
    "05": dayPicker(day05, setDay05, "camp-export-day05"),
    "06": (
      <div className="space-y-3">
        {dayPicker(
          windowDay,
          (n) => {
            setWindowDay(n);
            setWindowSession("custom");
          },
          "camp-export-window-day",
        )}
        <div className="space-y-1.5">
          <Label htmlFor="camp-export-window-session">{t("camp.common.session")}</Label>
          <Select
            value={windowSession}
            onValueChange={(v) => {
              setWindowSession(v);
              const s = windowSessions.find((x) => x.id === v);
              if (s) {
                setFrom(riyadhHHMM(s.start));
                setTo(riyadhHHMM(s.end));
              }
            }}
          >
            <SelectTrigger id="camp-export-window-session" className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">{t("camp.exports.customWindow")}</SelectItem>
              {windowSessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {fmt.time(s.start)} · {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="camp-export-from">{t("camp.exports.from")}</Label>
            <Input
              id="camp-export-from"
              type="time"
              dir="ltr"
              className="w-32"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setWindowSession("custom");
              }}
              aria-invalid={!!windowError}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-export-to">{t("camp.exports.to")}</Label>
            <Input
              id="camp-export-to"
              type="time"
              dir="ltr"
              className="w-32"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setWindowSession("custom");
              }}
              aria-invalid={!!windowError}
            />
          </div>
        </div>
        {windowError ? (
          <p className="text-xs text-[var(--destructive)]">{windowError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("camp.exports.windowSummary", {
              date: fmt.date(dateOf(windowDay)),
              from: fmt.hhmm(from),
              to: fmt.hhmm(to),
            })}
          </p>
        )}
      </div>
    ),
    "07": (
      <div className="space-y-2">
        {dayPicker(day07, setDay07, "camp-export-day07")}
        <p className="text-xs text-muted-foreground">{t("camp.exports.meetingsSlow")}</p>
        {busy === "07" && progress ? (
          <div className="space-y-1">
            <Progress
              value={progress.total ? (progress.done / progress.total) * 100 : 0}
              aria-label={t("camp.exports.progress", progress)}
            />
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{t("camp.exports.progress", progress)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => {
                  cancelled.current = true;
                }}
              >
                <X className="me-1 h-3.5 w-3.5" />
                {t("camp.btn.cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    ),
  };

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {IDS.map((id) => (
        <section key={id} className="flex flex-col rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                FR-EXP-{id}
              </p>
              <h3 className="text-sm font-semibold">
                {t(`camp.exports.e${id}.title` as MessageKey)}
              </h3>
            </div>
            <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          </div>
          <p className="mt-2 text-sm">
            <span className="text-muted-foreground">{t("camp.exports.fileName")}: </span>
            <span dir="rtl" lang="ar" className="font-medium">
              {FILE_NAME[id]}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`camp.exports.e${id}.columns` as MessageKey)}
          </p>
          {controls[id] ? <div className="mt-3">{controls[id]}</div> : null}
          <div className="mt-auto pt-4">
            <Button
              size="sm"
              disabled={busy !== null || (id === "06" && !!windowError)}
              onClick={() => void run(id, jobs[id])}
            >
              {busy === id ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Download className="me-1 h-4 w-4" />
              )}
              {t("camp.btn.exportExcel")}
            </Button>
          </div>
        </section>
      ))}
    </div>
  );
}
