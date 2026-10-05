/**
 * التذكيرات المجدولة — the S00–S23 cues of §9 (FR-NOT-01..03, FR-NOT-07).
 *
 * Admins edit a cue's time, days, per-day on/off and text with a live
 * character count against the channel limit; anyone who can edit can send a
 * test to their own SoWork account. Per-day shifted times come from agenda
 * re-imports and are shown, never edited, here.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bell, Download, Hash, Loader2, Megaphone, MessageCircle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n/use-translation";
import { saveCampCue } from "@/lib/camp-admin.functions";
import { CHANNEL_LIMITS, renderTemplate } from "@/lib/camp/cues";
import { addDays, formatDateAr, formatHHMMAr, formatTimeAr } from "@/lib/camp/text";
import type { CueRow } from "@/lib/camp/types";
import { cn } from "@/lib/utils";
import { downloadWorkbook } from "../../export-xlsx";
import {
  errorMessage,
  ToneBadge,
  toneColor,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
} from "../../camp-ui";
import { CharCount, FieldChips, FieldText, TestSendButton, TextProblems } from "./shared";
import {
  CHANNEL_AR,
  CHANNEL_KEY,
  campDayToday,
  textBlocked,
  textLength,
  useAgenda,
  useCompactDays,
  useTextareaRef,
  type CueChannel,
  type Messaging,
} from "./lib";

/** The server caps every text at 4,000; popups and bubbles are tighter (FR-NOT-02). */
const cueLimit = (channel: CueChannel) => Math.min(CHANNEL_LIMITS[channel], 4000);

/** Fields the scheduler fills for a cue; the NPC bubble is posted as written. */
const cueFields = (channel: CueChannel): string[] =>
  channel === "npc" ? [] : ["التاريخ", "الفقرات وأوقاتها"];

const CHANNEL_ICON = {
  channel: Hash,
  gong: Bell,
  announcement: Megaphone,
  npc: MessageCircle,
} as const;

type CuePatch = Pick<
  CueRow,
  "key" | "timeOfDay" | "endTime" | "days" | "disabledDays" | "dayTimes" | "text" | "enabled"
>;

function useSaveCue() {
  const { t } = useTranslation();
  const invalidate = useInvalidateCamp();
  const fn = useServerFn(saveCampCue);
  return useMutation({
    mutationFn: (cue: CuePatch) =>
      fn({
        data: {
          key: cue.key,
          timeOfDay: cue.timeOfDay,
          endTime: cue.endTime,
          days: cue.days,
          disabledDays: cue.disabledDays,
          dayTimes: cue.dayTimes,
          text: cue.text,
          enabled: cue.enabled,
        },
      }),
    onSuccess: async () => {
      toast.success(t("camp.common.saved"));
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function CuesTab({ messaging }: { messaging: Messaging }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { admin } = useCampAbilities();
  const compactDays = useCompactDays();
  const save = useSaveCue();
  const [editing, setEditing] = useState<CueRow | null>(null);
  const cues = messaging.cues;

  const timeLabel = (c: CueRow) =>
    c.endTime
      ? t("camp.cue.range", { from: fmt.hhmm(c.timeOfDay), to: fmt.hhmm(c.endTime) })
      : fmt.hhmm(c.timeOfDay);

  const exportCues = () =>
    downloadWorkbook("التذكيرات المجدولة", [
      {
        name: "التذكيرات المجدولة",
        headers: ["البند", "الوقت", "الأيام", "الأيام الموقوفة", "القناة", "النص", "الحالة"],
        rows: cues.map((c) => [
          c.key,
          c.endTime
            ? `${formatHHMMAr(c.timeOfDay)} إلى ${formatHHMMAr(c.endTime)}`
            : formatHHMMAr(c.timeOfDay),
          c.days.join("، "),
          c.disabledDays.join("، "),
          CHANNEL_AR[c.channel],
          c.text,
          c.enabled ? "مفعّل" : "متوقف",
        ]),
      },
    ]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => void exportCues()}>
          <Download className="me-1 h-4 w-4" />
          {t("camp.btn.exportExcel")}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("camp.cue.col.key")}</TableHead>
              <TableHead>{t("camp.common.time")}</TableHead>
              <TableHead>{t("camp.notif.log.col.channel")}</TableHead>
              <TableHead>{t("camp.cue.col.days")}</TableHead>
              <TableHead>{t("camp.cue.col.text")}</TableHead>
              <TableHead>{t("camp.cue.col.enabled")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {cues.map((c) => {
              const Icon = CHANNEL_ICON[c.channel];
              const limit = cueLimit(c.channel);
              const shifted = Object.keys(c.dayTimes).length;
              const offDays = c.disabledDays.filter((d) => c.days.includes(d));
              return (
                <TableRow key={c.key} className={c.enabled ? undefined : "opacity-60"}>
                  <TableCell className="font-medium tabular-nums" dir="ltr">
                    {c.key}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {timeLabel(c)}
                    {shifted ? (
                      <p className="text-xs" style={{ color: toneColor("info") }}>
                        {t("camp.notif.shiftedDays", { count: shifted })}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      {t(CHANNEL_KEY[c.channel])}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-28 text-sm">
                    {c.days.length ? compactDays(c.days) : t("camp.cue.noDays")}
                    {offDays.length ? (
                      <p className="text-xs" style={{ color: toneColor("warn") }}>
                        {t("camp.cue.offOn", { days: compactDays(offDays) })}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="min-w-64 max-w-md">
                    <p dir="auto" className="line-clamp-2 text-sm" title={c.text}>
                      {c.text}
                    </p>
                    {c.channel !== "channel" ? (
                      <CharCount count={textLength(c.text)} limit={limit} />
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {admin ? (
                      <Switch
                        checked={c.enabled}
                        disabled={save.isPending}
                        onCheckedChange={(enabled) => save.mutate({ ...c, enabled })}
                        aria-label={`${c.key} · ${t("camp.cue.enabledLabel")}`}
                      />
                    ) : (
                      <ToneBadge tone={c.enabled ? "good" : "muted"}>
                        {c.enabled ? t("camp.notif.on") : t("camp.notif.off")}
                      </ToneBadge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-end">
                    <TestSendButton text={c.text} myAccount={messaging.myAccount} compact />
                    {admin ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => setEditing(c)}
                      >
                        <Pencil className="me-1 h-3.5 w-3.5" />
                        {t("camp.notif.edit")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!cues.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("camp.common.noResults")}
          </p>
        ) : null}
      </div>
      {editing ? (
        <CueDialog
          key={editing.key}
          cue={editing}
          messaging={messaging}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CueDialog({
  cue,
  messaging,
  onClose,
}: {
  cue: CueRow;
  messaging: Messaging;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const save = useSaveCue();
  const agenda = useAgenda();
  const textareaRef = useTextareaRef();
  const [time, setTime] = useState(cue.timeOfDay);
  const [endTime, setEndTime] = useState(cue.endTime ?? "");
  const [days, setDays] = useState<Set<number>>(() => new Set(cue.days));
  const [off, setOff] = useState<Set<number>>(() => new Set(cue.disabledDays));
  const [text, setText] = useState(cue.text);
  const [enabled, setEnabled] = useState(cue.enabled);

  const limit = cueLimit(cue.channel);
  const fields = cueFields(cue.channel);
  const dayNumbers = Array.from({ length: messaging.dayCount }, (_, i) => i + 1);
  const validTime = /^\d{2}:\d{2}$/.test(time);
  const validEnd = !endTime || /^\d{2}:\d{2}$/.test(endTime);
  const blocked = textBlocked(text, limit, fields) || !validTime || !validEnd;

  // Preview on today's camp day when the cue runs today, else its first running day.
  const previewDay = useMemo(() => {
    const running = [...days].filter((d) => !off.has(d)).sort((a, b) => a - b);
    const today = campDayToday(messaging.startDate, messaging.dayCount);
    return today && running.includes(today) ? today : (running[0] ?? null);
  }, [days, off, messaging.startDate, messaging.dayCount]);
  const preview = useMemo(() => {
    if (!fields.length || previewDay === null) return text;
    const date =
      agenda.data?.days.find((d) => d.dayNo === previewDay)?.date ??
      addDays(messaging.startDate, previewDay - 1);
    // Mirrors the scheduler's {الفقرات وأوقاتها}: counted items with their times.
    const line = (agenda.data?.sessions ?? [])
      .filter((s) => s.dayNo === previewDay && s.counted)
      .map((s) => `${s.title} ${formatTimeAr(s.start)}`)
      .join("، ");
    return renderTemplate(text, { التاريخ: formatDateAr(date), "الفقرات وأوقاتها": line });
  }, [text, fields.length, previewDay, agenda.data, messaging.startDate]);

  const toggleDay = (d: number, on: boolean) =>
    setDays((prev) => {
      const next = new Set(prev);
      if (on) next.add(d);
      else next.delete(d);
      return next;
    });
  const toggleOff = (d: number, sends: boolean) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (sends) next.delete(d);
      else next.add(d);
      return next;
    });

  const Icon = CHANNEL_ICON[cue.channel];
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("camp.cue.editTitle", { key: cue.key })}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {t(CHANNEL_KEY[cue.channel])}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="cue-time">{t("camp.common.time")}</Label>
              <Input
                id="cue-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value.slice(0, 5))}
                className="w-36"
                dir="ltr"
                aria-invalid={!validTime}
              />
              {validTime ? <p className="text-xs text-muted-foreground">{fmt.hhmm(time)}</p> : null}
            </div>
            {cue.channel === "npc" ? (
              <div className="space-y-1.5">
                <Label htmlFor="cue-end">{t("camp.cue.endTime")}</Label>
                <Input
                  id="cue-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value.slice(0, 5))}
                  className="w-36"
                  dir="ltr"
                  aria-invalid={!validEnd}
                />
                {endTime && validEnd ? (
                  <p className="text-xs text-muted-foreground">{fmt.hhmm(endTime)}</p>
                ) : null}
              </div>
            ) : null}
            <label className="flex items-center gap-2 pb-1 text-sm">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              {t("camp.cue.enabledLabel")}
            </label>
          </div>
          {cue.channel === "npc" ? (
            <p className="text-xs text-muted-foreground">{t("camp.cue.npcHint")}</p>
          ) : null}

          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">{t("camp.cue.col.days")}</p>
              <p className="text-xs text-muted-foreground">{t("camp.cue.daysHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {dayNumbers.map((d) => {
                const included = days.has(d);
                const sends = included && !off.has(d);
                const shifted = cue.dayTimes[String(d)];
                return (
                  <div
                    key={d}
                    className={cn(
                      "space-y-1.5 rounded-md border p-2",
                      included ? "bg-card" : "bg-muted/30",
                    )}
                  >
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={included}
                        onCheckedChange={(v) => toggleDay(d, v === true)}
                      />
                      {t("camp.common.dayN", { n: d })}
                    </label>
                    {included ? (
                      <label className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
                        {sends ? t("camp.notif.on") : t("camp.notif.off")}
                        <Switch
                          checked={sends}
                          onCheckedChange={(v) => toggleOff(d, v)}
                          aria-label={t("camp.cue.dayOn", { n: d })}
                        />
                      </label>
                    ) : null}
                    {shifted ? (
                      <p className="text-xs tabular-nums" style={{ color: toneColor("info") }}>
                        {fmt.hhmm(shifted)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {Object.keys(cue.dayTimes).length ? (
              <p className="text-xs text-muted-foreground">{t("camp.notif.dayTimesNote")}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="cue-text">{t("camp.notif.text")}</Label>
              <CharCount count={textLength(text)} limit={limit} />
            </div>
            <Textarea
              id="cue-text"
              ref={textareaRef}
              dir="auto"
              rows={cue.channel === "channel" ? 4 : 2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={textBlocked(text, limit, fields)}
            />
            <TextProblems text={text} limit={limit} allowed={fields} />
            <FieldChips fields={fields} textareaRef={textareaRef} value={text} onChange={setText} />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              {previewDay !== null && fields.length
                ? t("camp.cue.previewDay", { n: previewDay })
                : t("camp.notif.preview")}
            </p>
            <div
              className={cn(
                "flex items-start gap-2 border p-3",
                cue.channel === "npc" ? "max-w-xs rounded-2xl rounded-ss-sm" : "rounded-md",
              )}
              style={{
                backgroundColor: `color-mix(in oklab, ${toneColor("info")} 8%, transparent)`,
              }}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <FieldText text={preview || "—"} />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <TestSendButton
            text={preview}
            myAccount={messaging.myAccount}
            disabled={textBlocked(text, limit, fields)}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("camp.btn.cancel")}
            </Button>
            <Button
              disabled={blocked || save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    key: cue.key,
                    timeOfDay: time,
                    endTime: cue.channel === "npc" ? endTime || null : cue.endTime,
                    days: [...days].sort((a, b) => a - b),
                    disabledDays: [...off].filter((d) => days.has(d)).sort((a, b) => a - b),
                    // FR-NOT-07: shifted times belong to the agenda import.
                    dayTimes: cue.dayTimes,
                    text: text.trim(),
                    enabled,
                  },
                  { onSuccess: onClose },
                )
              }
            >
              {save.isPending ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : null}
              {t("camp.btn.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
