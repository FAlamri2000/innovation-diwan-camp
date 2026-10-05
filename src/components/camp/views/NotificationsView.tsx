/**
 * Camp operations — التنبيهات والتذكيرات (Module 6: notifications, alerts and
 * reminders).
 *
 *   التذكيرات المجدولة   S00–S23 cues: time, days, per-day on/off, text (FR-NOT-01..03, 07)
 *   الرسائل الشخصية      M01/M02 and P01–P07 templates, max per day (FR-NOT-04)
 *   تنبيهات التشغيل      A01–A09, reviewed by the team (FR-NOT-06)
 *   سجل الإرسال          everything sent, with retry for failed DMs (FR-NOT-05, M05)
 *   إرسال فوري           office-wide gong / announcement / channel post (admin)
 *
 * Nothing goes out automatically while the sending switch in Settings is off;
 * the banner says so on every tab.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/ui/query-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/i18n/use-translation";
import { listCampAlerts } from "@/lib/camp-read.functions";
import { campKey, PageTitle, toneColor, useCampAbilities } from "../camp-ui";
import { AlertsTab } from "./notifications/AlertsTab";
import { BroadcastPanel } from "./notifications/BroadcastPanel";
import { CuesTab } from "./notifications/CuesTab";
import { SendLogTab } from "./notifications/SendLogTab";
import { TemplatesTab } from "./notifications/TemplatesTab";
import { useMessaging } from "./notifications/lib";

export function NotificationsView() {
  const { t } = useTranslation();
  const { edit, admin } = useCampAbilities();
  const messaging = useMessaging();
  const alertsFn = useServerFn(listCampAlerts);
  // Same key as the alerts tab's default view, so the count and the list agree.
  const openAlerts = useQuery({
    queryKey: campKey("alerts", false),
    queryFn: () => alertsFn({ data: { includeAcknowledged: false } }),
    refetchInterval: 60_000,
  });
  const m = messaging.data;

  return (
    <div>
      <PageTitle title={t("camp.nav.notifications")} description={t("camp.notif.description")} />
      <QueryState
        isPending={messaging.isPending}
        isError={messaging.isError}
        error={messaging.error}
        onRetry={() => void messaging.refetch()}
        skeletonRows={8}
      >
        {m ? (
          <>
            {!m.sendingEnabled ? (
              <div
                role="status"
                className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm"
                style={{
                  borderColor: `color-mix(in oklab, ${toneColor("warn")} 55%, transparent)`,
                  backgroundColor: `color-mix(in oklab, ${toneColor("warn")} 12%, transparent)`,
                }}
              >
                <span className="flex items-start gap-2 font-medium">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: toneColor("warn") }}
                    aria-hidden
                  />
                  {t("camp.notif.sendingOff")}
                </span>
                {admin ? (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/settings">{t("camp.nav.settings")}</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
            {edit && !m.myAccount ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                <span className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {t("camp.notif.noAccount")}
                </span>
                <Button asChild size="sm" variant="outline">
                  <Link to="/settings">{t("camp.nav.settings")}</Link>
                </Button>
              </div>
            ) : null}

            <Tabs defaultValue="cues">
              <TabsList className="mb-4 h-auto flex-wrap justify-start">
                <TabsTrigger value="cues">
                  {t("camp.notif.tabCues")} ({m.cues.length})
                </TabsTrigger>
                <TabsTrigger value="personal">{t("camp.notif.tabPersonal")}</TabsTrigger>
                <TabsTrigger value="alerts">
                  {t("camp.overview.alerts")}
                  {openAlerts.data?.length ? ` (${openAlerts.data.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="log">{t("camp.notif.tabLog")}</TabsTrigger>
                {admin ? (
                  <TabsTrigger value="broadcast">{t("camp.notif.tabBroadcast")}</TabsTrigger>
                ) : null}
              </TabsList>
              <TabsContent value="cues">
                <CuesTab messaging={m} />
              </TabsContent>
              <TabsContent value="personal">
                <TemplatesTab messaging={m} />
              </TabsContent>
              <TabsContent value="alerts">
                <AlertsTab />
              </TabsContent>
              <TabsContent value="log">
                <SendLogTab />
              </TabsContent>
              {admin ? (
                <TabsContent value="broadcast">
                  <BroadcastPanel myAccount={m.myAccount} />
                </TabsContent>
              ) : null}
            </Tabs>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
