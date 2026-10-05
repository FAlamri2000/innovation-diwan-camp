/**
 * Camp operations — نظرة عامة (overview).
 *
 * The six cards of §11, today's sessions, open operations alerts, and the
 * health of the SoWork feed (M10). Refreshes every minute.
 */
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellRing, Check, Loader2, Radio, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/ui/query-state";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { getCampOverview } from "@/lib/camp-read.functions";
import { acknowledgeCampAlerts } from "@/lib/camp-actions.functions";
import { runCampSyncNow } from "@/lib/camp-admin.functions";
import {
  campKey,
  errorMessage,
  PageTitle,
  SESSION_TYPE_KEY,
  StaleBanner,
  StatCard,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
} from "../camp-ui";

export function OverviewView() {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const fn = useServerFn(getCampOverview);
  const query = useQuery({
    queryKey: campKey("overview"),
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });
  const syncFn = useServerFn(runCampSyncNow);
  const ackFn = useServerFn(acknowledgeCampAlerts);
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: (res) => {
      if (res.skipped === "busy") toast.info(t("camp.sync.busy"));
      else if (res.skipped === "not_configured") toast.error(t("camp.sync.notConfigured"));
      else if (res.errors.length)
        toast.warning(t("camp.sync.partial", { errors: res.errors.join(" · ") }));
      else toast.success(t("camp.sync.done"));
      void invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const ack = useMutation({
    mutationFn: (ids: string[]) => ackFn({ data: { ids } }),
    onSuccess: () => void invalidate(),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const d = query.data;

  return (
    <div className="space-y-6">
      <PageTitle
        title={t("camp.nav.overview")}
        description={
          d
            ? t("camp.overview.dayOf", {
                day: d.campDay,
                total: d.dayCount,
                date: fmt.date(d.today),
              })
            : undefined
        }
        actions={
          edit ? (
            <Button
              variant="outline"
              size="sm"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="me-1 h-4 w-4" />
              )}
              {t("camp.btn.refreshNow")}
            </Button>
          ) : null
        }
      />
      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        skeletonRows={6}
      >
        {d ? (
          <>
            <StaleBanner minutes={d.sync.minutesSinceRefresh} configured={d.sync.configured} />
            {d.sync.configured && !d.sync.subscriptionId ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <span className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {t("camp.sync.noSubscription")}
                </span>
                <Button asChild size="sm" variant="outline">
                  <Link to="/settings">{t("camp.nav.settings")}</Link>
                </Button>
              </div>
            ) : null}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label={t("camp.overview.participantRate")}
                value={fmt.percent(d.cards.participantRate.rate)}
                hint={t("camp.overview.attendedOf", {
                  attended: d.cards.participantRate.attended,
                  expected: d.cards.participantRate.expected,
                })}
              />
              <StatCard
                label={t("camp.overview.enablerRate")}
                value={fmt.percent(d.cards.enablerRate.rate)}
                hint={t("camp.overview.attendedOf", {
                  attended: d.cards.enablerRate.attended,
                  expected: d.cards.enablerRate.expected,
                })}
              />
              <StatCard
                label={t("camp.overview.guiderCoverage")}
                value={
                  d.cards.guiderCoverage.total
                    ? `${d.cards.guiderCoverage.covered} / ${d.cards.guiderCoverage.total}`
                    : "—"
                }
              />
              <StatCard
                label={t("camp.overview.namingViolations")}
                value={d.cards.namingViolations}
                tone={d.cards.namingViolations ? "bad" : "good"}
              />
              <StatCard
                label={t("camp.overview.openDuplicates")}
                value={d.cards.openDuplicates}
                tone={d.cards.openDuplicates ? "warn" : "good"}
              />
              <StatCard
                label={t("camp.overview.presentNow")}
                value={d.cards.onlineNow}
                hint={t("camp.overview.inMeetingsNow", { count: d.cards.inMeetingsNow })}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">{t("camp.overview.sessionsNow")}</h3>
                {d.currentSessions.length ? (
                  <ul className="space-y-2">
                    {d.currentSessions.map((s) => (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <span>{s.title}</span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ToneBadge tone={s.counted ? "info" : "muted"}>
                            {t(SESSION_TYPE_KEY[s.type])}
                          </ToneBadge>
                          {fmt.time(s.start)} – {fmt.time(s.end)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("camp.overview.noSessionNow")}</p>
                )}
                {d.nextSession ? (
                  <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                    {t("camp.overview.next", {
                      title: d.nextSession.title,
                      date: fmt.date(d.nextSession.start),
                      time: fmt.time(d.nextSession.start),
                    })}
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">{t("camp.overview.feed")}</h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t("camp.sync.lastRefresh")}</dt>
                  <dd>{fmt.dateTime(d.sync.lastTickAt)}</dd>
                  <dt className="text-muted-foreground">{t("camp.sync.lastEvent")}</dt>
                  <dd>{fmt.dateTime(d.sync.lastEventAt)}</dd>
                  <dt className="text-muted-foreground">{t("camp.sync.events")}</dt>
                  <dd className="tabular-nums">{d.sync.counts.events}</dd>
                  <dt className="text-muted-foreground">{t("camp.sync.meetings")}</dt>
                  <dd className="tabular-nums">{d.sync.counts.meetings}</dd>
                  <dt className="text-muted-foreground">{t("camp.sync.accounts")}</dt>
                  <dd className="tabular-nums">{d.sync.counts.accounts}</dd>
                  <dt className="text-muted-foreground">{t("camp.sync.sending")}</dt>
                  <dd>
                    <ToneBadge tone={d.sync.sendingEnabled ? "good" : "muted"}>
                      {d.sync.sendingEnabled ? t("camp.sync.sendingOn") : t("camp.sync.sendingOff")}
                    </ToneBadge>
                  </dd>
                </dl>
                {d.sync.lastTickErrors.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground" dir="ltr">
                    {d.sync.lastTickErrors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <BellRing className="h-4 w-4" aria-hidden />
                  {t("camp.overview.alerts")}
                </h3>
                <div className="flex gap-2">
                  {edit && d.alerts.length ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ack.isPending}
                      onClick={() => ack.mutate(d.alerts.map((a) => a.id))}
                    >
                      <Check className="me-1 h-4 w-4" />
                      {t("camp.alerts.ackAll")}
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <Link to="/notifications">{t("camp.nav.notifications")}</Link>
                  </Button>
                </div>
              </div>
              {d.alerts.length ? (
                <ul className="divide-y">
                  {d.alerts.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <ToneBadge tone={a.code === "A09" ? "info" : "warn"}>{a.code}</ToneBadge>
                        <span>{t(`camp.alert.${a.code}` as MessageKey)}</span>
                        <AlertDetail detail={a.detail} />
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {fmt.dateTime(a.createdAt)}
                        {edit ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => ack.mutate([a.id])}
                            aria-label={t("camp.alerts.ack")}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("camp.alerts.none")}</p>
              )}
            </section>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}

/** The few detail fields worth a glance in a list row. */
export function AlertDetail({ detail }: { detail: Record<string, unknown> }) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (typeof detail.session === "string") parts.push(detail.session);
  if (typeof detail.teamNo === "number") parts.push(t("camp.common.teamN", { n: detail.teamNo }));
  if (typeof detail.guider === "string") parts.push(detail.guider);
  if (typeof detail.name === "string") parts.push(detail.name);
  if (typeof detail.a === "string" && typeof detail.b === "string")
    parts.push(`${detail.a} / ${detail.b}`);
  if (typeof detail.percent === "number") parts.push(`${detail.percent}%`);
  if (typeof detail.participantRate === "number")
    parts.push(`${t("camp.overview.participantRate")} ${detail.participantRate}%`);
  if (!parts.length) return null;
  return (
    <span className="text-muted-foreground" dir="auto">
      {parts.join(" · ")}
    </span>
  );
}
