/**
 * Camp operations — الحضور (Module 4: attendance).
 *
 *   كشف الحضور اليومي        per person per day, one column per counted session (FR-ATT-05/06/09)
 *   كشف الحضور لفترة محددة    any session or time window (FR-ATT-07)
 *   الآن                     who is in which room now (FR-ATT-08)
 *   الملخص                   rates by group, team and role (FR-ATT-10..12, 15..17)
 *   الاجتماعات والغرف         room placement of every meeting (FR-ATT-04)
 *
 * A person attends a session with 10 minutes or more in its room inside its
 * window (BR-ATT-01); all times are Riyadh time (BR-ATT-05).
 */
import { useState } from "react";
import { CalendarX } from "lucide-react";
import { EmptyState, QueryState } from "@/components/ui/query-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/i18n/use-translation";
import { PageTitle } from "../camp-ui";
import { DaySheetTab } from "./attendance/DaySheetTab";
import { LiveTab } from "./attendance/LiveTab";
import { MeetingsTab } from "./attendance/MeetingsTab";
import { defaultDayNo, useCampAgenda } from "./attendance/model";
import { SummaryTab } from "./attendance/SummaryTab";
import { WindowTab } from "./attendance/WindowTab";

type TabId = "day" | "window" | "live" | "summary" | "meetings";

export function AttendanceView() {
  const { t } = useTranslation();
  const agenda = useCampAgenda();
  const [tab, setTab] = useState<TabId>("day");
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const a = agenda.data;
  // One day for the day sheet, the window sheet and the meetings list, so
  // switching tabs keeps the operator on the same day.
  const dayNo = pickedDay ?? (a ? defaultDayNo(a) : null);

  return (
    <div>
      <PageTitle title={t("camp.nav.attendance")} description={t("camp.att.description")} />
      <QueryState
        isPending={agenda.isPending}
        isError={agenda.isError}
        error={agenda.error}
        onRetry={() => void agenda.refetch()}
        skeletonRows={8}
      >
        {a ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
            <TabsList className="mb-4 h-auto flex-wrap justify-start">
              <TabsTrigger value="day">{t("camp.att.tab.day")}</TabsTrigger>
              <TabsTrigger value="window">{t("camp.att.tab.window")}</TabsTrigger>
              <TabsTrigger value="live">{t("camp.att.tab.live")}</TabsTrigger>
              <TabsTrigger value="summary">{t("camp.att.tab.summary")}</TabsTrigger>
              <TabsTrigger value="meetings">{t("camp.att.tab.meetings")}</TabsTrigger>
            </TabsList>
            {dayNo === null || !a.days.length ? (
              <TabsContent value={tab}>
                {tab === "live" ? (
                  <LiveTab />
                ) : (
                  <EmptyState
                    icon={CalendarX}
                    title={t("camp.att.noAgenda")}
                    description={t("camp.att.noAgendaHint")}
                  />
                )}
              </TabsContent>
            ) : (
              <>
                <TabsContent value="day">
                  <DaySheetTab agenda={a} dayNo={dayNo} onDayChange={setPickedDay} />
                </TabsContent>
                <TabsContent value="window">
                  <WindowTab agenda={a} dayNo={dayNo} onDayChange={setPickedDay} />
                </TabsContent>
                <TabsContent value="live">
                  <LiveTab />
                </TabsContent>
                <TabsContent value="summary">
                  <SummaryTab agenda={a} />
                </TabsContent>
                <TabsContent value="meetings">
                  <MeetingsTab agenda={a} dayNo={dayNo} onDayChange={setPickedDay} />
                </TabsContent>
              </>
            )}
          </Tabs>
        ) : null}
      </QueryState>
    </div>
  );
}
