/**
 * Camp operations — الإعدادات.
 *
 *   Connection      who the API key acts as, the team-analytics permission (§2),
 *                   the data feed, "refresh now" and event capture (FR-ATT-01)
 *   Sending         the one switch for everything sent automatically
 *   My account      the operator's own SoWork account and on-duty flag (FR-NOT-03/06)
 *   Settings        alert recipients, camp and thresholds, expected account types
 *                   (BR-USR-04), role labels and honorifics (FR-NAM-07), channels
 *   Audit log       every recorded action (FR-USR-11)
 *
 * The settings form keeps local edits, validates them against the ranges in
 * lib/camp/settings.ts, and saves only what changed (see useSaveSettings).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ChevronsUpDown,
  Download,
  Loader2,
  Plug,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QueryState } from "@/components/ui/query-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConfirm } from "@/components/ui/use-confirm";
import { ensureLocaleDict, tFor, type MessageKey } from "@/i18n";
import { useTranslation } from "@/i18n/use-translation";
import {
  getCampDirectory,
  getCampMessaging,
  getCampSettings,
  listCampAudit,
} from "@/lib/camp-read.functions";
import {
  runCampSyncNow,
  saveCampSettings,
  setMyCampAccount,
  startCampEventCapture,
  testCampConnection,
} from "@/lib/camp-admin.functions";
import {
  ACCOUNT_TYPES,
  campSettingsPatchSchema,
  DEFAULT_ROLE_LABELS,
  ENABLER_ROLES,
  type EnablerRole,
} from "@/lib/camp/settings";
import { DEFAULT_HONORIFICS, formatDateAr, formatTimeAr, riyadhDate } from "@/lib/camp/text";
import type { AccountRow, AccountType, CampSettings, SyncStatusDto } from "@/lib/camp/types";
import { downloadWorkbook } from "../export-xlsx";
import {
  ACCOUNT_TYPE_KEY,
  campKey,
  errorMessage,
  FilterSelect,
  matchesSearch,
  PageTitle,
  ROLE_KEY,
  SearchBox,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
} from "../camp-ui";
import { ChipListEditor, Section, ToneBox } from "./upload/parts";
import { isHHMM, isMessageKey } from "./upload/shared";

export function CampSettingsView() {
  const { t } = useTranslation();
  const fn = useServerFn(getCampSettings);
  const query = useQuery({
    queryKey: campKey("settings"),
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });
  const d = query.data;
  return (
    <div className="space-y-6">
      <PageTitle title={t("camp.nav.settings")} description={t("camp.settings.description")} />
      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        skeletonRows={8}
      >
        {d ? (
          <>
            <ConnectionSection sync={d.sync} />
            <SendingSection enabled={d.settings.sendingEnabled} />
            <MyAccountSection />
            <SettingsForm settings={d.settings} />
            <AuditSection />
          </>
        ) : null}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared queries
// ---------------------------------------------------------------------------

function useConnection() {
  const { admin } = useCampAbilities();
  const fn = useServerFn(testCampConnection);
  return useQuery({
    queryKey: campKey("connection"),
    queryFn: () => fn(),
    enabled: admin,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function useDirectoryAccounts(enabled: boolean) {
  const fn = useServerFn(getCampDirectory);
  const query = useQuery({ queryKey: campKey("directory"), queryFn: () => fn(), enabled });
  return { accounts: query.data?.accounts ?? [], query };
}

/**
 * Saves only the changed keys. The server validates exactly the keys sent
 * (parseCampSettingsPatch) and merges them over the stored document, so a
 * concurrent edit by another admin to a different setting survives.
 */
function useSaveSettings() {
  const saveFn = useServerFn(saveCampSettings);
  return async (patch: Partial<CampSettings>) => {
    await saveFn({ data: patch });
  };
}

// ---------------------------------------------------------------------------
// Connection and data feed
// ---------------------------------------------------------------------------

function ConnectionSection({ sync }: { sync: SyncStatusDto }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit, admin } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const connection = useConnection();
  const syncFn = useServerFn(runCampSyncNow);
  const captureFn = useServerFn(startCampEventCapture);

  const syncNow = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: async (res) => {
      if (res.skipped === "busy") toast.info(t("camp.sync.busy"));
      else if (res.skipped === "not_configured") toast.error(t("camp.sync.notConfigured"));
      else if (res.errors.length)
        toast.warning(t("camp.sync.partial", { errors: res.errors.join(" · ") }));
      else toast.success(t("camp.sync.done"));
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const capture = useMutation({
    mutationFn: () => captureFn(),
    onSuccess: async (res) => {
      toast.success(
        res.created ? t("camp.settings.captureCreated") : t("camp.settings.captureAdopted"),
      );
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const captureButton = admin ? (
    <Button
      size="sm"
      variant={sync.subscriptionId ? "outline" : "default"}
      disabled={capture.isPending || !sync.configured}
      onClick={() => capture.mutate()}
    >
      {capture.isPending ? (
        <Loader2 className="me-1 h-4 w-4 animate-spin" />
      ) : (
        <Radio className="me-1 h-4 w-4" />
      )}
      {t("camp.settings.startCapture")}
    </Button>
  ) : null;

  const c = connection.data;
  return (
    <Section
      title={t("camp.settings.connectionTitle")}
      description={t("camp.settings.keyNote")}
      actions={
        <>
          {edit ? (
            <Button
              size="sm"
              variant="outline"
              disabled={syncNow.isPending}
              onClick={() => syncNow.mutate()}
            >
              {syncNow.isPending ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="me-1 h-4 w-4" />
              )}
              {t("camp.btn.refreshNow")}
            </Button>
          ) : null}
          {sync.subscriptionId ? captureButton : null}
        </>
      }
    >
      <div className="space-y-4">
        {!sync.configured ? <ToneBox tone="bad">{t("camp.sync.notConfigured")}</ToneBox> : null}
        {sync.configured && !sync.subscriptionId ? (
          <ToneBox tone="bad" title={t("camp.settings.captureUrgentTitle")} action={captureButton}>
            <p>{t("camp.settings.captureUrgent")}</p>
            {!admin ? <p className="mt-1">{t("camp.settings.captureAskAdmin")}</p> : null}
          </ToneBox>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-sm font-medium">
                <Plug className="h-4 w-4 text-muted-foreground" aria-hidden />
                {t("camp.settings.testTitle")}
              </h4>
              {admin ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  disabled={connection.isFetching}
                  onClick={() => void connection.refetch()}
                >
                  {connection.isFetching ? (
                    <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="me-1 h-3.5 w-3.5" />
                  )}
                  {t("camp.settings.testAgain")}
                </Button>
              ) : null}
            </div>
            {!admin ? (
              <p className="text-sm text-muted-foreground">{t("camp.settings.testAdminOnly")}</p>
            ) : connection.isPending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("camp.settings.testing")}
              </p>
            ) : connection.isError ? (
              <ToneBox tone="bad">
                <span dir="ltr">{errorMessage(connection.error)}</span>
              </ToneBox>
            ) : c ? (
              <div className="space-y-3">
                {!c.configured ? (
                  <ToneBox tone="bad">{t("camp.sync.notConfigured")}</ToneBox>
                ) : c.error ? (
                  <ToneBox tone="bad" title={t("camp.settings.testFailed")}>
                    <span dir="ltr" className="break-all">
                      {c.error}
                    </span>
                  </ToneBox>
                ) : (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">{t("camp.settings.actsAs")}</dt>
                    <dd className="min-w-0">
                      <span dir="auto">{c.me?.name || "—"}</span>
                      {c.me ? (
                        <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">
                          {c.me.id}
                        </span>
                      ) : null}
                    </dd>
                    <dt className="text-muted-foreground">{t("camp.settings.analytics")}</dt>
                    <dd>
                      <ToneBadge tone={c.analytics ? "good" : "bad"}>
                        {c.analytics
                          ? t("camp.settings.analyticsOk")
                          : t("camp.settings.analyticsMissing")}
                      </ToneBadge>
                    </dd>
                    <dt className="text-muted-foreground">{t("camp.settings.channelsFound")}</dt>
                    <dd className="tabular-nums">{c.channels.length}</dd>
                  </dl>
                )}
                {c.configured && !c.error && !c.analytics ? (
                  <ToneBox tone="warn">{t("camp.settings.analyticsHelp")}</ToneBox>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-md border p-3">
            <h4 className="mb-2 text-sm font-medium">{t("camp.overview.feed")}</h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("camp.sync.lastRefresh")}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {fmt.dateTime(sync.lastTickAt)}
                {sync.lastTickOk === null ? null : (
                  <ToneBadge tone={sync.lastTickOk ? "good" : "warn"}>
                    {sync.lastTickOk ? t("camp.settings.tickOk") : t("camp.settings.tickErrors")}
                  </ToneBadge>
                )}
              </dd>
              <dt className="text-muted-foreground">{t("camp.sync.lastEvent")}</dt>
              <dd>{fmt.dateTime(sync.lastEventAt)}</dd>
              <dt className="text-muted-foreground">{t("camp.settings.subscription")}</dt>
              <dd className="min-w-0">
                {sync.subscriptionId ? (
                  <span className="break-all font-mono text-xs" dir="ltr">
                    {sync.subscriptionId}
                  </span>
                ) : (
                  <ToneBadge tone="bad">{t("camp.settings.notStarted")}</ToneBadge>
                )}
              </dd>
              <dt className="text-muted-foreground">{t("camp.settings.backfill")}</dt>
              <dd>
                <ToneBadge tone={sync.backfillDone ? "good" : "warn"}>
                  {sync.backfillDone
                    ? t("camp.settings.backfillDone")
                    : t("camp.settings.backfillPending")}
                </ToneBadge>
              </dd>
              <dt className="text-muted-foreground">{t("camp.sync.events")}</dt>
              <dd className="tabular-nums">{sync.counts.events}</dd>
              <dt className="text-muted-foreground">{t("camp.sync.meetings")}</dt>
              <dd className="tabular-nums">{sync.counts.meetings}</dd>
              <dt className="text-muted-foreground">{t("camp.sync.accounts")}</dt>
              <dd className="tabular-nums">{sync.counts.accounts}</dd>
            </dl>
            {sync.lastTickErrors.length ? (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground" dir="ltr">
                {sync.lastTickErrors.map((e) => (
                  <li key={e} className="break-all">
                    {e}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Automatic sending
// ---------------------------------------------------------------------------

function SendingSection({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const { admin, loaded } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const { confirm, confirmDialog } = useConfirm();
  const saveSettings = useSaveSettings();
  const save = useMutation({
    mutationFn: (next: boolean) => saveSettings({ sendingEnabled: next }),
    onSuccess: async (_res, next) => {
      toast.success(
        next ? t("camp.settings.sendingTurnedOn") : t("camp.settings.sendingTurnedOff"),
      );
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const toggle = async (next: boolean) => {
    if (next) {
      const ok = await confirm({
        title: t("camp.settings.sendingConfirmTitle"),
        description: t("camp.settings.sendingConfirmBody"),
        confirmLabel: t("camp.settings.sendingConfirm"),
        cancelLabel: t("camp.btn.cancel"),
      });
      if (!ok) return;
    }
    save.mutate(next);
  };
  return (
    <Section
      title={t("camp.sync.sending")}
      actions={
        <span className="flex items-center gap-3">
          <ToneBadge tone={enabled ? "good" : "muted"}>
            {enabled ? t("camp.sync.sendingOn") : t("camp.sync.sendingOff")}
          </ToneBadge>
          {admin ? (
            <span className="flex items-center gap-2">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <Switch
                checked={enabled}
                disabled={save.isPending}
                onCheckedChange={(next) => void toggle(next)}
                aria-label={t("camp.sync.sending")}
              />
            </span>
          ) : null}
        </span>
      }
    >
      <div className="space-y-3 text-sm">
        <p>{t("camp.settings.sendingWhat")}</p>
        <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
          <li>{t("camp.settings.sendingCues")}</li>
          <li>{t("camp.settings.sendingNudges")}</li>
          <li>{t("camp.settings.sendingAlerts")}</li>
          <li>{t("camp.settings.sendingSummary")}</li>
        </ul>
        <p className="text-muted-foreground">{t("camp.settings.sendingManual")}</p>
        <ToneBox tone="info">{t("camp.settings.sendingTest")}</ToneBox>
        {loaded && !admin ? (
          <p className="text-xs text-muted-foreground">{t("camp.settings.adminOnly")}</p>
        ) : null}
      </div>
      {confirmDialog}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Account picker (SoWork accounts from the directory, FR-USR-03 search)
// ---------------------------------------------------------------------------

function AccountPicker({
  accounts,
  value,
  onSelect,
  placeholder,
  exclude,
  allowNone,
  loading,
}: {
  accounts: AccountRow[];
  value: string | null;
  onSelect: (id: string | null) => void;
  placeholder: string;
  exclude?: ReadonlySet<string>;
  allowNone?: boolean;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = value ? accounts.find((a) => a.swUserId === value) : undefined;
  const results = useMemo(
    () =>
      accounts
        .filter((a) => !exclude?.has(a.swUserId))
        .filter((a) =>
          matchesSearch(query, [a.name, a.registryName, a.phone, a.email, a.teamNo, a.swUserId]),
        )
        .sort((a, b) => a.name.localeCompare(b.name, "ar"))
        .slice(0, 60),
    [accounts, exclude, query],
  );
  const choose = (id: string | null) => {
    onSelect(id);
    setOpen(false);
    setQuery("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal sm:w-80"
        >
          <span className="truncate" dir="auto">
            {selected ? selected.name : value ? value : placeholder}
          </span>
          {loading ? (
            <Loader2 className="ms-2 h-4 w-4 shrink-0 animate-spin opacity-60" />
          ) : (
            <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-60" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw_-_2rem))] p-2" align="start">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("camp.settings.account.search")}
          aria-label={t("camp.settings.account.search")}
          className="h-8"
        />
        <div role="listbox" className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
          {allowNone ? (
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              className="w-full rounded px-2 py-1.5 text-start text-sm text-muted-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => choose(null)}
            >
              {t("camp.settings.account.none")}
            </button>
          ) : null}
          {results.map((a) => (
            <button
              key={a.swUserId}
              type="button"
              role="option"
              aria-selected={a.swUserId === value}
              className={`flex w-full flex-col items-start rounded px-2 py-1.5 text-start text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none ${
                a.swUserId === value ? "bg-accent" : ""
              }`}
              onClick={() => choose(a.swUserId)}
            >
              <span dir="auto">{a.name || a.swUserId}</span>
              <span className="text-xs text-muted-foreground">
                {t(ROLE_KEY[a.eventRole])} · {t(ACCOUNT_TYPE_KEY[a.accountType])}
                {a.teamNo !== null ? ` · ${t("camp.common.teamN", { n: a.teamNo })}` : ""}
              </span>
            </button>
          ))}
          {!results.length ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              {loading ? t("camp.settings.account.loading") : t("camp.common.noResults")}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// My account (editor)
// ---------------------------------------------------------------------------

function MyAccountSection() {
  const { t } = useTranslation();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const messagingFn = useServerFn(getCampMessaging);
  const saveFn = useServerFn(setMyCampAccount);
  const messaging = useQuery({
    queryKey: campKey("messaging"),
    queryFn: () => messagingFn(),
    enabled: edit,
  });
  const { accounts, query: directory } = useDirectoryAccounts(edit);
  const [account, setAccount] = useState<string | null | undefined>(undefined);
  const [onDuty, setOnDuty] = useState<boolean | undefined>(undefined);

  if (!edit) return null;
  const serverAccount = messaging.data?.myAccount ?? null;
  const serverOnDuty = messaging.data?.myOnDuty ?? false;
  const currentAccount = account === undefined ? serverAccount : account;
  const currentOnDuty = onDuty === undefined ? serverOnDuty : onDuty;
  const changed = currentAccount !== serverAccount || currentOnDuty !== serverOnDuty;

  return (
    <MyAccountBody
      loading={messaging.isPending}
      accounts={accounts}
      directoryLoading={directory.isPending}
      account={currentAccount}
      onDuty={currentOnDuty}
      changed={changed}
      onAccount={setAccount}
      onOnDuty={setOnDuty}
      onSave={async () => {
        try {
          await saveFn({ data: { swUserId: currentAccount, onDuty: currentOnDuty } });
          toast.success(t("camp.common.saved"));
          await invalidate();
          setAccount(undefined);
          setOnDuty(undefined);
        } catch (err) {
          toast.error(errorMessage(err));
        }
      }}
    />
  );
}

function MyAccountBody({
  loading,
  accounts,
  directoryLoading,
  account,
  onDuty,
  changed,
  onAccount,
  onOnDuty,
  onSave,
}: {
  loading: boolean;
  accounts: AccountRow[];
  directoryLoading: boolean;
  account: string | null;
  onDuty: boolean;
  changed: boolean;
  onAccount: (id: string | null) => void;
  onOnDuty: (v: boolean) => void;
  onSave: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t("camp.settings.myAccountTitle")}
        </span>
      }
      description={t("camp.settings.myAccountHint")}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label>{t("camp.settings.myAccount")}</Label>
            <AccountPicker
              accounts={accounts}
              value={account}
              onSelect={onAccount}
              placeholder={t("camp.settings.account.choose")}
              allowNone
              loading={directoryLoading}
            />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <Switch checked={onDuty} onCheckedChange={onOnDuty} />
            {t("camp.settings.onDuty")}
          </label>
          <Button
            size="sm"
            disabled={!changed || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <Loader2 className="me-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="me-1 h-4 w-4" />
            )}
            {t("camp.btn.save")}
          </Button>
        </div>
      )}
      {onDuty && !account ? (
        <p className="mt-2 text-xs text-[var(--destructive)]">
          {t("camp.settings.onDutyNeedsAccount")}
        </p>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Settings form
// ---------------------------------------------------------------------------

type NumKey =
  | "dayCount"
  | "teamCount"
  | "attendMinutes"
  | "lateMinutes"
  | "lowAttendancePercent"
  | "lowAttendanceAfterMinutes"
  | "duplicateSuspectedScore"
  | "duplicateLookalikeScore"
  | "autoLinkScore"
  | "roomMixShare"
  | "mainHallMinParticipants"
  | "libraryMatchSeconds"
  | "libraryRetryMinutes"
  | "refreshAgendaMinutes"
  | "refreshIdleMinutes"
  | "maxNudgesPerDay"
  | "namingReminderMax"
  | "eventSilenceMinutes";
type TimeKey =
  | "mentoringWindowStart"
  | "mentoringWindowEnd"
  | "namingReminderTime"
  | "dailySummaryTime"
  | "lastDaySummaryTime";
type Unit = "minutes" | "seconds" | "percent" | "score" | "days" | "teams" | "people" | "times";

type FieldDef =
  | { kind: "number"; key: NumKey; min: number; max: number; unit: Unit; scale?: number }
  | { kind: "time"; key: TimeKey }
  | { kind: "date"; key: "startDate" }
  | { kind: "switch"; key: "everyoneIncludesEnablers" };

/** Ranges mirror campSettingsSchema (lib/camp/settings.ts); the schema is checked too. */
const SECTIONS: { id: string; fields: FieldDef[] }[] = [
  {
    id: "camp",
    fields: [
      { kind: "date", key: "startDate" },
      { kind: "number", key: "dayCount", min: 1, max: 60, unit: "days" },
      { kind: "number", key: "teamCount", min: 1, max: 999, unit: "teams" },
    ],
  },
  {
    id: "attendance",
    fields: [
      { kind: "number", key: "attendMinutes", min: 1, max: 120, unit: "minutes" },
      { kind: "number", key: "lateMinutes", min: 0, max: 120, unit: "minutes" },
      { kind: "number", key: "lowAttendancePercent", min: 1, max: 100, unit: "percent" },
      { kind: "number", key: "lowAttendanceAfterMinutes", min: 1, max: 120, unit: "minutes" },
      { kind: "time", key: "mentoringWindowStart" },
      { kind: "time", key: "mentoringWindowEnd" },
      { kind: "switch", key: "everyoneIncludesEnablers" },
    ],
  },
  {
    id: "matching",
    fields: [
      { kind: "number", key: "duplicateSuspectedScore", min: 50, max: 100, unit: "score" },
      { kind: "number", key: "duplicateLookalikeScore", min: 50, max: 100, unit: "score" },
      { kind: "number", key: "autoLinkScore", min: 50, max: 100, unit: "score" },
    ],
  },
  {
    id: "rooms",
    fields: [
      { kind: "number", key: "roomMixShare", min: 10, max: 100, unit: "percent", scale: 100 },
      { kind: "number", key: "mainHallMinParticipants", min: 2, max: 1000, unit: "people" },
    ],
  },
  {
    id: "recordings",
    fields: [
      { kind: "number", key: "libraryMatchSeconds", min: 30, max: 1800, unit: "seconds" },
      { kind: "number", key: "libraryRetryMinutes", min: 1, max: 240, unit: "minutes" },
    ],
  },
  {
    id: "refresh",
    fields: [
      { kind: "number", key: "refreshAgendaMinutes", min: 1, max: 120, unit: "minutes" },
      { kind: "number", key: "refreshIdleMinutes", min: 1, max: 240, unit: "minutes" },
      { kind: "number", key: "eventSilenceMinutes", min: 1, max: 120, unit: "minutes" },
    ],
  },
  {
    id: "messages",
    fields: [
      { kind: "number", key: "maxNudgesPerDay", min: 0, max: 20, unit: "times" },
      { kind: "time", key: "namingReminderTime" },
      { kind: "number", key: "namingReminderMax", min: 0, max: 20, unit: "times" },
      { kind: "time", key: "dailySummaryTime" },
      { kind: "time", key: "lastDaySummaryTime" },
    ],
  },
];

const NUM_FIELDS = new Map(
  SECTIONS.flatMap((s) => s.fields).flatMap((f) => (f.kind === "number" ? [[f.key, f]] : [])) as [
    NumKey,
    Extract<FieldDef, { kind: "number" }>,
  ][],
);
const TIME_KEYS = new Set<string>(
  SECTIONS.flatMap((s) => s.fields).flatMap((f) => (f.kind === "time" ? [f.key] : [])),
);
const PARTICIPANT_AND_ENABLERS = ["participant", ...ENABLER_ROLES] as const;
type Edits = Partial<Record<keyof CampSettings, unknown>>;
const NO_CHANNEL = "__none";

function displayNumber(def: Extract<FieldDef, { kind: "number" }>, value: number): string {
  return String(def.scale ? Math.round(value * def.scale) : value);
}

function SettingsForm({ settings }: { settings: CampSettings }) {
  const { t } = useTranslation();
  const { admin, loaded } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const saveSettings = useSaveSettings();
  const connection = useConnection();
  const { accounts, query: directory } = useDirectoryAccounts(true);
  const [edits, setEdits] = useState<Edits>({});
  const [saving, setSaving] = useState(false);

  const value = <K extends keyof CampSettings>(key: K): CampSettings[K] =>
    (key in edits ? edits[key] : settings[key]) as CampSettings[K];
  const set = (key: keyof CampSettings, next: unknown) =>
    setEdits((prev) => ({ ...prev, [key]: next }));
  const numText = (def: Extract<FieldDef, { kind: "number" }>): string =>
    def.key in edits ? String(edits[def.key]) : displayNumber(def, settings[def.key]);

  const { patch, errors } = useMemo(() => {
    const patch: Partial<CampSettings> = {};
    const errors: Partial<Record<keyof CampSettings, string>> = {};
    const put = <K extends keyof CampSettings>(key: K, v: CampSettings[K]) => {
      if (JSON.stringify(v) !== JSON.stringify(settings[key])) patch[key] = v;
    };
    for (const [rawKey, raw] of Object.entries(edits)) {
      const key = rawKey as keyof CampSettings;
      const def = NUM_FIELDS.get(key as NumKey);
      if (def) {
        const text = String(raw).trim();
        const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
        if (!Number.isInteger(n) || n < def.min || n > def.max) {
          errors[key] = t("camp.settings.rangeError", { min: def.min, max: def.max });
          continue;
        }
        put(def.key, def.scale ? n / def.scale : n);
        continue;
      }
      if (TIME_KEYS.has(key)) {
        if (!isHHMM(String(raw))) errors[key] = t("camp.settings.timeError");
        else put(key as TimeKey, String(raw));
        continue;
      }
      if (key === "startDate") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) errors[key] = t("camp.settings.dateError");
        else put("startDate", String(raw));
        continue;
      }
      if (key === "soworkAdminUrl") {
        const url = String(raw).trim();
        if (!/^https?:\/\/\S+$/.test(url)) errors[key] = t("camp.settings.urlError");
        else put("soworkAdminUrl", url);
        continue;
      }
      if (key === "mainHallZoneId") {
        put("mainHallZoneId", String(raw).trim());
        continue;
      }
      put(key, raw as CampSettings[typeof key]);
    }
    const effective = <K extends keyof CampSettings>(key: K): CampSettings[K] =>
      (key in patch ? patch[key] : settings[key]) as CampSettings[K];
    if (
      !errors.duplicateLookalikeScore &&
      !errors.duplicateSuspectedScore &&
      effective("duplicateLookalikeScore") >= effective("duplicateSuspectedScore")
    )
      errors.duplicateLookalikeScore = t("camp.settings.lookalikeError");
    if (
      !errors.mentoringWindowStart &&
      !errors.mentoringWindowEnd &&
      effective("mentoringWindowStart") >= effective("mentoringWindowEnd")
    )
      errors.mentoringWindowEnd = t("camp.settings.windowError");
    const labels = effective("roleLabels");
    if (ENABLER_ROLES.some((role) => !labels[role].length))
      errors.roleLabels = t("camp.settings.labelsEmpty");
    // The server's own schema has the last word.
    const parsed = campSettingsPatchSchema.safeParse(patch);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "") as keyof CampSettings;
        if (key && !errors[key]) errors[key] = t("camp.settings.invalid");
      }
    }
    return { patch, errors };
  }, [edits, settings, t]);

  const changeCount = Object.keys(patch).length;
  const errorCount = Object.keys(errors).length;

  const save = async () => {
    if (errorCount || !changeCount) return;
    setSaving(true);
    try {
      await saveSettings(patch);
      await invalidate();
      setEdits({});
      toast.success(t("camp.settings.savedCount", { count: changeCount }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (key: keyof CampSettings) =>
    errors[key] ? <p className="text-xs text-[var(--destructive)]">{errors[key]}</p> : null;

  const recipients = value("alertRecipientIds");
  const recipientSet = new Set(recipients);
  const channels = connection.data?.channels ?? [];
  const accountName = (id: string) => accounts.find((a) => a.swUserId === id)?.name ?? id;

  return (
    <div className="space-y-6">
      {loaded && !admin ? <ToneBox tone="muted">{t("camp.settings.adminOnly")}</ToneBox> : null}

      <Section
        title={t("camp.settings.recipientsTitle")}
        description={t("camp.settings.recipientsHint")}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {recipients.length ? (
              recipients.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pe-1 ps-2.5 text-xs"
                >
                  <span dir="auto">{accountName(id)}</span>
                  {admin ? (
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        set(
                          "alertRecipientIds",
                          recipients.filter((x) => x !== id),
                        )
                      }
                      aria-label={t("camp.settings.removeValue", { value: accountName(id) })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </span>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">
                {t("camp.settings.noRecipients")}
              </span>
            )}
          </div>
          {admin && recipients.length < 30 ? (
            <AccountPicker
              accounts={accounts}
              value={null}
              exclude={recipientSet}
              onSelect={(id) => {
                if (id && !recipientSet.has(id)) set("alertRecipientIds", [...recipients, id]);
              }}
              placeholder={t("camp.settings.addRecipient")}
              loading={directory.isPending}
            />
          ) : null}
          {fieldError("alertRecipientIds")}
        </div>
      </Section>

      {SECTIONS.map((section) => (
        <Section
          key={section.id}
          title={t(`camp.settings.section.${section.id}` as MessageKey)}
          description={t(`camp.settings.sectionHint.${section.id}` as MessageKey)}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {section.fields.map((field) => {
              const id = `camp-setting-${field.key}`;
              const label = t(`camp.settings.field.${field.key}` as MessageKey);
              const help = t(`camp.settings.help.${field.key}` as MessageKey);
              if (field.kind === "switch") {
                return (
                  <div key={field.key} className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                    <label className="flex items-center gap-2 text-sm font-medium" htmlFor={id}>
                      <Switch
                        id={id}
                        checked={value(field.key)}
                        disabled={!admin}
                        onCheckedChange={(v) => set(field.key, v)}
                      />
                      {label}
                    </label>
                    <p className="text-xs text-muted-foreground">{help}</p>
                  </div>
                );
              }
              return (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={id}>{label}</Label>
                  <div className="flex items-center gap-2">
                    {field.kind === "number" ? (
                      <Input
                        id={id}
                        inputMode="numeric"
                        dir="ltr"
                        className="w-28"
                        value={numText(field)}
                        disabled={!admin}
                        onChange={(e) => set(field.key, e.target.value)}
                        aria-invalid={!!errors[field.key]}
                      />
                    ) : (
                      <Input
                        id={id}
                        type={field.kind === "time" ? "time" : "date"}
                        dir="ltr"
                        className="w-40"
                        value={String(value(field.key))}
                        disabled={!admin}
                        onChange={(e) => set(field.key, e.target.value)}
                        aria-invalid={!!errors[field.key]}
                      />
                    )}
                    {field.kind === "number" ? (
                      <span className="text-xs text-muted-foreground">
                        {t(`camp.settings.unit.${field.unit}` as MessageKey)} ·{" "}
                        <span dir="ltr">
                          {field.min}–{field.max}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{help}</p>
                  {fieldError(field.key)}
                </div>
              );
            })}
          </div>
        </Section>
      ))}

      <Section
        title={t("camp.settings.expectedTitle")}
        description={t("camp.settings.expectedHint")}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PARTICIPANT_AND_ENABLERS.map((role) => {
            const current = value("expectedAccountTypes")[role];
            return (
              <div key={role} className="space-y-1.5">
                <Label>{t(ROLE_KEY[role])}</Label>
                <Select
                  value={current ?? NO_CHANNEL}
                  disabled={!admin}
                  onValueChange={(v) =>
                    set("expectedAccountTypes", {
                      ...value("expectedAccountTypes"),
                      [role]: v === NO_CHANNEL ? null : (v as AccountType),
                    })
                  }
                >
                  <SelectTrigger className="w-full sm:w-56" aria-label={t(ROLE_KEY[role])}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CHANNEL}>{t("camp.settings.notSet")}</SelectItem>
                    {ACCOUNT_TYPES.map((x) => (
                      <SelectItem key={x} value={x}>
                        {t(ACCOUNT_TYPE_KEY[x])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title={t("camp.settings.labelsTitle")}
        description={t("camp.settings.labelsHint")}
        actions={
          admin ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                set("roleLabels", DEFAULT_ROLE_LABELS);
                set("honorifics", [...DEFAULT_HONORIFICS]);
              }}
            >
              <RotateCcw className="me-1 h-4 w-4" />
              {t("camp.settings.restoreDefaults")}
            </Button>
          ) : null
        }
      >
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">{t("camp.col.role")}</TableHead>
                  <TableHead>{t("camp.settings.acceptedLabels")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ENABLER_ROLES.map((role: EnablerRole) => (
                  <TableRow key={role}>
                    <TableCell className="align-top font-medium">{t(ROLE_KEY[role])}</TableCell>
                    <TableCell>
                      <ChipListEditor
                        values={value("roleLabels")[role]}
                        disabled={!admin}
                        addLabel={t("camp.settings.add")}
                        placeholder={t("camp.settings.labelPlaceholder")}
                        maxLength={60}
                        onChange={(next) =>
                          set("roleLabels", { ...value("roleLabels"), [role]: next })
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {fieldError("roleLabels")}
          <div className="space-y-1.5">
            <Label>{t("camp.settings.honorifics")}</Label>
            <p className="text-xs text-muted-foreground">{t("camp.settings.honorificsHint")}</p>
            <ChipListEditor
              values={value("honorifics")}
              disabled={!admin}
              addLabel={t("camp.settings.add")}
              maxLength={30}
              onChange={(next) => set("honorifics", next)}
            />
          </div>
        </div>
      </Section>

      <Section
        title={t("camp.settings.channelsTitle")}
        description={t("camp.settings.channelsHint")}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="camp-setting-announcement">
              {t("camp.settings.field.announcementChannelId")}
            </Label>
            <ChannelField
              id="camp-setting-announcement"
              value={value("announcementChannelId")}
              channels={channels}
              disabled={!admin}
              emptyLabel={t("camp.settings.defaultChannel")}
              onChange={(v) => set("announcementChannelId", v)}
            />
            <p className="text-xs text-muted-foreground">
              {t("camp.settings.help.announcementChannelId")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-setting-summary">
              {t("camp.settings.field.summaryChannelId")}
            </Label>
            <ChannelField
              id="camp-setting-summary"
              value={value("summaryChannelId")}
              channels={channels.filter((c) => c.type === "private")}
              disabled={!admin}
              emptyLabel={t("camp.settings.notSet")}
              onChange={(v) => set("summaryChannelId", v)}
            />
            <p className="text-xs text-muted-foreground">
              {t("camp.settings.help.summaryChannelId")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-setting-zone">{t("camp.settings.field.mainHallZoneId")}</Label>
            <Input
              id="camp-setting-zone"
              dir="ltr"
              className="font-mono"
              maxLength={120}
              value={value("mainHallZoneId")}
              disabled={!admin}
              onChange={(e) => set("mainHallZoneId", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("camp.settings.help.mainHallZoneId")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-setting-admin-url">
              {t("camp.settings.field.soworkAdminUrl")}
            </Label>
            <Input
              id="camp-setting-admin-url"
              dir="ltr"
              type="url"
              value={value("soworkAdminUrl")}
              disabled={!admin}
              onChange={(e) => set("soworkAdminUrl", e.target.value)}
              aria-invalid={!!errors.soworkAdminUrl}
            />
            <p className="text-xs text-muted-foreground">
              {t("camp.settings.help.soworkAdminUrl")}
            </p>
            {fieldError("soworkAdminUrl")}
          </div>
        </div>
      </Section>

      {admin && (changeCount || errorCount) ? (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
          <span className="text-sm">
            {errorCount ? (
              <span className="text-[var(--destructive)]">
                {t("camp.settings.fixErrors", { count: errorCount })}
              </span>
            ) : (
              t("camp.settings.unsaved", { count: changeCount })
            )}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEdits({})}>
              {t("camp.settings.discard")}
            </Button>
            <Button
              size="sm"
              disabled={saving || errorCount > 0 || !changeCount}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="me-1 h-4 w-4" />
              )}
              {t("camp.btn.save")}
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ChannelField({
  id,
  value,
  channels,
  disabled,
  emptyLabel,
  onChange,
}: {
  id: string;
  value: string;
  channels: { id: string; name?: string; type: "public" | "private" }[];
  disabled: boolean;
  emptyLabel: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  // Without a channel list (connection not checked, or not an admin) the id is typed.
  if (!channels.length) {
    return (
      <Input
        id={id}
        dir="ltr"
        className="font-mono"
        maxLength={64}
        value={value}
        placeholder={emptyLabel}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.trim())}
      />
    );
  }
  const known = channels.some((c) => c.id === value);
  return (
    <Select
      value={value || NO_CHANNEL}
      disabled={disabled}
      onValueChange={(v) => onChange(v === NO_CHANNEL ? "" : v)}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CHANNEL}>{emptyLabel}</SelectItem>
        {value && !known ? (
          <SelectItem value={value}>
            <span dir="ltr">{value}</span>
          </SelectItem>
        ) : null}
        {channels.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span dir="auto">#{c.name || c.id}</span>
            <span className="ms-2 text-xs text-muted-foreground">
              {c.type === "private" ? t("camp.settings.private") : t("camp.settings.public")}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Audit log (FR-USR-11)
// ---------------------------------------------------------------------------

type AuditRow = Awaited<ReturnType<typeof listCampAudit>>[number];

function actionKey(action: string): MessageKey | null {
  const key = `camp.settings.audit.${action}`;
  return isMessageKey(key) ? key : null;
}

function detailSummary(detail: AuditRow["detail"]): string {
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

function AuditSection() {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const fn = useServerFn(listCampAudit);
  const query = useQuery({
    queryKey: campKey("audit", 200),
    queryFn: () => fn({ data: { limit: 200 } }),
  });
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string>("all");
  const all = query.data ?? [];
  const groups = [...new Set(all.map((r) => r.action.split(".")[0] ?? r.action))].sort();
  const label = (action: string) => {
    const key = actionKey(action);
    return key ? t(key) : action;
  };
  const rows = all
    .filter((r) => group === "all" || r.action.split(".")[0] === group)
    .filter((r) =>
      matchesSearch(search, [r.actor, r.action, label(r.action), detailSummary(r.detail)]),
    );

  const exportRows = async () => {
    await ensureLocaleDict("ar");
    await downloadWorkbook("سجل العمليات", [
      {
        name: "سجل العمليات",
        headers: ["الوقت", "المستخدم", "العملية", "عدد المستهدفين", "التفاصيل"],
        rows: rows.map((r) => {
          const key = actionKey(r.action);
          const ms = Date.parse(r.createdAt);
          return [
            `${formatDateAr(riyadhDate(ms))} ${formatTimeAr(ms)}`,
            r.actor,
            key ? tFor("ar", key) : r.action,
            r.targets.length,
            detailSummary(r.detail),
          ];
        }),
      },
    ]);
  };

  return (
    <Section
      title={t("camp.settings.auditTitle")}
      description={t("camp.settings.auditHint")}
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={!rows.length}
          onClick={() => void exportRows()}
        >
          <Download className="me-1 h-4 w-4" />
          {t("camp.btn.exportExcel")}
        </Button>
      }
    >
      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder={t("camp.settings.auditSearch")}
            />
            <FilterSelect
              label={t("camp.settings.auditAction")}
              value={group}
              onChange={setGroup}
              options={groups.map((g) => {
                const key = `camp.settings.auditGroup.${g}`;
                return { value: g, label: isMessageKey(key) ? t(key) : g };
              })}
            />
          </div>
          <div className="max-h-[32rem] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("camp.common.time")}</TableHead>
                  <TableHead>{t("camp.settings.auditActor")}</TableHead>
                  <TableHead>{t("camp.settings.auditAction")}</TableHead>
                  <TableHead>{t("camp.settings.auditTargets")}</TableHead>
                  <TableHead>{t("camp.settings.auditDetail")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const summary = detailSummary(r.detail);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {fmt.dateTime(r.createdAt)}
                      </TableCell>
                      <TableCell
                        className="max-w-48 truncate text-xs"
                        dir="ltr"
                        title={r.actor ?? ""}
                      >
                        {r.actor ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="block text-sm">{label(r.action)}</span>
                        <span className="block font-mono text-xs text-muted-foreground" dir="ltr">
                          {r.action}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">{r.targets.length}</TableCell>
                      <TableCell
                        className="max-w-md truncate text-xs text-muted-foreground"
                        dir="auto"
                        title={summary}
                      >
                        {summary || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!rows.length ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {all.length ? t("camp.common.noResults") : t("camp.settings.auditEmpty")}
              </p>
            ) : null}
          </div>
        </div>
      </QueryState>
    </Section>
  );
}
