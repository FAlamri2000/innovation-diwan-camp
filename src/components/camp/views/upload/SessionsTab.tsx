/**
 * Camp operations — رفع البيانات › جدول الفقرات (FR-IMP-05).
 *
 * Every agenda item with the type read from its title (the §3 table) and the
 * operator's override. "Automatic" clears the override. Whether an item counts
 * for attendance follows from its type.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { setCampSessionType } from "@/lib/camp-actions.functions";
import { SESSION_TYPES } from "@/lib/camp/agenda";
import { SESSION_TYPE_AR } from "@/lib/camp/copy-ar";
import { formatDateAr, formatTimeAr } from "@/lib/camp/text";
import type { AgendaPayload, SessionRow, SessionType } from "@/lib/camp/types";
import { downloadWorkbook } from "../../export-xlsx";
import {
  errorMessage,
  FilterSelect,
  matchesSearch,
  SearchBox,
  SESSION_TYPE_KEY,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
} from "../../camp-ui";
import { ToneBox } from "./parts";

const AUTO = "auto";

export function SessionsTab({ agenda }: { agenda: AgendaPayload }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const typeFn = useServerFn(setCampSessionType);
  const [day, setDay] = useState<string>("all");
  const [type, setType] = useState<SessionType | "all">("all");
  const [overriddenOnly, setOverriddenOnly] = useState<"overridden" | "all">("all");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const dayByNo = useMemo(() => new Map(agenda.days.map((d) => [d.dayNo, d])), [agenda.days]);
  const rows = useMemo(
    () =>
      agenda.sessions
        .filter((s) => day === "all" || String(s.dayNo) === day)
        .filter((s) => type === "all" || s.type === type)
        .filter((s) => overriddenOnly === "all" || s.typeOverride !== null)
        .filter((s) => matchesSearch(search, [s.title]))
        .sort((a, b) => a.dayNo - b.dayNo || a.start - b.start || a.seq - b.seq),
    [agenda.sessions, day, type, overriddenOnly, search],
  );
  const groups = useMemo(() => {
    const out = new Map<number, SessionRow[]>();
    for (const s of rows) out.set(s.dayNo, [...(out.get(s.dayNo) ?? []), s]);
    return [...out.entries()];
  }, [rows]);

  const setTypeMutation = useMutation({
    mutationFn: (v: { sessionId: string; type: SessionType | null }) => typeFn({ data: v }),
    onMutate: (v) => setSavingId(v.sessionId),
    onSuccess: async () => {
      toast.success(t("camp.common.saved"));
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => setSavingId(null),
  });

  const exportRows = () =>
    downloadWorkbook("جدول الفقرات", [
      {
        name: "جدول الفقرات",
        headers: [
          "اليوم",
          "التاريخ",
          "المرحلة",
          "البداية",
          "النهاية",
          "الفقرة",
          "النوع التلقائي",
          "النوع المعتمد",
          "محتسبة في الحضور",
        ],
        rows: rows.map((s) => {
          const d = dayByNo.get(s.dayNo);
          return [
            s.dayNo,
            d ? formatDateAr(d.date) : "",
            d?.phase ?? "",
            formatTimeAr(s.start),
            formatTimeAr(s.end),
            s.title,
            SESSION_TYPE_AR[s.autoType],
            SESSION_TYPE_AR[s.type],
            s.counted ? "نعم" : "لا",
          ];
        }),
      },
    ]);

  if (!agenda.sessions.length) {
    return <ToneBox tone="muted">{t("camp.upload.sessions.empty")}</ToneBox>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("camp.upload.sessions.description")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={t("camp.upload.sessions.search")}
        />
        <FilterSelect
          label={t("camp.common.day")}
          value={day}
          onChange={setDay}
          options={agenda.days.map((d) => ({ value: String(d.dayNo), label: String(d.dayNo) }))}
        />
        <FilterSelect
          label={t("camp.upload.sessions.type")}
          value={type}
          onChange={setType}
          options={SESSION_TYPES.map((x) => ({ value: x, label: t(SESSION_TYPE_KEY[x]) }))}
        />
        <FilterSelect
          label={t("camp.upload.sessions.override")}
          value={overriddenOnly}
          onChange={setOverriddenOnly}
          options={[{ value: "overridden", label: t("camp.upload.sessions.overriddenOnly") }]}
        />
        <Button
          size="sm"
          variant="outline"
          className="ms-auto"
          onClick={() => void exportRows()}
          disabled={!rows.length}
        >
          <Download className="me-1 h-4 w-4" />
          {t("camp.btn.exportExcel")}
        </Button>
      </div>

      {groups.length ? (
        groups.map(([dayNo, sessions]) => {
          const d = dayByNo.get(dayNo);
          return (
            <div key={dayNo} className="space-y-1.5">
              <h4 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                <span>{t("camp.common.dayN", { n: dayNo })}</span>
                {d ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {fmt.date(d.date)}
                    {d.phase ? (
                      <>
                        {" · "}
                        <span dir="auto">{d.phase}</span>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </h4>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">{t("camp.common.time")}</TableHead>
                      <TableHead>{t("camp.common.session")}</TableHead>
                      <TableHead>{t("camp.upload.sessions.autoType")}</TableHead>
                      <TableHead>{t("camp.upload.sessions.type")}</TableHead>
                      <TableHead>{t("camp.upload.sessions.counted")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums">
                          {fmt.time(s.start)} – {fmt.time(s.end)}
                        </TableCell>
                        <TableCell className="min-w-56" dir="auto">
                          {s.title}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {t(SESSION_TYPE_KEY[s.autoType])}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {edit ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Select
                                value={s.typeOverride ?? AUTO}
                                disabled={savingId === s.id}
                                onValueChange={(v) =>
                                  setTypeMutation.mutate({
                                    sessionId: s.id,
                                    type: v === AUTO ? null : (v as SessionType),
                                  })
                                }
                              >
                                <SelectTrigger
                                  className="h-8 w-52"
                                  aria-label={t("camp.upload.sessions.type")}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={AUTO}>
                                    {t("camp.upload.sessions.auto", {
                                      type: t(SESSION_TYPE_KEY[s.autoType]),
                                    })}
                                  </SelectItem>
                                  {SESSION_TYPES.map((x) => (
                                    <SelectItem key={x} value={x}>
                                      {t(SESSION_TYPE_KEY[x])}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {savingId === s.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                              ) : null}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <ToneBadge tone={s.counted ? "info" : "muted"}>
                                {t(SESSION_TYPE_KEY[s.type])}
                              </ToneBadge>
                              {s.typeOverride ? (
                                <span className="text-xs text-muted-foreground">
                                  {t("camp.upload.sessions.overridden")}
                                </span>
                              ) : null}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ToneBadge tone={s.counted ? "good" : "muted"}>
                            {s.counted ? t("camp.upload.yes") : t("camp.upload.no")}
                          </ToneBadge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          );
        })
      ) : (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          {t("camp.common.noResults")}
        </p>
      )}
    </div>
  );
}
