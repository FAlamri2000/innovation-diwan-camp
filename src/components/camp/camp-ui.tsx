/**
 * Camp operations — shared client pieces: data hooks, formatting, badges,
 * search, and the dialogs every screen reuses (reason, bulk send, recording).
 *
 * Times are always Riyadh time (BR-ATT-05), 12-hour with مساءً / ظهرًا, and
 * dates read "5 أكتوبر 2026" (FR-UI-03), with Western digits in both languages.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Film, Loader2, PlayCircle, Search, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/i18n/use-translation";
import { isMessageKey, t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { RAG_COLORS, type RagTone } from "@/lib/rag-colors";
import { getCampAbilities, sendCampMessage } from "@/lib/camp-admin.functions";
import { getCampMessaging } from "@/lib/camp-read.functions";
import { getCampRecordingUrl } from "@/lib/camp-actions.functions";
import {
  compareNames,
  formatClockAr,
  formatClockEn,
  formatDateAr,
  formatDateEn,
  nameTokens,
  riyadhDate,
  riyadhParts,
} from "@/lib/camp/text";
import type {
  AccountType,
  AttStatus,
  DuplicateLevel,
  EventRole,
  MatchState,
  NamingStatus,
  SessionType,
} from "@/lib/camp/types";

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

export const campKey = (...parts: unknown[]): QueryKey => ["camp", ...parts];

/** Server functions throw plain Errors; surface the message, never "[object Object]". */
/** A server error's message, translated when it is one of ours: dictionary
 *  keys (auth.error.*, users.error.*) and the guards' Unauthorized/Forbidden. */
export function errorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
  if (isMessageKey(raw)) return t(raw);
  if (raw.startsWith("Unauthorized")) return t("app.error.signedOut");
  if (raw.startsWith("Forbidden")) return t("app.error.forbidden");
  return raw;
}

export function useCampAbilities() {
  const fn = useServerFn(getCampAbilities);
  const query = useQuery({
    queryKey: campKey("abilities"),
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  return { edit: !!query.data?.edit, admin: !!query.data?.admin, loaded: !!query.data };
}

/** Invalidate every camp query after a write: the model is one derivation. */
export function useInvalidateCamp() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["camp"] });
}

// ---------------------------------------------------------------------------
// Formatting (FR-UI-03)
// ---------------------------------------------------------------------------

export function useCampFormat() {
  const { locale } = useTranslation();
  const ar = locale === "ar";
  return useMemo(() => {
    const time = (value: number | string | null | undefined): string => {
      if (value === null || value === undefined || value === "") return "—";
      const ms = typeof value === "number" ? value : Date.parse(value);
      if (!Number.isFinite(ms)) return "—";
      const p = riyadhParts(ms);
      return ar ? formatClockAr(p.hour, p.minute) : formatClockEn(p.hour, p.minute);
    };
    const date = (value: string | number | null | undefined): string => {
      if (value === null || value === undefined || value === "") return "—";
      const d =
        typeof value === "number"
          ? riyadhDate(value)
          : value.length > 10
            ? riyadhDate(Date.parse(value))
            : value;
      return ar ? formatDateAr(d) : formatDateEn(d);
    };
    const dateTime = (value: number | string | null | undefined): string =>
      value === null || value === undefined || value === "" ? "—" : `${date(value)} ${time(value)}`;
    const hhmm = (value: string): string => {
      const [h, m] = value.split(":").map(Number);
      return ar ? formatClockAr(h ?? 0, m ?? 0) : formatClockEn(h ?? 0, m ?? 0);
    };
    const minutes = (value: number | null | undefined): string => {
      if (value === null || value === undefined) return "—";
      if (value < 60) return ar ? `${value} د` : `${value} min`;
      const h = Math.floor(value / 60);
      const m = value % 60;
      return ar ? `${h} س ${m} د` : `${h} h ${m} min`;
    };
    const percent = (value: number | null | undefined): string =>
      value === null || value === undefined ? "—" : `${value}%`;
    return { time, date, dateTime, hhmm, minutes, percent, ar };
  }, [ar]);
}

// ---------------------------------------------------------------------------
// Labels and badges
// ---------------------------------------------------------------------------

export const ROLE_KEY: Record<EventRole, MessageKey> = {
  participant: "camp.role.participant",
  guider: "camp.role.guider",
  coach: "camp.role.coach",
  expert: "camp.role.expert",
  speaker: "camp.role.speaker",
  supervisor: "camp.role.supervisor",
  unknown: "camp.role.unknown",
};

export const ACCOUNT_TYPE_KEY: Record<AccountType, MessageKey> = {
  admin: "camp.accountType.admin",
  teammate: "camp.accountType.teammate",
  guest: "camp.accountType.guest",
};

export const NAMING_KEY: Record<NamingStatus, MessageKey> = {
  ok: "camp.status.namingOk",
  note: "camp.status.namingNote",
  violation: "camp.status.namingViolation",
};

export const ATT_KEY: Record<AttStatus, MessageKey> = {
  present: "camp.status.present",
  partial: "camp.status.partial",
  absent: "camp.status.absent",
  elsewhere: "camp.status.elsewhere",
  off_platform: "camp.status.offPlatform",
  not_expected: "camp.status.notExpected",
};

export const DUP_KEY: Record<DuplicateLevel, MessageKey> = {
  confirmed: "camp.status.dupConfirmed",
  suspected: "camp.status.dupSuspected",
  lookalike: "camp.status.lookalike",
};

export const MATCH_KEY: Record<MatchState, MessageKey> = {
  linked: "camp.match.linked",
  candidate: "camp.match.candidate",
  not_in_registry: "camp.match.notInRegistry",
  no_account: "camp.status.notOnPlatform",
};

export const SESSION_TYPE_KEY: Record<SessionType, MessageKey> = {
  workshop: "camp.sessionType.workshop",
  mentoring: "camp.sessionType.mentoring",
  checkpoint: "camp.sessionType.checkpoint",
  inspirational: "camp.sessionType.inspirational",
  pitch_coaching: "camp.sessionType.pitchCoaching",
  judging: "camp.sessionType.judging",
  break: "camp.sessionType.break",
  zoom: "camp.sessionType.zoom",
  transition: "camp.sessionType.transition",
  other: "camp.sessionType.other",
};

/**
 * Status colours come from the platform's one RAG set (lib/rag-colors.ts),
 * never a raw value here (§7); "info" is the brand primary.
 */
export type Tone = "good" | "warn" | "bad" | "info" | "muted";
const TONE_RAG: Record<Exclude<Tone, "info">, RagTone> = {
  good: "green",
  warn: "amber",
  bad: "red",
  muted: "neutral",
};

export function toneColor(tone: Tone): string {
  return tone === "info" ? "var(--primary)" : RAG_COLORS[TONE_RAG[tone]];
}

export function ToneBadge({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  const color = toneColor(tone);
  return (
    <Badge
      variant="outline"
      className={cn("whitespace-nowrap border-transparent font-normal text-foreground", className)}
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 35%, transparent)`,
      }}
    >
      {children}
    </Badge>
  );
}

export function NamingBadge({ status }: { status: NamingStatus }) {
  const { t } = useTranslation();
  const tone: Tone = status === "ok" ? "good" : status === "note" ? "warn" : "bad";
  return <ToneBadge tone={tone}>{t(NAMING_KEY[status])}</ToneBadge>;
}

export function AttBadge({
  status,
  late,
  minutes,
}: {
  status: AttStatus;
  late?: boolean;
  minutes?: number;
}) {
  const { t } = useTranslation();
  const tone: Tone =
    status === "present"
      ? "good"
      : status === "partial"
        ? "warn"
        : status === "absent"
          ? "bad"
          : status === "elsewhere"
            ? "info"
            : "muted";
  return (
    <span className="inline-flex items-center gap-1">
      <ToneBadge tone={tone}>
        {t(ATT_KEY[status])}
        {minutes !== undefined && minutes > 0 && status !== "off_platform" ? ` · ${minutes}` : ""}
      </ToneBadge>
      {late ? <ToneBadge tone="warn">{t("camp.status.late")}</ToneBadge> : null}
    </span>
  );
}

export function DupBadge({ level }: { level: DuplicateLevel }) {
  const { t } = useTranslation();
  return (
    <ToneBadge tone={level === "confirmed" ? "bad" : level === "suspected" ? "warn" : "muted"}>
      {t(DUP_KEY[level])}
    </ToneBadge>
  );
}

export function MatchBadge({ state }: { state: MatchState }) {
  const { t } = useTranslation();
  const tone: Tone = state === "linked" ? "good" : state === "candidate" ? "warn" : "muted";
  return <ToneBadge tone={tone}>{t(MATCH_KEY[state])}</ToneBadge>;
}

export function AccountTypeBadge({
  type,
  expected,
}: {
  type: AccountType | null;
  expected?: AccountType | null;
}) {
  const { t } = useTranslation();
  if (!type) return <ToneBadge tone="muted">{t("camp.status.notOnPlatform")}</ToneBadge>;
  const mismatch = !!expected && expected !== type;
  return (
    <ToneBadge tone={mismatch ? "warn" : "muted"}>
      {t(ACCOUNT_TYPE_KEY[type])}
      {mismatch ? ` → ${t(ACCOUNT_TYPE_KEY[expected!])}` : ""}
    </ToneBadge>
  );
}

export function PresenceDot({ presence }: { presence: string | null }) {
  const { t } = useTranslation();
  const color = toneColor(
    presence === "available"
      ? "good"
      : presence === "busy"
        ? "bad"
        : presence === "away"
          ? "warn"
          : "muted",
  );
  const label =
    presence === "available"
      ? t("camp.presence.available")
      : presence === "busy"
        ? t("camp.presence.busy")
        : presence === "away"
          ? t("camp.presence.away")
          : t("camp.presence.offline");
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Search (FR-USR-03): spelling variants and both scripts
// ---------------------------------------------------------------------------

/** True when any haystack entry matches the query by substring after
 *  normalization, or by name similarity across scripts (Mohammad ≈ محمد). */
export function matchesSearch(
  query: string,
  haystack: readonly (string | number | null | undefined)[],
): boolean {
  const q = query.trim();
  if (!q) return true;
  const qTokens = nameTokens(q).join(" ");
  const raw = q.toLowerCase();
  for (const item of haystack) {
    if (item === null || item === undefined) continue;
    const text = String(item);
    if (text.toLowerCase().includes(raw)) return true;
    const tokens = nameTokens(text).join(" ");
    if (qTokens && tokens.includes(qTokens)) return true;
    if (qTokens.length >= 3 && /\p{L}/u.test(text) && compareNames(q, text).score >= 85)
      return true;
  }
  return false;
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t("camp.common.search")}
        className="ps-8"
        aria-label={placeholder ?? t("camp.common.search")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function PageTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? (
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className="mt-1 text-2xl font-semibold tabular-nums"
        style={tone && tone !== "muted" ? { color: toneColor(tone) } : undefined}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A plain filter <Select> with an "all" option. */
export function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | "all";
  onChange: (v: T | "all") => void;
  options: { value: T; label: string }[];
}) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T | "all")}>
      <SelectTrigger className="h-9 w-auto min-w-36" aria-label={label}>
        <span className="me-1 text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("camp.common.all")}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Reason dialog (FR-USR-05, FR-ATT-09, M12)
// ---------------------------------------------------------------------------

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onSubmit: (reason: string) => Promise<void> | void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason("");
          setError(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <div className="space-y-1.5">
          <Label htmlFor="camp-reason">{t("camp.common.reason")}</Label>
          <Textarea
            id="camp-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setError(false);
            }}
            rows={3}
            aria-invalid={error}
          />
          {error ? <p className="text-xs text-[var(--destructive)]">{t("camp.msg.M12")}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("camp.btn.cancel")}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (reason.trim().length < 2) {
                setError(true);
                return;
              }
              setBusy(true);
              try {
                await onSubmit(reason.trim());
                setReason("");
                onOpenChange(false);
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : null}
            {confirmLabel ?? t("camp.btn.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bulk message (FR-USR-06, FR-NAM-05) with M03 / M04 / M05
// ---------------------------------------------------------------------------

export function SendMessageDialog({
  open,
  onOpenChange,
  swUserIds,
  defaultTemplate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  swUserIds: string[];
  defaultTemplate?: string;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateCamp();
  const messagingFn = useServerFn(getCampMessaging);
  const sendFn = useServerFn(sendCampMessage);
  const messaging = useQuery({
    queryKey: campKey("messaging"),
    queryFn: () => messagingFn(),
    enabled: open,
  });
  const [templateKey, setTemplateKey] = useState<string>(defaultTemplate ?? "M01");
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const templates = (messaging.data?.templates ?? []).filter((x) =>
    ["M01", "M02", "P05", "P06"].includes(x.key),
  );
  const preview =
    templateKey === "custom" ? text : (templates.find((x) => x.key === templateKey)?.text ?? "");
  const send = useMutation({
    mutationFn: () =>
      sendFn({
        data: {
          swUserIds,
          templateKey: templateKey === "custom" ? null : templateKey,
          text: templateKey === "custom" ? text : null,
        },
      }),
    onSuccess: (res) => {
      if (res.failed > 0) toast.warning(t("camp.msg.M05", { count: res.failed }));
      else toast.success(t("camp.msg.M04", { count: res.delivered }));
      void invalidate();
      setConfirming(false);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setConfirming(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("camp.btn.sendMessage")}</DialogTitle>
          <DialogDescription>
            {t("camp.send.recipients", { count: swUserIds.length })}
          </DialogDescription>
        </DialogHeader>
        {confirming ? (
          <p className="rounded-md border bg-muted/40 p-3 text-sm">
            {t("camp.msg.M03", { count: swUserIds.length })}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("camp.send.template")}</Label>
              <Select value={templateKey} onValueChange={setTemplateKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((x) => (
                    <SelectItem key={x.key} value={x.key}>
                      {x.key} · {t(`camp.template.${x.key}` as MessageKey)}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">{t("camp.send.custom")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {templateKey === "custom" ? (
              <div className="space-y-1.5">
                <Label htmlFor="camp-custom-text">{t("camp.send.text")}</Label>
                <Textarea
                  id="camp-custom-text"
                  dir="auto"
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("camp.send.placeholders")}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{t("camp.send.preview")}</Label>
                <p
                  dir="rtl"
                  className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm leading-relaxed"
                >
                  {preview || "—"}
                </p>
                {templateKey === "M01" || templateKey === "M02" ? (
                  <p className="text-xs text-muted-foreground">{t("camp.send.namingHint")}</p>
                ) : null}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => (confirming ? setConfirming(false) : onOpenChange(false))}
          >
            {t("camp.btn.cancel")}
          </Button>
          <Button
            disabled={
              send.isPending || !swUserIds.length || (templateKey === "custom" && !text.trim())
            }
            onClick={() => (confirming ? send.mutate() : setConfirming(true))}
          >
            {send.isPending ? (
              <Loader2 className="me-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="me-1 h-4 w-4" />
            )}
            {confirming ? t("camp.btn.confirmSend") : t("camp.btn.sendMessage")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Recording link (FR-REC-03/04): fetched on click, never stored
// ---------------------------------------------------------------------------

export function RecordingButton({
  meetingId,
  deepLink,
  hasRecording,
  compact,
}: {
  meetingId: string;
  deepLink: string | null;
  hasRecording: boolean | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const fn = useServerFn(getCampRecordingUrl);
  const [busy, setBusy] = useState(false);
  if (!deepLink && !hasRecording) {
    return compact ? (
      <span className="text-xs text-muted-foreground">—</span>
    ) : (
      <span className="text-xs text-muted-foreground">{t("camp.msg.M09")}</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      {hasRecording ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={busy}
          onClick={async () => {
            // Open the tab synchronously so the popup blocker allows it, then
            // point it at the signed link once the server returns one.
            const win = window.open("about:blank", "_blank");
            setBusy(true);
            try {
              const res = await fn({ data: { meetingId } });
              const target = res.videoUrl ?? res.deepLink;
              if (target && win) win.location.href = target;
              else {
                win?.close();
                toast.info(t("camp.msg.M09"));
              }
            } catch (err) {
              win?.close();
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlayCircle className="h-3.5 w-3.5" />
          )}
          {compact ? null : <span className="ms-1">{t("camp.btn.viewRecording")}</span>}
        </Button>
      ) : null}
      {deepLink ? (
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          title={t("camp.recordings.openInSowork")}
        >
          <a href={deepLink} target="_blank" rel="noreferrer">
            {hasRecording ? (
              <ExternalLink className="h-3.5 w-3.5" />
            ) : (
              <Film className="h-3.5 w-3.5" />
            )}
          </a>
        </Button>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sync staleness (M10)
// ---------------------------------------------------------------------------

const WARN_BOX = {
  borderColor: `color-mix(in oklab, ${RAG_COLORS.amber} 55%, transparent)`,
  backgroundColor: `color-mix(in oklab, ${RAG_COLORS.amber} 10%, transparent)`,
};

export function StaleBanner({
  minutes,
  configured,
}: {
  minutes: number | null;
  configured: boolean;
}) {
  const { t } = useTranslation();
  if (!configured) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-md border p-3 text-sm" style={WARN_BOX}>
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: toneColor("warn") }}
          aria-hidden
        />
        {t("camp.sync.notConfigured")}
      </div>
    );
  }
  if (minutes === null || minutes < 3) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border p-3 text-sm" style={WARN_BOX}>
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color: toneColor("warn") }}
        aria-hidden
      />
      {t("camp.msg.M10", { minutes })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person profile (FR-USR-04): opened from any screen
// ---------------------------------------------------------------------------

type PersonCtx = { openPerson: (key: string) => void };
const PersonContext = createContext<PersonCtx>({ openPerson: () => {} });
export const PersonProvider = PersonContext.Provider;
export const usePersonSheet = () => useContext(PersonContext);

export function PersonLink({
  personKey,
  children,
  className,
}: {
  personKey: string;
  children: ReactNode;
  className?: string;
}) {
  const { openPerson } = usePersonSheet();
  return (
    <button
      type="button"
      className={cn(
        "text-start font-medium hover:underline focus-visible:underline focus-visible:outline-none",
        className,
      )}
      onClick={() => openPerson(personKey)}
    >
      {children}
    </button>
  );
}
