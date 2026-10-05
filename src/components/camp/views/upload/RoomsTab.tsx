/**
 * Camp operations — رفع البيانات › خريطة الغرف (FR-IMP-06).
 *
 * The meeting object has no room field, so a meeting is placed by its topic
 * against this map first, then by who is in it (FR-ATT-04). Zone ids are
 * copied by hand from the office (§13): the API cannot list them.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import type { MessageKey } from "@/i18n";
import { useTranslation } from "@/i18n/use-translation";
import { deleteCampRoom, saveCampRoom } from "@/lib/camp-actions.functions";
import { MAIN_HALL_AR, TEAM_ROOM_AR } from "@/lib/camp/copy-ar";
import type { RoomRow } from "@/lib/camp/types";
import { downloadWorkbook } from "../../export-xlsx";
import {
  errorMessage,
  FilterSelect,
  matchesSearch,
  SearchBox,
  ToneBadge,
  useCampAbilities,
  useInvalidateCamp,
} from "../../camp-ui";
import { ToneBox } from "./parts";
import { splitList } from "./shared";

type RoomKind = RoomRow["kind"];
const KINDS: RoomKind[] = ["main_hall", "team", "committee", "other"];
const KIND_KEY: Record<RoomKind, MessageKey> = {
  main_hall: "camp.upload.rooms.kind.main_hall",
  team: "camp.upload.rooms.kind.team",
  committee: "camp.upload.rooms.kind.committee",
  other: "camp.upload.rooms.kind.other",
};
const KIND_AR: Record<RoomKind, string> = {
  main_hall: "القاعة الرئيسية",
  team: "غرفة الفريق",
  committee: "غرفة لجنة",
  other: "أخرى",
};
const KIND_ORDER: Record<RoomKind, number> = { main_hall: 0, committee: 1, team: 2, other: 3 };
/** §3: checkpoints run in 4 committee rooms. */
const COMMITTEE_ROOMS = 4;

export function RoomsTab({ rooms, teamCount }: { rooms: RoomRow[]; teamCount: number | null }) {
  const { t } = useTranslation();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const { confirm, confirmDialog } = useConfirm();
  const deleteFn = useServerFn(deleteCampRoom);
  const [kind, setKind] = useState<RoomKind | "all">("all");
  const [noTopic, setNoTopic] = useState<"missing" | "all">("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RoomRow | "new" | null>(null);

  const rows = useMemo(
    () =>
      rooms
        .filter((r) => kind === "all" || r.kind === kind)
        .filter((r) => noTopic === "all" || !r.topics.length || !r.zoneId)
        .filter((r) =>
          matchesSearch(search, [r.label, r.teamNo, r.committeeNo, r.zoneId, ...r.topics]),
        )
        .sort(
          (a, b) =>
            KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
            (a.teamNo ?? a.committeeNo ?? 0) - (b.teamNo ?? b.committeeNo ?? 0) ||
            a.label.localeCompare(b.label, "ar"),
        ),
    [rooms, kind, noTopic, search],
  );

  const teamRooms = rooms.filter((r) => r.kind === "team");
  const teamsWithoutTopic = teamRooms.filter((r) => !r.topics.length).length;
  const hasMainHall = rooms.some((r) => r.kind === "main_hall");
  const committeeRooms = rooms.filter((r) => r.kind === "committee").length;
  const missingTeams =
    teamCount !== null
      ? Array.from({ length: teamCount }, (_, i) => i + 1).filter(
          (n) => !teamRooms.some((r) => r.teamNo === n),
        )
      : [];

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: async () => {
      toast.success(t("camp.upload.rooms.deleted"));
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const exportRows = () =>
    downloadWorkbook("خريطة الغرف", [
      {
        name: "خريطة الغرف",
        headers: [
          "نوع الغرفة",
          "رقم الفريق",
          "رقم اللجنة",
          "اسم الغرفة",
          "موضوعات الاجتماع",
          "معرّف المنطقة",
        ],
        rows: rows.map((r) => [
          KIND_AR[r.kind],
          r.teamNo,
          r.committeeNo,
          r.label,
          r.topics.join("، "),
          r.zoneId,
        ]),
      },
    ]);

  return (
    <div className="space-y-3">
      <ToneBox tone="info" title={t("camp.upload.rooms.howTitle")}>
        <ul className="list-disc space-y-1 ps-5">
          <li>{t("camp.upload.rooms.howTopic")}</li>
          <li>{t("camp.upload.rooms.howMix")}</li>
          <li>{t("camp.upload.rooms.howZone")}</li>
        </ul>
      </ToneBox>

      {!hasMainHall ||
      committeeRooms < COMMITTEE_ROOMS ||
      teamsWithoutTopic ||
      missingTeams.length ? (
        <ToneBox tone="warn" title={t("camp.upload.rooms.gapsTitle")}>
          <ul className="list-disc space-y-1 ps-5">
            {!hasMainHall ? <li>{t("camp.upload.rooms.noMainHall")}</li> : null}
            {committeeRooms < COMMITTEE_ROOMS ? (
              <li>
                {t("camp.upload.rooms.fewCommittees", {
                  count: committeeRooms,
                  expected: COMMITTEE_ROOMS,
                })}
              </li>
            ) : null}
            {missingTeams.length ? (
              <li>{t("camp.upload.rooms.missingTeams", { teams: missingTeams.join("، ") })}</li>
            ) : null}
            {teamsWithoutTopic ? (
              <li>{t("camp.upload.rooms.noTopic", { count: teamsWithoutTopic })}</li>
            ) : null}
          </ul>
        </ToneBox>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={t("camp.upload.rooms.search")}
        />
        <FilterSelect
          label={t("camp.upload.rooms.col.kind")}
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({ value: k, label: t(KIND_KEY[k]) }))}
        />
        <FilterSelect
          label={t("camp.upload.rooms.completeness")}
          value={noTopic}
          onChange={setNoTopic}
          options={[{ value: "missing", label: t("camp.upload.rooms.incomplete") }]}
        />
        <div className="ms-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void exportRows()}>
            <Download className="me-1 h-4 w-4" />
            {t("camp.btn.exportExcel")}
          </Button>
          {edit ? (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="me-1 h-4 w-4" />
              {t("camp.upload.rooms.add")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("camp.upload.rooms.col.kind")}</TableHead>
              <TableHead>{t("camp.upload.rooms.col.number")}</TableHead>
              <TableHead>{t("camp.upload.rooms.col.label")}</TableHead>
              <TableHead>{t("camp.upload.rooms.col.topics")}</TableHead>
              <TableHead>{t("camp.upload.rooms.col.zone")}</TableHead>
              {edit ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">
                  <ToneBadge tone={r.kind === "main_hall" ? "info" : "muted"}>
                    {t(KIND_KEY[r.kind])}
                  </ToneBadge>
                </TableCell>
                <TableCell className="tabular-nums">{r.teamNo ?? r.committeeNo ?? "—"}</TableCell>
                <TableCell className="min-w-40" dir="auto">
                  {r.label}
                </TableCell>
                <TableCell className="min-w-56">
                  {r.topics.length ? (
                    <span className="flex flex-wrap gap-1">
                      {r.topics.map((topic) => (
                        <span
                          key={topic}
                          className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                          dir="auto"
                        >
                          {topic}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("camp.upload.rooms.noTopicYet")}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs" dir="ltr">
                  {r.zoneId || "—"}
                </TableCell>
                {edit ? (
                  <TableCell className="whitespace-nowrap text-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => setEditing(r)}
                      aria-label={t("camp.upload.rooms.edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={remove.isPending}
                      aria-label={t("camp.upload.rooms.delete")}
                      onClick={async () => {
                        const ok = await confirm({
                          title: t("camp.upload.rooms.deleteTitle"),
                          description: t("camp.upload.rooms.deleteBody", { label: r.label }),
                          confirmLabel: t("camp.upload.rooms.delete"),
                          cancelLabel: t("camp.btn.cancel"),
                          destructive: true,
                        });
                        if (ok) remove.mutate(r.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {rooms.length ? t("camp.common.noResults") : t("camp.upload.rooms.empty")}
          </p>
        ) : null}
      </div>

      {editing ? (
        <RoomDialog room={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
      {confirmDialog}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RoomDialog({ room, onClose }: { room: RoomRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidateCamp();
  const saveFn = useServerFn(saveCampRoom);
  const [kind, setKind] = useState<RoomKind>(room?.kind ?? "team");
  const [number, setNumber] = useState<string>(String(room?.teamNo ?? room?.committeeNo ?? ""));
  const [label, setLabel] = useState(room?.label ?? "");
  const [topics, setTopics] = useState(room?.topics.join("\n") ?? "");
  const [zoneId, setZoneId] = useState(room?.zoneId ?? "");
  const [submitted, setSubmitted] = useState(false);

  const needsNumber = kind === "team" || kind === "committee";
  const max = kind === "team" ? 999 : 99;
  const parsedNumber = /^\d+$/.test(number.trim()) ? Number(number.trim()) : null;
  const numberError =
    needsNumber && (parsedNumber === null || parsedNumber < 1 || parsedNumber > max);
  const topicList = splitList(topics);
  const topicsError = topicList.length > 20 || topicList.some((x) => x.length > 200);
  const labelError = !label.trim();

  const suggestedLabel = (k: RoomKind, n: number | null): string =>
    k === "main_hall" ? MAIN_HALL_AR : k === "team" && n ? TEAM_ROOM_AR(n) : "";

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          id: room?.id ?? null,
          kind,
          teamNo: kind === "team" ? parsedNumber : null,
          committeeNo: kind === "committee" ? parsedNumber : null,
          label: label.trim(),
          topics: topicList,
          zoneId: zoneId.trim() || null,
        },
      }),
    onSuccess: async () => {
      toast.success(t("camp.common.saved"));
      await invalidate();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {room ? t("camp.upload.rooms.edit") : t("camp.upload.rooms.add")}
          </DialogTitle>
          <DialogDescription>{t("camp.upload.rooms.dialogHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (numberError || labelError || topicsError) return;
            save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("camp.upload.rooms.col.kind")}</Label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  const next = v as RoomKind;
                  setKind(next);
                  if (!label.trim()) setLabel(suggestedLabel(next, parsedNumber));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(KIND_KEY[k])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsNumber ? (
              <div className="space-y-1.5">
                <Label htmlFor="camp-room-number">
                  {kind === "team"
                    ? t("camp.upload.rooms.teamNo")
                    : t("camp.upload.rooms.committeeNo")}
                </Label>
                <Input
                  id="camp-room-number"
                  inputMode="numeric"
                  dir="ltr"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  onBlur={() => {
                    if (!label.trim()) setLabel(suggestedLabel(kind, parsedNumber));
                  }}
                  aria-invalid={submitted && numberError}
                />
                {submitted && numberError ? (
                  <p className="text-xs text-[var(--destructive)]">
                    {t("camp.upload.rooms.numberError", { max })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-room-label">{t("camp.upload.rooms.col.label")}</Label>
            <Input
              id="camp-room-label"
              dir="auto"
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-invalid={submitted && labelError}
            />
            {submitted && labelError ? (
              <p className="text-xs text-[var(--destructive)]">
                {t("camp.upload.rooms.labelError")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-room-topics">{t("camp.upload.rooms.col.topics")}</Label>
            <Textarea
              id="camp-room-topics"
              dir="auto"
              rows={3}
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              aria-invalid={submitted && topicsError}
            />
            <p className="text-xs text-muted-foreground">{t("camp.upload.rooms.topicsHint")}</p>
            {topicList.length ? (
              <span className="flex flex-wrap gap-1">
                {topicList.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                    dir="auto"
                  >
                    {topic}
                  </span>
                ))}
              </span>
            ) : null}
            {submitted && topicsError ? (
              <p className="text-xs text-[var(--destructive)]">
                {t("camp.upload.rooms.topicsError")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-room-zone">{t("camp.upload.rooms.col.zone")}</Label>
            <Input
              id="camp-room-zone"
              dir="ltr"
              maxLength={120}
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">{t("camp.upload.rooms.zoneHint")}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("camp.btn.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : null}
              {t("camp.btn.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
