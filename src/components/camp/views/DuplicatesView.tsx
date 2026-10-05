/**
 * Camp operations — الحسابات المكررة (Module 2: duplicate and lookalike detection).
 *
 *   قائمة المراجعة     every flagged pair with both accounts, score, level, the
 *                     reasons and the registry record (FR-DUP-05); decisions one
 *                     by one or in bulk; a confirmed duplicate names the main
 *                     account, queues the second for removal and can send P05
 *                     (FR-DUP-06). Export: الحسابات المكررة (FR-EXP-03).
 *   فحوص سجل المعسكر   same phone, same or close email, two teams, guider and
 *                     coach at once, found inside the registry (FR-DUP-04)
 */
import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  EyeOff,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { EmptyState, QueryState } from "@/components/ui/query-state";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { getCampDuplicates } from "@/lib/camp-read.functions";
import { decideCampDuplicates } from "@/lib/camp-actions.functions";
import { DECISION_AR, DUPLICATE_LEVEL_AR, ROLE_AR } from "@/lib/camp/copy-ar";
import type { DuplicateLevel, DuplicateRow, EventRole, RegistryCheckRow } from "@/lib/camp/types";
import { downloadWorkbook } from "../export-xlsx";
import {
  AccountTypeBadge,
  campKey,
  DUP_KEY,
  DupBadge,
  errorMessage,
  FilterSelect,
  matchesSearch,
  PageTitle,
  PersonLink,
  ROLE_KEY,
  SearchBox,
  StatCard,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
  type Tone,
} from "../camp-ui";

type Decision = NonNullable<DuplicateRow["decision"]>;
type PairAccount = DuplicateRow["a"];
type PairReason = DuplicateRow["reasons"][number];
type CheckKind = RegistryCheckRow["kind"];

const LEVELS: DuplicateLevel[] = ["confirmed", "suspected", "lookalike"];
const CHECK_KINDS: CheckKind[] = [
  "same_phone",
  "same_email",
  "similar_email",
  "two_teams",
  "guider_and_coach",
];
/** Kinds whose shared value is a phone or an email (left to right); the others are names. */
const LTR_KINDS = new Set<CheckKind>(["same_phone", "same_email", "similar_email"]);

const DECISION_KEY: Record<Decision, MessageKey> = {
  duplicate: "camp.btn.confirmDuplicate",
  not_duplicate: "camp.btn.notDuplicate",
  follow_up: "camp.btn.followUp",
};
const DECISION_TONE: Record<Decision, Tone> = {
  duplicate: "bad",
  not_duplicate: "muted",
  follow_up: "warn",
};

/** Export copy (§10): Arabic whatever the UI language. */
const REASON_AR: Record<PairReason, string> = {
  same_name: "الاسم نفسه",
  same_registry: "مرتبطان بسجل واحد",
  same_name_other_suffix: "الاسم نفسه بلاحقة مختلفة",
  middle_name: "أحد الاسمين يزيد اسمًا أوسط",
  score: "تشابه كبير في الاسم",
  lookalike: "أسماء متشابهة",
};
const CHECK_AR: Record<CheckKind, string> = {
  same_phone: "رقم جوال مشترك",
  same_email: "بريد إلكتروني مشترك",
  similar_email: "بريدان يختلفان بحرفين أو أقل",
  two_teams: "شخص في فريقين",
  guider_and_coach: "في قائمتي المرشدين والمدربين",
};

const PAGE = 50;
/** decideCampDuplicates accepts at most 500 pairs per call. */
const CHUNK = 500;

const reasonKey = (r: PairReason) => `camp.dup.reason.${r}` as MessageKey;
const checkKey = (k: CheckKind) => `camp.dup.check.${k}` as MessageKey;
const roleKeyOf = (kind: string): MessageKey | null =>
  kind in ROLE_KEY ? ROLE_KEY[kind as EventRole] : null;

const ts = (value: string | null): number => (value ? Date.parse(value) || 0 : 0);
const firstActivity = (s: PairAccount) => s.firstMeetingAt ?? s.firstSeenAt;
const lastActivity = (s: PairAccount) => s.lastMeetingAt ?? s.lastActivityAt;
const latest = (s: PairAccount) => Math.max(ts(s.lastMeetingAt), ts(s.lastActivityAt));
const isOpen = (p: DuplicateRow) => p.decision === null || p.decision === "follow_up";

/**
 * The main account a confirmation defaults to: the one already chosen, else the
 * one linked to the registry, else the one active most recently (FR-DUP-05).
 */
function defaultMain(p: DuplicateRow): string {
  if (p.decision === "duplicate" && p.primaryId) return p.primaryId;
  if (p.a.registryId && !p.b.registryId) return p.a.swUserId;
  if (p.b.registryId && !p.a.registryId) return p.b.swUserId;
  return latest(p.b) > latest(p.a) ? p.b.swUserId : p.a.swUserId;
}

export function DuplicatesView() {
  const { t } = useTranslation();
  const fn = useServerFn(getCampDuplicates);
  const [includeHidden, setIncludeHidden] = useState(false);
  const query = useQuery({
    queryKey: campKey("duplicates", includeHidden),
    queryFn: () => fn({ data: { includeHidden } }),
    refetchInterval: 120_000,
    placeholderData: keepPreviousData,
  });
  const d = query.data;
  const counts = useMemo(() => {
    const c = { open: 0, confirmed: 0, suspected: 0, lookalike: 0 };
    for (const p of d?.pairs ?? []) {
      c[p.level] += 1;
      // The overview card's rule: lookalikes are shown for awareness only.
      if (p.level !== "lookalike" && isOpen(p)) c.open += 1;
    }
    return c;
  }, [d]);

  return (
    <div className="space-y-6">
      <PageTitle title={t("camp.nav.duplicates")} description={t("camp.dup.description")} />
      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        skeletonRows={8}
      >
        {d ? (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label={t("camp.overview.openDuplicates")}
                value={counts.open}
                tone={counts.open ? "warn" : "good"}
              />
              {LEVELS.map((l) => (
                <StatCard key={l} label={t(DUP_KEY[l])} value={counts[l]} />
              ))}
            </section>
            <Tabs defaultValue="queue">
              <TabsList className="mb-4 flex-wrap">
                <TabsTrigger value="queue">
                  {t("camp.dup.tabQueue")} ({d.pairs.length})
                </TabsTrigger>
                <TabsTrigger value="checks">
                  {t("camp.dup.tabChecks")} ({d.checks.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="queue">
                <ReviewQueue
                  pairs={d.pairs}
                  thresholds={d.thresholds}
                  includeHidden={includeHidden}
                  setIncludeHidden={setIncludeHidden}
                  refreshing={query.isFetching && query.isPlaceholderData}
                />
              </TabsContent>
              <TabsContent value="checks">
                <RegistryChecks checks={d.checks} />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Who decided (FR-EXP-03 "decided by")
// ---------------------------------------------------------------------------

/** The decider's email for each decided pair (the server joins it). */
function useDeciders(pairs: DuplicateRow[]): Map<string, string> {
  return useMemo(() => {
    const out = new Map<string, string>();
    for (const p of pairs) if (p.decision && p.decidedBy) out.set(p.key, p.decidedBy);
    return out;
  }, [pairs]);
}

// ---------------------------------------------------------------------------
// Review queue (FR-DUP-05/06, FR-EXP-03)
// ---------------------------------------------------------------------------

type DecideInput = {
  pairs: DuplicateRow[];
  decision: Decision | "clear";
  primaryOf?: (p: DuplicateRow) => string;
  note?: string | null;
  sendMessage?: boolean;
};

function ReviewQueue({
  pairs: all,
  thresholds,
  includeHidden,
  setIncludeHidden,
  refreshing,
}: {
  pairs: DuplicateRow[];
  thresholds: { suspected: number; lookalike: number };
  includeHidden: boolean;
  setIncludeHidden: (v: boolean) => void;
  refreshing: boolean;
}) {
  const { t } = useTranslation();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const { confirm, confirmDialog } = useConfirm();
  const deciders = useDeciders(all);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<DuplicateLevel | "all">("all");
  const [state, setState] = useState<"open" | "decided" | "all">("open");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [confirming, setConfirming] = useState<DuplicateRow[] | null>(null);

  const rows = useMemo(
    () =>
      all
        .filter((p) => level === "all" || p.level === level)
        .filter((p) => state === "all" || (state === "open" ? isOpen(p) : !isOpen(p)))
        .filter((p) =>
          matchesSearch(search, [
            p.a.name,
            p.b.name,
            p.a.registryName,
            p.b.registryName,
            p.a.phone,
            p.b.phone,
            p.a.teamNo,
            p.b.teamNo,
          ]),
        ),
    [all, level, state, search],
  );
  const shown = rows.slice(0, limit);

  // Selection survives filtering, but never outlives the pair itself.
  const selectedPairs = all.filter((p) => selected.has(p.key));
  const allSelected = rows.length > 0 && rows.every((p) => selected.has(p.key));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((p) => next.delete(p.key));
      else rows.forEach((p) => next.add(p.key));
      return next;
    });
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const decideFn = useServerFn(decideCampDuplicates);
  const decide = useMutation({
    mutationFn: async (v: DecideInput) => {
      let sent = 0;
      for (let i = 0; i < v.pairs.length; i += CHUNK) {
        const res = await decideFn({
          data: {
            pairs: v.pairs.slice(i, i + CHUNK).map((p) => ({
              aId: p.a.swUserId,
              bId: p.b.swUserId,
              primaryId: v.decision === "duplicate" ? (v.primaryOf ?? defaultMain)(p) : null,
            })),
            decision: v.decision,
            note: v.note ?? null,
            sendMessage: !!v.sendMessage,
          },
        });
        sent += res.sent;
      }
      return { sent };
    },
    onSuccess: async (res, v) => {
      toast.success(t("camp.dup.saved", { count: v.pairs.length }));
      if (v.sendMessage) toast.success(t("camp.msg.M04", { count: res.sent }));
      setSelected((prev) => {
        const next = new Set(prev);
        v.pairs.forEach((p) => next.delete(p.key));
        return next;
      });
      setConfirming(null);
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const hide = async (pairs: DuplicateRow[]) => {
    if (pairs.length > 1) {
      const ok = await confirm({
        title: t("camp.dup.hideConfirm", { count: pairs.length }),
        description: t("camp.dup.hideConfirmHint"),
        confirmLabel: t("camp.btn.notDuplicate"),
      });
      if (!ok) return;
    }
    decide.mutate({ pairs, decision: "not_duplicate" });
  };
  const clear = async (pairs: DuplicateRow[]) => {
    if (pairs.length > 1) {
      const ok = await confirm({
        title: t("camp.dup.clearConfirm", { count: pairs.length }),
        confirmLabel: t("camp.dup.clearDecision"),
        destructive: true,
      });
      if (!ok) return;
    }
    decide.mutate({ pairs, decision: "clear" });
  };

  const exportRows = (list: DuplicateRow[]) =>
    downloadWorkbook("الحسابات المكررة", [
      {
        name: "الحسابات المكررة",
        headers: [
          "الاسم الأول",
          "الاسم الثاني",
          "الدرجة",
          "المستوى",
          "السبب",
          "القرار",
          "صاحب القرار",
          "الحساب الرئيسي",
        ],
        rows: list.map((p) => [
          p.a.name,
          p.b.name,
          p.score,
          DUPLICATE_LEVEL_AR[p.level],
          p.reasons.map((r) => REASON_AR[r]).join("، "),
          p.decision ? DECISION_AR[p.decision] : "",
          p.decision ? (deciders.get(p.key) ?? "") : "",
          p.decision === "duplicate" && p.primaryId
            ? p.primaryId === p.a.swUserId
              ? p.a.name
              : p.b.name
            : "",
        ]),
      },
    ]);

  if (!all.length && !includeHidden) {
    return (
      <div className="space-y-3">
        <EmptyState icon={CheckCircle2} title={t("camp.msg.M14")} />
        <HiddenToggle checked={includeHidden} onChange={setIncludeHidden} busy={refreshing} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder={t("camp.users.searchHint")} />
        <FilterSelect
          label={t("camp.dup.level")}
          value={level}
          onChange={setLevel}
          options={LEVELS.map((l) => ({ value: l, label: t(DUP_KEY[l]) }))}
        />
        <FilterSelect
          label={t("camp.dup.decision")}
          value={state}
          onChange={setState}
          options={[
            { value: "open", label: t("camp.dup.stateOpen") },
            { value: "decided", label: t("camp.dup.stateDecided") },
          ]}
        />
        <HiddenToggle checked={includeHidden} onChange={setIncludeHidden} busy={refreshing} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("camp.dup.thresholds", {
          suspected: thresholds.suspected,
          lookalike: thresholds.lookalike,
        })}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
          {edit ? (
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              aria-label={t("camp.dup.selectAll")}
              title={t("camp.dup.selectAll")}
            />
          ) : null}
          {t("camp.dup.showing", { shown: rows.length, total: all.length })}
          {selectedPairs.length
            ? ` · ${t("camp.dup.selected", { count: selectedPairs.length })}`
            : ""}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void exportRows(rows)}>
            <Download className="me-1 h-4 w-4" />
            {t("camp.btn.exportExcel")}
          </Button>
          {edit && selectedPairs.length ? (
            <>
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() => setConfirming(selectedPairs)}
              >
                <Copy className="me-1 h-4 w-4" />
                {t("camp.btn.confirmDuplicate")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={decide.isPending}
                onClick={() => void hide(selectedPairs)}
              >
                <EyeOff className="me-1 h-4 w-4" />
                {t("camp.btn.notDuplicate")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ pairs: selectedPairs, decision: "follow_up" })}
              >
                <Clock className="me-1 h-4 w-4" />
                {t("camp.btn.followUp")}
              </Button>
              {selectedPairs.some((p) => p.decision) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => void clear(selectedPairs.filter((p) => p.decision))}
                >
                  <RotateCcw className="me-1 h-4 w-4" />
                  {t("camp.dup.clearDecision")}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                <X className="me-1 h-4 w-4" />
                {t("camp.users.clearSelection")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {shown.length ? (
        <ul className="space-y-3">
          {shown.map((p) => (
            <PairCard
              key={p.key}
              pair={p}
              decider={deciders.get(p.key) ?? null}
              edit={edit}
              busy={decide.isPending}
              selected={selected.has(p.key)}
              onToggle={() => toggle(p.key)}
              onConfirm={() => setConfirming([p])}
              onDecide={(decision) => decide.mutate({ pairs: [p], decision })}
              onHide={() => void hide([p])}
              onClear={() => void clear([p])}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          {t("camp.common.noResults")}
        </p>
      )}
      {rows.length > shown.length ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
            {t("camp.dup.showMore", { count: Math.min(PAGE, rows.length - shown.length) })}
          </Button>
        </div>
      ) : null}

      {confirming ? (
        <ConfirmDuplicateDialog
          pairs={confirming}
          busy={decide.isPending}
          onClose={() => setConfirming(null)}
          onSubmit={({ primaryId, note, sendMessage }) =>
            decide.mutate({
              pairs: confirming,
              decision: "duplicate",
              primaryOf: primaryId ? () => primaryId : undefined,
              note,
              sendMessage,
            })
          }
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

function HiddenToggle({
  checked,
  onChange,
  busy,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {t("camp.dup.showHidden")}
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
    </label>
  );
}

function PairCard({
  pair: p,
  decider,
  edit,
  busy,
  selected,
  onToggle,
  onConfirm,
  onDecide,
  onHide,
  onClear,
}: {
  pair: DuplicateRow;
  decider: string | null;
  edit: boolean;
  busy: boolean;
  selected: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onDecide: (decision: "follow_up") => void;
  onHide: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const main = p.decision === "duplicate" ? p.primaryId : null;
  return (
    <li className={cn("rounded-lg border bg-card p-3 sm:p-4", selected && "ring-1 ring-primary")}>
      <div className="flex flex-wrap items-center gap-2">
        {edit ? (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            aria-label={t("camp.dup.selectPair")}
          />
        ) : null}
        <DupBadge level={p.level} />
        <span className="text-sm tabular-nums">{t("camp.dup.score", { score: p.score })}</span>
        <ul className="flex flex-wrap gap-1">
          {p.reasons.map((r) => (
            <li key={r}>
              <ToneBadge tone="muted">{t(reasonKey(r))}</ToneBadge>
            </li>
          ))}
        </ul>
        {p.decision ? (
          <span className="ms-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ToneBadge tone={DECISION_TONE[p.decision]}>
              {t("camp.dup.decision")}: {t(DECISION_KEY[p.decision])}
            </ToneBadge>
            {fmt.dateTime(p.decidedAt)}
            {decider ? <span dir="auto">{t("camp.dup.decidedBy", { name: decider })}</span> : null}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <PairSide side={p.a} role={main ? (main === p.a.swUserId ? "main" : "second") : null} />
        <PairSide side={p.b} role={main ? (main === p.b.swUserId ? "main" : "second") : null} />
      </div>
      {p.note ? (
        <p className="mt-2 text-sm text-muted-foreground" dir="auto">
          {p.note}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-sm font-medium">{t("camp.msg.M07")}</p>
        {edit ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={onConfirm}>
              <Copy className="me-1 h-4 w-4" />
              {t("camp.btn.confirmDuplicate")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || p.decision === "not_duplicate"}
              onClick={onHide}
            >
              <EyeOff className="me-1 h-4 w-4" />
              {t("camp.btn.notDuplicate")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || p.decision === "follow_up"}
              onClick={() => onDecide("follow_up")}
            >
              <Clock className="me-1 h-4 w-4" />
              {t("camp.btn.followUp")}
            </Button>
            {p.decision ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
                <RotateCcw className="me-1 h-4 w-4" />
                {t("camp.dup.clearDecision")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function PairSide({ side: s, role }: { side: PairAccount; role: "main" | "second" | null }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  return (
    <div className="min-w-0 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PersonLink personKey={`u:${s.swUserId}`} className="min-w-0 break-words">
          <span dir="auto">{s.name || "—"}</span>
        </PersonLink>
        <span className="flex flex-wrap items-center gap-1">
          {role === "main" ? (
            <ToneBadge tone="good">
              <Check className="me-1 h-3 w-3" aria-hidden />
              {t("camp.dup.mainAccount")}
            </ToneBadge>
          ) : role === "second" ? (
            <ToneBadge tone="muted">{t("camp.dup.secondAccount")}</ToneBadge>
          ) : null}
          <AccountTypeBadge type={s.accountType} />
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t("camp.dup.firstActivity")}</dt>
        <dd>{fmt.dateTime(firstActivity(s))}</dd>
        <dt className="text-muted-foreground">{t("camp.person.lastActivity")}</dt>
        <dd>{fmt.dateTime(lastActivity(s))}</dd>
        <dt className="text-muted-foreground">{t("camp.dup.registry")}</dt>
        <dd className="min-w-0">
          {s.registryName ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span dir="auto">{s.registryName}</span>
              {s.phone ? <span dir="ltr">{s.phone}</span> : null}
              {s.teamNo !== null ? <span>{t("camp.common.teamN", { n: s.teamNo })}</span> : null}
              {!s.registryId ? (
                <ToneBadge tone="warn">{t("camp.match.candidate")}</ToneBadge>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("camp.dup.noRegistry")}</span>
          )}
        </dd>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm duplicate (FR-DUP-05/06): main account, removal of the second, P05
// ---------------------------------------------------------------------------

function ConfirmDuplicateDialog({
  pairs,
  busy,
  onClose,
  onSubmit,
}: {
  pairs: DuplicateRow[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: { primaryId: string | null; note: string | null; sendMessage: boolean }) => void;
}) {
  const { t } = useTranslation();
  const single = pairs.length === 1 ? pairs[0]! : null;
  const [primaryId, setPrimaryId] = useState(() => (single ? defaultMain(single) : ""));
  const [note, setNote] = useState("");
  const [sendMessage, setSendMessage] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("camp.btn.confirmDuplicate")}</DialogTitle>
          <DialogDescription>
            {single ? t("camp.msg.M07") : t("camp.dup.selected", { count: pairs.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {single ? (
            <div className="space-y-2">
              <Label>{t("camp.dup.pickMain")}</Label>
              <RadioGroup value={primaryId} onValueChange={setPrimaryId}>
                {[single.a, single.b].map((s) => (
                  <label
                    key={s.swUserId}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm",
                      primaryId === s.swUserId && "border-primary",
                    )}
                  >
                    <RadioGroupItem value={s.swUserId} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block font-medium" dir="auto">
                        {s.name || "—"}
                      </span>
                      <span className="block text-xs text-muted-foreground" dir="auto">
                        {s.registryName ?? t("camp.dup.noRegistry")}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              <p className="text-xs text-muted-foreground">{t("camp.dup.pickMainHint")}</p>
            </div>
          ) : (
            <p className="text-sm">{t("camp.dup.bulkMainHint")}</p>
          )}
          <p className="rounded-md border bg-muted/40 p-3 text-sm">{t("camp.dup.confirmEffect")}</p>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={sendMessage}
              onCheckedChange={(v) => setSendMessage(v === true)}
              className="mt-0.5"
            />
            {t("camp.dup.sendP05")}
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="camp-dup-note">{t("camp.dup.comment")}</Label>
            <Textarea
              id="camp-dup-note"
              dir="auto"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("camp.btn.cancel")}
          </Button>
          <Button
            disabled={busy || (!!single && !primaryId)}
            onClick={() =>
              onSubmit({
                primaryId: single ? primaryId : null,
                note: note.trim() || null,
                sendMessage,
              })
            }
          >
            {busy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : null}
            {t("camp.btn.confirmDuplicate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Registry checks (FR-DUP-04)
// ---------------------------------------------------------------------------

function RegistryChecks({ checks }: { checks: RegistryCheckRow[] }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<CheckKind | "all">("all");
  const rows = checks
    .filter((c) => kind === "all" || c.kind === kind)
    .filter((c) =>
      matchesSearch(search, [c.value, ...c.people.flatMap((p) => [p.name, p.teamNo])]),
    );
  const groups = CHECK_KINDS.map((k) => ({
    kind: k,
    items: rows.filter((c) => c.kind === k),
  })).filter((g) => g.items.length);
  const exportRows = () =>
    downloadWorkbook("فحوص سجل المعسكر", [
      {
        name: "فحوص سجل المعسكر",
        headers: ["الفحص", "القيمة المشتركة", "الأسماء", "الفريق", "الدور في المعسكر"],
        rows: rows.map((c) => [
          CHECK_AR[c.kind],
          LTR_KINDS.has(c.kind) ? c.value : "",
          c.people.map((p) => p.name).join("، "),
          c.people.map((p) => p.teamNo ?? "").join("، "),
          c.people.map((p) => ROLE_AR[p.kind as EventRole] ?? "").join("، "),
        ]),
      },
    ]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("camp.dup.checksHint")}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={search} onChange={setSearch} />
          <FilterSelect
            label={t("camp.naming.check")}
            value={kind}
            onChange={setKind}
            options={CHECK_KINDS.map((k) => ({ value: k, label: t(checkKey(k)) }))}
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => void exportRows()}>
          <Download className="me-1 h-4 w-4" />
          {t("camp.btn.exportExcel")}
        </Button>
      </div>
      {!checks.length ? (
        <EmptyState icon={CheckCircle2} title={t("camp.dup.noChecks")} />
      ) : !groups.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          {t("camp.common.noResults")}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.kind} className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">
              {t(checkKey(g.kind))} ({g.items.length})
            </h3>
            <ul className="divide-y">
              {g.items.map((c) => (
                <li
                  key={`${c.kind}:${c.value}:${c.people.map((p) => p.id).join(",")}`}
                  className="flex flex-col gap-2 py-2 text-sm sm:flex-row sm:items-start sm:gap-4"
                >
                  {LTR_KINDS.has(c.kind) ? (
                    <span className="shrink-0 sm:w-64">
                      <span className="block text-xs text-muted-foreground">
                        {t("camp.dup.sharedValue")}
                      </span>
                      <span dir="ltr" className="break-all">
                        {c.value}
                      </span>
                    </span>
                  ) : null}
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {c.people.map((p) => {
                      const roleKey = roleKeyOf(p.kind);
                      return (
                        <li key={p.id} className="flex flex-wrap items-center gap-1.5">
                          <PersonLink personKey={`p:${p.id}`}>
                            <span dir="auto">{p.name}</span>
                          </PersonLink>
                          <span className="text-xs text-muted-foreground">
                            {[
                              p.teamNo !== null ? t("camp.common.teamN", { n: p.teamNo }) : null,
                              roleKey ? t(roleKey) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
