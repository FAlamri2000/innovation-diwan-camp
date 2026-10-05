/**
 * Camp operations — التسجيلات (Module 5: recordings linked to meetings).
 *
 *   الاجتماعات      every meeting of the day with its library item, recording
 *                   and notes (FR-REC-02..05)
 *   تحتاج مراجعة    uncertain links to settle (FR-REC-07), and meetings with no
 *                   library item or no recording (FR-REC-06)
 *
 * The video link is never kept on the page: RecordingButton asks the server for
 * a fresh signed link on each click (FR-REC-03). Exports carry the deepLink only.
 */
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Download, FileText, Link2, Loader2, Video, VideoOff } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/use-confirm";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { getCampAgenda, listCampMeetings } from "@/lib/camp-read.functions";
import {
  chooseCampLibraryItem,
  getCampMeetingNotes,
  listCampLibraryOptions,
} from "@/lib/camp-actions.functions";
import { formatDateAr, formatTimeAr, riyadhDate } from "@/lib/camp/text";
import type { DayRow, MeetingRow } from "@/lib/camp/types";
import { downloadWorkbook, type ExportCell } from "../export-xlsx";
import {
  campKey,
  errorMessage,
  FilterSelect,
  PageTitle,
  RecordingButton,
  SearchBox,
  ToneBadge,
  matchesSearch,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
  type Tone,
} from "../camp-ui";

type LibraryStatus = MeetingRow["library"]["status"];
type Candidate = MeetingRow["library"]["candidates"][number];

const LIBRARY_STATUSES: LibraryStatus[] = ["linked", "manual", "uncertain", "pending", "none"];

const LIBRARY_KEY: Record<LibraryStatus, MessageKey> = {
  pending: "camp.recordings.lib.pending",
  linked: "camp.recordings.lib.linked",
  manual: "camp.recordings.lib.manual",
  uncertain: "camp.recordings.lib.uncertain",
  none: "camp.recordings.lib.none",
};

const LIBRARY_TONE: Record<LibraryStatus, Tone> = {
  pending: "muted",
  linked: "good",
  manual: "info",
  uncertain: "warn",
  none: "bad",
};

/** Exports are Arabic whatever the interface language (§10). */
const LIBRARY_AR: Record<LibraryStatus, string> = {
  pending: "قيد البحث",
  linked: "مرتبط",
  manual: "اختيار يدوي",
  uncertain: "غير مؤكد",
  none: "لا يوجد عنصر في المكتبة",
};

/** FR-REC: two-person side chats are noise in a recordings list. */
const DEFAULT_MIN_PARTICIPANTS = 3;
/** listCampMeetings returns at most this many rows. */
const SERVER_CAP = 800;

const topicOf = (m: MeetingRow) => m.topic?.trim() || m.library.topic?.trim() || null;

/** Today's camp day, else the last one that has started, else the first. */
function defaultDay(days: readonly DayRow[]): string {
  if (!days.length) return "all";
  const today = riyadhDate(Date.now());
  const exact = days.find((d) => d.date === today);
  if (exact) return String(exact.dayNo);
  const started = days.filter((d) => d.date <= today);
  return String((started[started.length - 1] ?? days[0]!).dayNo);
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const arDateTime = (ms: number | null) =>
  ms === null ? "" : `${formatDateAr(riyadhDate(ms))} ${formatTimeAr(ms)}`;

function exportMeetings(rows: readonly MeetingRow[], sheet: string, withStatus: boolean) {
  const headers = [
    "الاجتماع",
    "الغرفة",
    "الفقرة",
    "البداية",
    "النهاية",
    "المشاركون",
    ...(withStatus ? ["عنصر المكتبة"] : []),
    "رابط التسجيل",
  ];
  return downloadWorkbook("التسجيلات", [
    {
      name: sheet,
      headers,
      rows: rows.map((m): ExportCell[] => [
        topicOf(m),
        m.roomLabel,
        m.sessionTitle,
        arDateTime(m.startedAt),
        arDateTime(m.endedAt),
        m.participants,
        ...(withStatus ? [LIBRARY_AR[m.library.status]] : []),
        // §10: the SoWork deepLink, never the 24-hour video link.
        m.library.deepLink ? { text: m.library.deepLink, hyperlink: m.library.deepLink } : "",
      ]),
    },
  ]);
}

// ---------------------------------------------------------------------------

export function RecordingsView() {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const agendaFn = useServerFn(getCampAgenda);
  const meetingsFn = useServerFn(listCampMeetings);
  const agenda = useQuery({
    queryKey: campKey("agenda"),
    queryFn: () => agendaFn(),
    staleTime: 300_000,
  });
  const days = useMemo(() => agenda.data?.days ?? [], [agenda.data]);

  const [dayChoice, setDayChoice] = useState<string | null>(null);
  const dayValue = dayChoice ?? defaultDay(days);
  const dayNo = dayValue === "all" ? null : Number(dayValue);
  const [minText, setMinText] = useState(String(DEFAULT_MIN_PARTICIPANTS));
  const minParsed = Number.parseInt(minText, 10);
  const minParticipants = useDebounced(
    Number.isFinite(minParsed) ? Math.min(1000, Math.max(0, minParsed)) : 0,
    350,
  );
  const [search, setSearch] = useState("");
  const [countedOnly, setCountedOnly] = useState(false);

  const meetings = useQuery({
    queryKey: campKey("meetings", dayNo, minParticipants),
    queryFn: () => meetingsFn({ data: { dayNo, minParticipants } }),
    // Wait for the agenda so the first fetch is today's day, not every day.
    enabled: !agenda.isPending,
    placeholderData: keepPreviousData,
    refetchInterval: 120_000,
  });

  const rows = useMemo(
    () =>
      (meetings.data ?? [])
        .filter((m) => !countedOnly || !!m.sessionTitle)
        .filter((m) => matchesSearch(search, [m.topic, m.library.topic])),
    [meetings.data, countedOnly, search],
  );
  const review = useMemo(
    () => ({
      uncertain: rows.filter((m) => m.library.status === "uncertain"),
      none: rows.filter((m) => m.library.status === "none" && m.status === "ended"),
      noRecording: rows.filter(
        (m) =>
          (m.library.status === "linked" || m.library.status === "manual") &&
          m.library.hasRecording === false,
      ),
    }),
    [rows],
  );
  const reviewCount = review.uncertain.length + review.none.length + review.noRecording.length;

  return (
    <div>
      <PageTitle title={t("camp.nav.recordings")} description={t("camp.recordings.description")} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={dayValue} onValueChange={setDayChoice}>
          <SelectTrigger className="h-9 w-auto min-w-44" aria-label={t("camp.common.day")}>
            <span className="me-1 text-muted-foreground">{t("camp.common.day")}:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("camp.recordings.allDays")}</SelectItem>
            {days.map((d) => (
              <SelectItem key={d.dayNo} value={String(d.dayNo)}>
                {t("camp.recordings.dayOption", { n: d.dayNo, date: fmt.date(d.date) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={t("camp.recordings.searchTopic")}
        />
        <label
          className="flex items-center gap-2 text-sm"
          title={t("camp.recordings.minHint")}
          htmlFor="camp-rec-min"
        >
          <span className="text-muted-foreground">{t("camp.recordings.minParticipants")}</span>
          <Input
            id="camp-rec-min"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            value={minText}
            onChange={(e) => setMinText(e.target.value)}
            className="h-9 w-20 tabular-nums"
            dir="ltr"
            aria-describedby="camp-rec-min-hint"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={countedOnly} onCheckedChange={(v) => setCountedOnly(v === true)} />
          {t("camp.recordings.countedOnly")}
        </label>
        {meetings.isFetching && !meetings.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>
      <p id="camp-rec-min-hint" className="sr-only">
        {t("camp.recordings.minHint")}
      </p>

      <QueryState
        isPending={agenda.isPending || meetings.isPending}
        isError={meetings.isError}
        error={meetings.error}
        onRetry={() => void meetings.refetch()}
        skeletonRows={8}
      >
        {meetings.data ? (
          <Tabs defaultValue="all">
            <TabsList className="mb-4 h-auto flex-wrap justify-start">
              <TabsTrigger value="all">
                {t("camp.recordings.tabAll")} ({rows.length})
              </TabsTrigger>
              <TabsTrigger value="review">
                {t("camp.recordings.tabReview")} ({reviewCount})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="all">
              <MeetingsTab
                rows={rows}
                total={meetings.data.length}
                capped={meetings.data.length >= SERVER_CAP}
                showDate={dayNo === null}
              />
            </TabsContent>
            <TabsContent value="review">
              <ReviewTab review={review} showDate={dayNo === null} />
            </TabsContent>
          </Tabs>
        ) : null}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function LibraryBadge({ status }: { status: LibraryStatus }) {
  const { t } = useTranslation();
  return <ToneBadge tone={LIBRARY_TONE[status]}>{t(LIBRARY_KEY[status])}</ToneBadge>;
}

function MeetingTime({ m, showDate }: { m: MeetingRow; showDate: boolean }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  return (
    <div className="whitespace-nowrap">
      {showDate ? <p className="text-xs text-muted-foreground">{fmt.date(m.startedAt)}</p> : null}
      {m.status === "active" ? (
        <span className="inline-flex items-center gap-1.5">
          {fmt.time(m.startedAt)}
          <ToneBadge tone="info">{t("camp.recordings.live")}</ToneBadge>
        </span>
      ) : (
        t("camp.cue.range", { from: fmt.time(m.startedAt), to: fmt.time(m.endedAt) })
      )}
    </div>
  );
}

function MeetingTopic({ m }: { m: MeetingRow }) {
  const { t } = useTranslation();
  const own = m.topic?.trim();
  const fromLibrary = !own && m.library.topic?.trim();
  return (
    <div className="min-w-44 max-w-72">
      <p dir="auto" className="truncate" title={topicOf(m) ?? undefined}>
        {topicOf(m) ?? (
          <span className="text-muted-foreground">{t("camp.recordings.noTopic")}</span>
        )}
      </p>
      {fromLibrary ? (
        <p className="text-xs text-muted-foreground">{t("camp.recordings.topicFromLibrary")}</p>
      ) : null}
    </div>
  );
}

/** Recording cell: the view button (fresh signed link on click) and duration. */
function RecordingCell({ m }: { m: MeetingRow }) {
  const fmt = useCampFormat();
  const seconds = m.library.durationSeconds;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <RecordingButton
        meetingId={m.meetingId}
        deepLink={m.library.deepLink}
        hasRecording={m.library.hasRecording}
        compact={!m.library.hasRecording}
      />
      {m.library.hasRecording && seconds ? (
        <span className="text-xs tabular-nums text-muted-foreground">
          {fmt.minutes(Math.max(1, Math.round(seconds / 60)))}
        </span>
      ) : null}
    </span>
  );
}

/** FR-REC-07 choose / "no recording", shared by the dialog and the review cards. */
function useChooseLibrary() {
  const { t } = useTranslation();
  const invalidate = useInvalidateCamp();
  const fn = useServerFn(chooseCampLibraryItem);
  const { confirm, confirmDialog } = useConfirm();
  const mutation = useMutation({
    mutationFn: (v: { meetingId: string; itemId: string | null }) => fn({ data: v }),
    onSuccess: async (_res, v) => {
      toast.success(v.itemId ? t("camp.recordings.chosen") : t("camp.recordings.markedNone"));
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const choose = (meetingId: string, itemId: string) => mutation.mutateAsync({ meetingId, itemId });
  const markNone = async (meetingId: string) => {
    const ok = await confirm({
      title: t("camp.recordings.confirmNone"),
      description: t("camp.recordings.confirmNoneBody"),
      confirmLabel: t("camp.recordings.noRecording"),
      cancelLabel: t("camp.btn.cancel"),
    });
    if (!ok) return false;
    await mutation.mutateAsync({ meetingId, itemId: null });
    return true;
  };
  return {
    choose,
    markNone,
    pendingFor: mutation.isPending ? mutation.variables : undefined,
    confirmDialog,
  };
}

function CandidatesTable({
  meeting,
  onChoose,
  busyItem,
}: {
  meeting: MeetingRow;
  onChoose?: (itemId: string) => void;
  busyItem?: string | null;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("camp.recordings.cand.item")}</TableHead>
            <TableHead>{t("camp.recordings.cand.overlap")}</TableHead>
            <TableHead>{t("camp.recordings.cand.delta")}</TableHead>
            <TableHead>{t("camp.recordings.cand.topic")}</TableHead>
            <TableHead>{t("camp.recordings.cand.score")}</TableHead>
            {onChoose ? <TableHead /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {meeting.library.candidates.map((c: Candidate) => {
            const current = meeting.library.itemId === c.itemId;
            return (
              <TableRow key={c.itemId} data-state={current ? "selected" : undefined}>
                <TableCell>
                  <p className="text-sm" dir="auto">
                    {c.topic ?? t("camp.recordings.noTopic")}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {c.startedAt ? `${fmt.time(c.startedAt)} · ` : ""}
                    {c.itemId}
                  </p>
                </TableCell>
                <TableCell className="tabular-nums">{Math.round(c.overlap * 100)}%</TableCell>
                <TableCell className="tabular-nums">
                  {t("camp.recordings.cand.seconds", { n: c.deltaSeconds })}
                </TableCell>
                <TableCell>
                  <ToneBadge tone={c.topicMatch ? "good" : "muted"}>
                    {c.topicMatch
                      ? t("camp.recordings.cand.topicSame")
                      : t("camp.recordings.cand.topicDiff")}
                  </ToneBadge>
                </TableCell>
                <TableCell className="tabular-nums">{Math.round(c.score * 100)}</TableCell>
                {onChoose ? (
                  <TableCell className="text-end">
                    {current ? (
                      <ToneBadge tone="good">
                        <Check className="me-1 h-3 w-3" aria-hidden />
                        {t("camp.recordings.lib.linked")}
                      </ToneBadge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={!!busyItem}
                        onClick={() => onChoose(c.itemId)}
                      >
                        {busyItem === c.itemId ? (
                          <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Link2 className="me-1 h-3.5 w-3.5" />
                        )}
                        {t("camp.recordings.useItem")}
                      </Button>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الاجتماعات
// ---------------------------------------------------------------------------

function MeetingsTab({
  rows: all,
  total,
  capped,
  showDate,
}: {
  rows: MeetingRow[];
  total: number;
  capped: boolean;
  showDate: boolean;
}) {
  const { t } = useTranslation();
  const { edit } = useCampAbilities();
  const [library, setLibrary] = useState<LibraryStatus | "all">("all");
  const [notesFor, setNotesFor] = useState<MeetingRow | null>(null);
  const [chooseFor, setChooseFor] = useState<MeetingRow | null>(null);
  const rows = all.filter((m) => library === "all" || m.library.status === library);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterSelect
          label={t("camp.recordings.library")}
          value={library}
          onChange={setLibrary}
          options={LIBRARY_STATUSES.map((s) => ({ value: s, label: t(LIBRARY_KEY[s]) }))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("camp.users.showing", { shown: rows.length, total })}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportMeetings(rows, "التسجيلات", false)}
          >
            <Download className="me-1 h-4 w-4" />
            {t("camp.btn.exportExcel")}
          </Button>
        </div>
      </div>
      {capped ? (
        <p className="rounded-md border bg-muted/30 p-3 text-sm">{t("camp.recordings.capped")}</p>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("camp.common.time")}</TableHead>
              <TableHead>{t("camp.recordings.col.meeting")}</TableHead>
              <TableHead>{t("camp.recordings.col.participants")}</TableHead>
              <TableHead>{t("camp.common.room")}</TableHead>
              <TableHead>{t("camp.common.session")}</TableHead>
              <TableHead>{t("camp.recordings.library")}</TableHead>
              <TableHead>{t("camp.recordings.col.recording")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.meetingId}>
                <TableCell>
                  <MeetingTime m={m} showDate={showDate} />
                </TableCell>
                <TableCell>
                  <MeetingTopic m={m} />
                </TableCell>
                <TableCell className="tabular-nums">{m.participants}</TableCell>
                <TableCell className="max-w-44 truncate" dir="auto">
                  {m.roomLabel ?? "—"}
                </TableCell>
                <TableCell className="max-w-56 truncate" dir="auto" title={m.sessionTitle ?? ""}>
                  {m.sessionTitle ?? "—"}
                </TableCell>
                <TableCell>
                  <LibraryBadge status={m.library.status} />
                </TableCell>
                <TableCell>
                  <RecordingCell m={m} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-end">
                  {m.library.itemId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => setNotesFor(m)}
                    >
                      <FileText className="me-1 h-3.5 w-3.5" />
                      {t("camp.recordings.notes")}
                    </Button>
                  ) : null}
                  {edit && m.library.candidates.length > 0 ? (
                    <Button
                      size="sm"
                      variant={m.library.status === "uncertain" ? "outline" : "ghost"}
                      className="h-7 px-2"
                      onClick={() => setChooseFor(m)}
                    >
                      <Link2 className="me-1 h-3.5 w-3.5" />
                      {t("camp.recordings.choose")}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("camp.common.noResults")}
          </p>
        ) : null}
      </div>

      <NotesDialog meeting={notesFor} onClose={() => setNotesFor(null)} />
      <ChooseDialog meeting={chooseFor} onClose={() => setChooseFor(null)} />
    </div>
  );
}

function ChooseDialog({ meeting, onClose }: { meeting: MeetingRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { choose, markNone, pendingFor, confirmDialog } = useChooseLibrary();
  return (
    <>
      <Dialog open={!!meeting} onOpenChange={(open) => (open ? null : onClose())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("camp.recordings.chooseTitle")}</DialogTitle>
            <DialogDescription dir="auto">
              {meeting ? (topicOf(meeting) ?? t("camp.recordings.noTopic")) : null}
            </DialogDescription>
          </DialogHeader>
          {meeting ? (
            <>
              <MeetingFacts m={meeting} />
              <CandidatesTable
                meeting={meeting}
                busyItem={pendingFor?.meetingId === meeting.meetingId ? pendingFor.itemId : null}
                onChoose={(itemId) =>
                  void choose(meeting.meetingId, itemId).then(onClose, () => undefined)
                }
              />
            </>
          ) : null}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("camp.btn.cancel")}
            </Button>
            {meeting ? (
              <Button
                variant="outline"
                disabled={!!pendingFor}
                onClick={() =>
                  void markNone(meeting.meetingId).then(
                    (done) => (done ? onClose() : undefined),
                    () => undefined,
                  )
                }
              >
                <VideoOff className="me-1 h-4 w-4" />
                {t("camp.recordings.noRecording")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}

/** One line of context for a meeting: time, room, session, participants. */
function MeetingFacts({ m }: { m: MeetingRow }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>{fmt.date(m.startedAt)}</span>
      <MeetingTime m={m} showDate={false} />
      {m.roomLabel ? <span dir="auto">{m.roomLabel}</span> : null}
      {m.sessionTitle ? <span dir="auto">{m.sessionTitle}</span> : null}
      <span>
        {t("camp.recordings.col.participants")}: {m.participants}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// تحتاج مراجعة (FR-REC-06, FR-REC-07)
// ---------------------------------------------------------------------------

function ReviewTab({
  review,
  showDate,
}: {
  review: { uncertain: MeetingRow[]; none: MeetingRow[]; noRecording: MeetingRow[] };
  showDate: boolean;
}) {
  const { t } = useTranslation();
  const { edit } = useCampAbilities();
  const { choose, markNone, pendingFor, confirmDialog } = useChooseLibrary();
  const [browseFor, setBrowseFor] = useState<MeetingRow | null>(null);
  const all = [...review.uncertain, ...review.none, ...review.noRecording];

  if (!all.length) {
    return (
      <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        {t("camp.recordings.review.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void exportMeetings(all, "تحتاج مراجعة", true)}
        >
          <Download className="me-1 h-4 w-4" />
          {t("camp.btn.exportExcel")}
        </Button>
      </div>

      {review.uncertain.length ? (
        <section className="space-y-3">
          <ReviewHeading
            title={t("camp.recordings.review.uncertain")}
            hint={t("camp.recordings.review.uncertainHint")}
            count={review.uncertain.length}
          />
          {review.uncertain.map((m) => (
            <div key={m.meetingId} className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium" dir="auto">
                    {topicOf(m) ?? t("camp.recordings.noTopic")}
                  </p>
                  <MeetingFacts m={m} />
                </div>
                {edit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!pendingFor}
                    onClick={() => void markNone(m.meetingId).catch(() => undefined)}
                  >
                    <VideoOff className="me-1 h-4 w-4" />
                    {t("camp.recordings.noRecording")}
                  </Button>
                ) : null}
              </div>
              <CandidatesTable
                meeting={m}
                busyItem={pendingFor?.meetingId === m.meetingId ? pendingFor.itemId : null}
                onChoose={
                  edit
                    ? (itemId) => void choose(m.meetingId, itemId).catch(() => undefined)
                    : undefined
                }
              />
            </div>
          ))}
        </section>
      ) : null}

      {review.none.length ? (
        <section className="space-y-3">
          <ReviewHeading
            title={t("camp.recordings.review.none")}
            hint={t("camp.recordings.review.noneHint")}
            count={review.none.length}
          />
          <ReviewTable
            rows={review.none}
            showDate={showDate}
            onBrowse={edit ? setBrowseFor : undefined}
          />
        </section>
      ) : null}

      {review.noRecording.length ? (
        <section className="space-y-3">
          <ReviewHeading
            title={t("camp.recordings.review.noRecording")}
            hint={t("camp.recordings.review.noRecordingHint")}
            count={review.noRecording.length}
          />
          <ReviewTable rows={review.noRecording} showDate={showDate} />
        </section>
      ) : null}
      {confirmDialog}
      <LibraryBrowseDialog meeting={browseFor} onClose={() => setBrowseFor(null)} />
    </div>
  );
}

/** FR-REC-07 by hand: library items around a meeting, live from SoWork. */
function LibraryBrowseDialog({
  meeting,
  onClose,
}: {
  meeting: MeetingRow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const fn = useServerFn(listCampLibraryOptions);
  const { choose, pendingFor } = useChooseLibrary();
  const options = useQuery({
    queryKey: campKey("libraryOptions", meeting?.meetingId),
    queryFn: () => fn({ data: { meetingId: meeting!.meetingId } }),
    enabled: !!meeting,
  });
  return (
    <Dialog open={!!meeting} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("camp.recordings.browseTitle")}</DialogTitle>
          <DialogDescription>{t("camp.recordings.browseHint")}</DialogDescription>
        </DialogHeader>
        {meeting ? <MeetingFacts m={meeting} /> : null}
        <QueryState
          isPending={options.isPending}
          isError={options.isError}
          error={options.error}
          onRetry={() => void options.refetch()}
          isEmpty={!options.data?.length}
          emptyTitle={t("camp.recordings.noOptions")}
        >
          <ul className="divide-y rounded-md border">
            {(options.data ?? []).map((o) => (
              <li
                key={o.itemId}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p dir="auto">{o.topic ?? t("camp.recordings.noTopic")}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmt.time(o.startedAt)}
                    {o.endedAt ? ` – ${fmt.time(o.endedAt)}` : ""} ·{" "}
                    {t("camp.recordings.shared", { shared: o.shared, total: o.participants })}
                    {o.takenBy ? ` · ${t("camp.recordings.takenBy")}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!pendingFor || !!o.takenBy}
                  onClick={() =>
                    meeting &&
                    void choose(meeting.meetingId, o.itemId).then(onClose, () => undefined)
                  }
                >
                  <Link2 className="me-1 h-3.5 w-3.5" />
                  {t("camp.recordings.chooseThis")}
                </Button>
              </li>
            ))}
          </ul>
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

function ReviewHeading({ title, hint, count }: { title: string; hint: string; count: number }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Video className="h-4 w-4 text-muted-foreground" aria-hidden />
        {title} ({count})
      </h3>
      <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function ReviewTable({
  rows,
  showDate,
  onBrowse,
}: {
  rows: MeetingRow[];
  showDate: boolean;
  onBrowse?: (m: MeetingRow) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("camp.common.time")}</TableHead>
            <TableHead>{t("camp.recordings.col.meeting")}</TableHead>
            <TableHead>{t("camp.recordings.col.participants")}</TableHead>
            <TableHead>{t("camp.common.room")}</TableHead>
            <TableHead>{t("camp.common.session")}</TableHead>
            <TableHead>{t("camp.recordings.col.recording")}</TableHead>
            {onBrowse ? <TableHead /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((m) => (
            <TableRow key={m.meetingId}>
              <TableCell>
                <MeetingTime m={m} showDate={showDate} />
              </TableCell>
              <TableCell>
                <MeetingTopic m={m} />
              </TableCell>
              <TableCell className="tabular-nums">{m.participants}</TableCell>
              <TableCell className="max-w-44 truncate" dir="auto">
                {m.roomLabel ?? "—"}
              </TableCell>
              <TableCell className="max-w-56 truncate" dir="auto">
                {m.sessionTitle ?? "—"}
              </TableCell>
              <TableCell>
                <RecordingCell m={m} />
              </TableCell>
              {onBrowse ? (
                <TableCell className="text-end">
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => onBrowse(m)}>
                    {t("camp.recordings.browse")}
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes on demand (FR-REC-05)
// ---------------------------------------------------------------------------

type NotesInclude = "notes" | "transcript" | "chat";

function NotesDialog({ meeting, onClose }: { meeting: MeetingRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<NotesInclude>("notes");
  return (
    <Dialog
      open={!!meeting}
      onOpenChange={(open) => {
        if (!open) {
          setTab("notes");
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("camp.recordings.notesTitle")}</DialogTitle>
          <DialogDescription dir="auto">
            {meeting ? (topicOf(meeting) ?? t("camp.recordings.noTopic")) : null}
          </DialogDescription>
        </DialogHeader>
        {meeting ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MeetingFacts m={meeting} />
              <RecordingCell m={meeting} />
            </div>
            <Tabs value={tab} onValueChange={(v) => setTab(v as NotesInclude)}>
              <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value="notes">{t("camp.recordings.tabNotes")}</TabsTrigger>
                <TabsTrigger value="transcript">{t("camp.recordings.tabTranscript")}</TabsTrigger>
                <TabsTrigger value="chat">{t("camp.recordings.tabChat")}</TabsTrigger>
              </TabsList>
              <TabsContent value={tab}>
                <NotesPanel meetingId={meeting.meetingId} include={tab} />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Loaded only when its tab is opened; the server reads SoWork on each fetch. */
function NotesPanel({ meetingId, include }: { meetingId: string; include: NotesInclude }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const fn = useServerFn(getCampMeetingNotes);
  const query = useQuery({
    queryKey: campKey("meetingNotes", meetingId, include),
    queryFn: () => fn({ data: { meetingId, include } }),
    staleTime: 600_000,
  });
  const d = query.data;
  const emptyKey: Record<NotesInclude, MessageKey> = {
    notes: "camp.recordings.notesEmpty",
    transcript: "camp.recordings.transcriptEmpty",
    chat: "camp.recordings.chatEmpty",
  };
  const isEmpty = !!d && d[include].length === 0;
  return (
    <QueryState
      isPending={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={isEmpty}
      emptyTitle={t(emptyKey[include])}
      skeletonRows={5}
    >
      {d && include === "notes" ? (
        <div className="space-y-4">
          {d.notes.map((n, i) => (
            <div key={`${n.language}-${i}`} className="rounded-md border bg-muted/20 p-3">
              {d.notes.length > 1 ? (
                <p className="mb-2 text-xs text-muted-foreground" dir="ltr">
                  {n.language}
                </p>
              ) : null}
              <pre dir="auto" className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {n.markdown}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
      {d && include === "transcript" ? (
        <ol className="space-y-2 text-sm">
          {d.transcript.map((turn, i) => (
            <li key={i} className="flex gap-3">
              <span
                className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground"
                dir="ltr"
              >
                {offsetLabel(turn.atMs)}
              </span>
              <p className="min-w-0" dir="auto">
                <span className="font-medium">{turn.speaker}: </span>
                <span className="whitespace-pre-wrap">{turn.text}</span>
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      {d && include === "chat" ? (
        <ol className="space-y-2 text-sm">
          {d.chat.map((msg, i) => (
            <li key={i} className="rounded-md border p-2">
              <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground" dir="auto">
                  {msg.author}
                </span>
                {/* SoWork sends Unix seconds. */}
                <span>{fmt.time(msg.sentAt < 1e12 ? msg.sentAt * 1000 : msg.sentAt)}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap" dir="auto">
                {msg.text}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </QueryState>
  );
}

/** Transcript offset from the meeting start: "m:ss" or "h:mm:ss". */
function offsetLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
