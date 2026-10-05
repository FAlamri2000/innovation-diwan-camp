/**
 * سجل الإرسال — every send the dashboard made (FR-NOT-05): item, time,
 * channel, recipients and delivery result. Direct messages with failures can
 * be retried here (M05).
 */
import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { listCampSendLog } from "@/lib/camp-read.functions";
import { retryCampSend } from "@/lib/camp-admin.functions";
import { formatDateAr, formatTimeAr, riyadhDate } from "@/lib/camp/text";
import type { SendLogRow } from "@/lib/camp/types";
import { downloadWorkbook } from "../../export-xlsx";
import {
  campKey,
  errorMessage,
  FilterSelect,
  matchesSearch,
  SearchBox,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
  type Tone,
} from "../../camp-ui";
import {
  CHANNEL_AR,
  CHANNEL_KEY,
  isLogChannel,
  isSendKind,
  KIND_AR,
  KIND_KEY,
  SEND_KINDS,
  SEND_STATUSES,
  SEND_STATUS_AR,
  type LogChannel,
  type SendKind,
  type SendStatus,
} from "./lib";

const PAGE = 200;
const MAX = 500;
const CHANNELS: LogChannel[] = ["dm", "channel", "gong", "announcement", "npc"];
const SHOWN_NAMES = 2;

const STATUS_TONE: Record<SendStatus, Tone> = {
  sent: "good",
  partial: "warn",
  failed: "bad",
  skipped: "muted",
};

/** A failure the server will retry: a DM that reached SoWork and failed there. */
const retryable = (r: SendLogRow) =>
  r.channel === "dm" && r.failures.some((f) => f.userId && !f.error.startsWith("unfilled"));

export function SendLogTab() {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const [limit, setLimit] = useState(PAGE);
  const [kind, setKind] = useState<SendKind | "all">("all");
  const [status, setStatus] = useState<SendStatus | "all">("all");
  const [channel, setChannel] = useState<LogChannel | "all">("all");
  const [search, setSearch] = useState("");
  const fn = useServerFn(listCampSendLog);
  const query = useQuery({
    queryKey: campKey("sendLog", limit),
    queryFn: () => fn({ data: { limit } }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const retryFn = useServerFn(retryCampSend);
  const retry = useMutation({
    mutationFn: (logId: string) => retryFn({ data: { logId } }),
    onSuccess: async (res) => {
      if (res.failed > 0) toast.warning(t("camp.msg.M05", { count: res.failed }));
      else if (res.delivered > 0) toast.success(t("camp.msg.M04", { count: res.delivered }));
      else toast.info(t("camp.notif.log.retryNone"));
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const all = useMemo(() => query.data ?? [], [query.data]);
  const rows = useMemo(
    () =>
      all
        .filter((r) => kind === "all" || r.kind === kind)
        .filter((r) => status === "all" || r.status === status)
        .filter((r) => channel === "all" || r.channel === channel)
        .filter((r) => matchesSearch(search, [r.itemKey, r.text, ...r.recipientNames])),
    [all, kind, status, channel, search],
  );

  const kindLabel = (k: string) => (isSendKind(k) ? t(KIND_KEY[k]) : k);
  const channelLabel = (c: string) => (isLogChannel(c) ? t(CHANNEL_KEY[c]) : c);
  /** Broadcasts have no person recipients: say where they went instead. */
  const audience = (r: SendLogRow): string | null =>
    r.channel === "dm"
      ? null
      : r.channel === "channel"
        ? t("camp.notif.log.publicChannel")
        : r.channel === "npc"
          ? t("camp.notif.log.mainHall")
          : t("camp.notif.log.everyone");
  const audienceAr = (r: SendLogRow): string =>
    r.channel === "dm"
      ? r.recipientNames.join("، ")
      : r.channel === "channel"
        ? "القناة العامة"
        : r.channel === "npc"
          ? "القاعة الرئيسية"
          : "المكتب كله";
  const nameOf = (r: SendLogRow, userId: string | undefined) => {
    if (!userId) return null;
    const i = r.recipients.indexOf(userId);
    return i >= 0 ? (r.recipientNames[i] ?? userId) : userId;
  };

  const exportRows = () =>
    downloadWorkbook("سجل الإرسال", [
      {
        name: "سجل الإرسال",
        headers: [
          "الوقت",
          "النوع",
          "البند",
          "القناة",
          "المستلمون",
          "النص",
          "الحالة",
          "وصلت",
          "حالات التعذر",
        ],
        rows: rows.map((r) => [
          `${formatDateAr(riyadhDate(Date.parse(r.createdAt)))} ${formatTimeAr(Date.parse(r.createdAt))}`,
          isSendKind(r.kind) ? KIND_AR[r.kind] : r.kind,
          r.itemKey,
          isLogChannel(r.channel) ? CHANNEL_AR[r.channel] : r.channel,
          audienceAr(r),
          r.text,
          SEND_STATUS_AR[r.status] ?? r.status,
          r.delivered,
          r.failures
            .map((f) => [nameOf(r, f.userId), f.error].filter(Boolean).join(": "))
            .join("\n"),
        ]),
      },
    ]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={t("camp.notif.log.searchHint")}
        />
        <FilterSelect
          label={t("camp.notif.log.col.kind")}
          value={kind}
          onChange={setKind}
          options={SEND_KINDS.map((k) => ({ value: k, label: t(KIND_KEY[k]) }))}
        />
        <FilterSelect
          label={t("camp.notif.log.col.channel")}
          value={channel}
          onChange={setChannel}
          options={CHANNELS.map((c) => ({ value: c, label: t(CHANNEL_KEY[c]) }))}
        />
        <FilterSelect
          label={t("camp.common.status")}
          value={status}
          onChange={setStatus}
          options={SEND_STATUSES.map((s) => ({
            value: s,
            label: t(`camp.sendStatus.${s}` as MessageKey),
          }))}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {t("camp.users.showing", { shown: rows.length, total: all.length })}
        </span>
        <Button size="sm" variant="outline" onClick={() => void exportRows()}>
          <Download className="me-1 h-4 w-4" />
          {t("camp.btn.exportExcel")}
        </Button>
      </div>

      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        isEmpty={!all.length}
        emptyTitle={t("camp.notif.log.empty")}
        skeletonRows={6}
      >
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("camp.common.time")}</TableHead>
                <TableHead>{t("camp.notif.log.col.kind")}</TableHead>
                <TableHead>{t("camp.notif.log.col.item")}</TableHead>
                <TableHead>{t("camp.notif.log.col.channel")}</TableHead>
                <TableHead>{t("camp.notif.log.col.recipients")}</TableHead>
                <TableHead>{t("camp.notif.text")}</TableHead>
                <TableHead>{t("camp.common.status")}</TableHead>
                <TableHead>{t("camp.notif.log.col.delivered")}</TableHead>
                <TableHead>{t("camp.notif.log.col.failures")}</TableHead>
                {edit ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const where = audience(r);
                const extra = r.recipientNames.length - SHOWN_NAMES;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {fmt.dateTime(r.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{kindLabel(r.kind)}</TableCell>
                    <TableCell className="tabular-nums" dir="ltr">
                      {r.itemKey ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{channelLabel(r.channel)}</TableCell>
                    <TableCell className="min-w-40 max-w-64 text-sm">
                      {where ? (
                        <span className="text-muted-foreground">{where}</span>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <span dir="auto" className="truncate">
                            {r.recipientNames.slice(0, SHOWN_NAMES).join(fmt.ar ? "، " : ", ") ||
                              "—"}
                          </span>
                          {extra > 0 ? (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs">
                                  {t("camp.notif.log.more", { count: extra })}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="max-h-72 w-72 overflow-y-auto p-2">
                                <ul className="space-y-1 text-sm">
                                  {r.recipientNames.map((name, i) => (
                                    <li key={`${r.recipients[i] ?? i}`} dir="auto">
                                      {name}
                                    </li>
                                  ))}
                                </ul>
                              </PopoverContent>
                            </Popover>
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-56 max-w-md">
                      <p dir="auto" className="line-clamp-2 text-sm" title={r.text}>
                        {r.text}
                      </p>
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={STATUS_TONE[r.status] ?? "muted"}>
                        {t(`camp.sendStatus.${r.status}` as MessageKey)}
                      </ToneBadge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {r.channel === "dm"
                        ? t("camp.notif.log.deliveredOf", {
                            delivered: r.delivered,
                            total: r.recipients.length,
                          })
                        : r.delivered}
                    </TableCell>
                    <TableCell className="min-w-40 max-w-64 text-xs">
                      {r.failures.length ? (
                        <Failures row={r} nameOf={nameOf} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {edit ? (
                      <TableCell className="text-end">
                        {retryable(r) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            disabled={retry.isPending}
                            onClick={() => retry.mutate(r.id)}
                          >
                            {retry.isPending && retry.variables === r.id ? (
                              <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="me-1 h-3.5 w-3.5" />
                            )}
                            {t("camp.notif.log.retry")}
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!rows.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("camp.common.noResults")}
            </p>
          ) : null}
        </div>
        {all.length >= limit && limit < MAX ? (
          <div className="flex justify-center">
            <Button
              size="sm"
              variant="outline"
              disabled={query.isFetching}
              onClick={() => setLimit(MAX)}
            >
              {query.isFetching ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : null}
              {t("camp.notif.log.loadMore")}
            </Button>
          </div>
        ) : null}
      </QueryState>
    </div>
  );
}

function Failures({
  row,
  nameOf,
}: {
  row: SendLogRow;
  nameOf: (r: SendLogRow, userId: string | undefined) => string | null;
}) {
  const { t } = useTranslation();
  const first = row.failures[0]!;
  const list = (
    <ul className="space-y-1">
      {row.failures.map((f, i) => (
        <li key={`${f.userId ?? ""}-${i}`}>
          {f.userId ? (
            <span dir="auto" className="font-medium">
              {nameOf(row, f.userId)}:{" "}
            </span>
          ) : null}
          <span dir="ltr" className="text-muted-foreground">
            {f.error}
          </span>
        </li>
      ))}
    </ul>
  );
  if (row.failures.length === 1) return list;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span dir="ltr" className="truncate text-muted-foreground" title={first.error}>
        {first.error}
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs">
            {t("camp.notif.log.more", { count: row.failures.length - 1 })}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="max-h-72 w-80 overflow-y-auto p-2 text-xs">
          {list}
        </PopoverContent>
      </Popover>
    </span>
  );
}
