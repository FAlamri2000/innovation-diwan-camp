/**
 * الاجتماعات والغرف — FR-ATT-04 room placement.
 *
 * Every meeting of the day with its room and how it was placed (topic,
 * participant mix, size, or by an operator). Unplaced meetings read غير محدد;
 * an editor assigns a room to one or many, or restores automatic placement.
 */
import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/ui/query-state";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import type { MessageKey } from "@/i18n";
import { listCampMeetings } from "@/lib/camp-read.functions";
import { assignCampMeetingRoom } from "@/lib/camp-actions.functions";
import type { AgendaPayload, MeetingRow, RoomRow } from "@/lib/camp/types";
import { downloadWorkbook } from "../../export-xlsx";
import {
  campKey,
  errorMessage,
  matchesSearch,
  SearchBox,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
} from "../../camp-ui";
import { DaySelect } from "./controls";
import { roomAr, timeAr } from "./model";

type Source = NonNullable<MeetingRow["roomSource"]>;

const SOURCE_KEY: Record<Source, MessageKey> = {
  topic: "camp.att.rooms.source.topic",
  mix: "camp.att.rooms.source.mix",
  size: "camp.att.rooms.source.size",
  manual: "camp.att.rooms.source.manual",
};

const SOURCE_AR: Record<Source, string> = {
  topic: "من عنوان الاجتماع",
  mix: "من فريق الحاضرين",
  size: "من عدد الحاضرين",
  manual: "محددة يدويًا",
};

const ROOM_KIND_KEY: Record<RoomRow["kind"], MessageKey> = {
  main_hall: "camp.att.rooms.kind.mainHall",
  committee: "camp.att.rooms.kind.committee",
  team: "camp.att.rooms.kind.team",
  other: "camp.att.rooms.kind.other",
};

export function MeetingsTab({
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
  const invalidate = useInvalidateCamp();
  const [unplacedOnly, setUnplacedOnly] = useState(false);
  const [minText, setMinText] = useState("0");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [roomId, setRoomId] = useState<string>("");
  const minParticipants = Math.max(0, Math.min(1000, Number.parseInt(minText, 10) || 0));

  const fn = useServerFn(listCampMeetings);
  const query = useQuery({
    queryKey: campKey("meetings", dayNo, unplacedOnly, minParticipants),
    queryFn: () => fn({ data: { dayNo, unplacedOnly, library: null, minParticipants } }),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const all = useMemo(() => query.data ?? [], [query.data]);
  const rows = useMemo(
    () =>
      all.filter((m) =>
        matchesSearch(search, [m.topic, m.roomLabel, m.sessionTitle, m.library.topic]),
      ),
    [all, search],
  );
  const rowIds = new Set(rows.map((m) => m.meetingId));
  const selectedIds = [...selected].filter((id) => rowIds.has(id));
  const allSelected = rows.length > 0 && rows.every((m) => selected.has(m.meetingId));
  const unplacedCount = all.filter((m) => !m.roomId).length;

  const roomGroups = useMemo(() => {
    const groups = new Map<RoomRow["kind"], RoomRow[]>();
    for (const r of agenda.rooms) groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);
    return [...groups];
  }, [agenda.rooms]);

  const assignFn = useServerFn(assignCampMeetingRoom);
  const assign = useMutation({
    mutationFn: (target: string | null) =>
      assignFn({ data: { meetingIds: selectedIds, roomId: target } }),
    onSuccess: (_res, target) => {
      toast.success(
        target
          ? t("camp.att.rooms.assigned", { count: selectedIds.length })
          : t("camp.att.rooms.restored", { count: selectedIds.length }),
      );
      setSelected(new Set());
      setRoomId("");
      void invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((m) => next.delete(m.meetingId));
      else rows.forEach((m) => next.add(m.meetingId));
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DaySelect
          days={agenda.days}
          value={dayNo}
          onChange={(n) => {
            setSelected(new Set());
            onDayChange(n);
          }}
        />
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={t("camp.att.rooms.searchHint")}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={unplacedOnly} onCheckedChange={(v) => setUnplacedOnly(v === true)} />
          {t("camp.att.rooms.unplacedOnly")}
        </label>
        <div className="flex items-center gap-2">
          <Label htmlFor="att-min-participants" className="whitespace-nowrap text-sm font-normal">
            {t("camp.att.rooms.minParticipants")}
          </Label>
          <Input
            id="att-min-participants"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            dir="ltr"
            className="h-9 w-20"
            value={minText}
            onChange={(e) => setMinText(e.target.value)}
          />
        </div>
      </div>

      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        skeletonRows={6}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {t("camp.users.showing", { shown: rows.length, total: all.length })}
            {" · "}
            {t("camp.att.rooms.unplacedCount", { count: unplacedCount })}
            {selectedIds.length
              ? ` · ${t("camp.users.selected", { count: selectedIds.length })}`
              : ""}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!rows.length}
              onClick={() => void exportMeetings(rows)}
            >
              <Download className="me-1 h-4 w-4" />
              {t("camp.btn.exportExcel")}
            </Button>
            {edit && selectedIds.length ? (
              <>
                <Select value={roomId} onValueChange={setRoomId}>
                  <SelectTrigger className="h-8 w-auto min-w-44" aria-label={t("camp.common.room")}>
                    <SelectValue placeholder={t("camp.att.rooms.chooseRoom")} />
                  </SelectTrigger>
                  <SelectContent>
                    {roomGroups.map(([kind, list]) => (
                      <SelectGroup key={kind}>
                        <SelectLabel>{t(ROOM_KIND_KEY[kind])}</SelectLabel>
                        {list.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            <span dir="auto">{r.label}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!roomId || assign.isPending}
                  onClick={() => assign.mutate(roomId)}
                >
                  {assign.isPending ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : null}
                  {t("camp.att.rooms.assign")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={assign.isPending}
                  onClick={() => assign.mutate(null)}
                >
                  <RotateCcw className="me-1 h-4 w-4" />
                  {t("camp.att.rooms.restore")}
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
                <TableHead className="whitespace-nowrap">{t("camp.common.time")}</TableHead>
                <TableHead>{t("camp.att.rooms.topic")}</TableHead>
                <TableHead className="whitespace-nowrap">
                  {t("camp.att.rooms.participants")}
                </TableHead>
                <TableHead>{t("camp.common.room")}</TableHead>
                <TableHead>{t("camp.common.session")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow
                  key={m.meetingId}
                  data-state={selected.has(m.meetingId) ? "selected" : undefined}
                >
                  {edit ? (
                    <TableCell>
                      <Checkbox
                        checked={selected.has(m.meetingId)}
                        onCheckedChange={() => toggle(m.meetingId)}
                        aria-label={m.topic ?? m.meetingId}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="whitespace-nowrap">
                    {fmt.time(m.startedAt)}
                    <span className="block text-xs text-muted-foreground">
                      {m.status === "active" ? (
                        <ToneBadge tone="info">{t("camp.att.rooms.running")}</ToneBadge>
                      ) : (
                        t("camp.att.rooms.until", { time: fmt.time(m.endedAt) })
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-64" dir="auto">
                    <span className="line-clamp-2" title={m.topic ?? ""}>
                      {m.topic || <span className="text-muted-foreground">—</span>}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{m.participants}</TableCell>
                  <TableCell>
                    {m.roomId ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span dir="auto" className="whitespace-nowrap">
                          {m.roomLabel}
                        </span>
                        {m.roomSource ? (
                          <ToneBadge tone={m.roomSource === "manual" ? "info" : "muted"}>
                            {t(SOURCE_KEY[m.roomSource])}
                          </ToneBadge>
                        ) : null}
                      </span>
                    ) : (
                      <ToneBadge tone="warn">{t("camp.status.undetermined")}</ToneBadge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-56" dir="auto">
                    <span className="line-clamp-2">
                      {m.sessionTitle ?? <span className="text-muted-foreground">—</span>}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {all.length ? t("camp.common.noResults") : t("camp.att.rooms.empty")}
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("camp.att.rooms.rule")}</p>
      </QueryState>
    </div>
  );
}

function exportMeetings(rows: MeetingRow[]) {
  return downloadWorkbook("الاجتماعات والغرف", [
    {
      name: "الاجتماعات والغرف",
      headers: [
        "البداية",
        "النهاية",
        "عنوان الاجتماع",
        "عدد الحاضرين",
        "الغرفة",
        "طريقة تحديد الغرفة",
        "الفقرة",
      ],
      rows: rows.map((m) => [
        timeAr(m.startedAt),
        timeAr(m.endedAt),
        m.topic,
        m.participants,
        roomAr(m.roomId ? m.roomLabel : null),
        m.roomSource ? SOURCE_AR[m.roomSource] : "",
        m.sessionTitle,
      ]),
    },
  ]);
}
