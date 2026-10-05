/**
 * Camp operations — رفع البيانات (§3, FR-IMP-01..07).
 *
 *   سجل المعسكر     registry workbook: teams, guiders, coaches (FR-IMP-01..03)
 *   البرنامج        agenda workbook: one sheet per day (FR-IMP-04)
 *   جدول الفقرات    each item's type, automatic or overridden (FR-IMP-05)
 *   خريطة الغرف     meeting topics and zone ids per room (FR-IMP-06)
 *   اللجان والعروض  committee rooms per checkpoint day, judging order (§13)
 *
 * Every upload is previewed (issues, counts, added / removed / changed) and
 * applied only on Save (FR-IMP-07).
 */
import { useEffect, useState } from "react";
import { QueryState } from "@/components/ui/query-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/i18n/use-translation";
import { PageTitle } from "../camp-ui";
import { CommitteesTab } from "./upload/CommitteesTab";
import { ImportTab } from "./upload/ImportTab";
import { RoomsTab } from "./upload/RoomsTab";
import { SessionsTab } from "./upload/SessionsTab";
import { useCampAgenda, useCampSettingsQuery } from "./upload/shared";

type UploadTab = "registry" | "agenda" | "sessions" | "rooms" | "committees";
const TABS: UploadTab[] = ["registry", "agenda", "sessions", "rooms", "committees"];
const STORAGE_KEY = "camp.upload.tab";

function storedTab(): UploadTab | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return TABS.includes(stored as UploadTab) ? (stored as UploadTab) : null;
  } catch {
    return null;
  }
}

export function UploadView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<UploadTab>("registry");
  // Restored after mount so the server render and the first client render agree.
  useEffect(() => {
    const stored = storedTab();
    if (stored) setTab(stored);
  }, []);
  const agenda = useCampAgenda();
  const settings = useCampSettingsQuery();
  const agendaState = {
    isPending: agenda.isPending,
    isError: agenda.isError,
    error: agenda.error,
    onRetry: () => void agenda.refetch(),
    skeletonRows: 6,
  };

  return (
    <div>
      <PageTitle title={t("camp.nav.upload")} description={t("camp.upload.description")} />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as UploadTab);
          try {
            window.localStorage.setItem(STORAGE_KEY, value);
          } catch {
            // Remembering the tab is a convenience only.
          }
        }}
      >
        <TabsList className="mb-4 h-auto flex-wrap justify-start">
          <TabsTrigger value="registry">{t("camp.upload.tab.registry")}</TabsTrigger>
          <TabsTrigger value="agenda">{t("camp.upload.tab.agenda")}</TabsTrigger>
          <TabsTrigger value="sessions">
            {t("camp.upload.tab.sessions")}
            {agenda.data ? ` (${agenda.data.sessions.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="rooms">
            {t("camp.upload.tab.rooms")}
            {agenda.data ? ` (${agenda.data.rooms.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="committees">{t("camp.upload.tab.committees")}</TabsTrigger>
        </TabsList>
        <TabsContent value="registry">
          <ImportTab kind="registry" />
        </TabsContent>
        <TabsContent value="agenda">
          <ImportTab kind="agenda" />
        </TabsContent>
        <TabsContent value="sessions">
          <QueryState {...agendaState}>
            {agenda.data ? <SessionsTab agenda={agenda.data} /> : null}
          </QueryState>
        </TabsContent>
        <TabsContent value="rooms">
          <QueryState {...agendaState}>
            {agenda.data ? (
              <RoomsTab
                rooms={agenda.data.rooms}
                teamCount={settings.data?.settings.teamCount ?? null}
              />
            ) : null}
          </QueryState>
        </TabsContent>
        <TabsContent value="committees">
          <QueryState
            {...agendaState}
            isPending={agenda.isPending || settings.isPending}
            isError={agenda.isError || settings.isError}
            error={agenda.error ?? settings.error}
            onRetry={() => {
              void agenda.refetch();
              void settings.refetch();
            }}
          >
            {agenda.data && settings.data ? (
              <CommitteesTab agenda={agenda.data} settings={settings.data.settings} />
            ) : null}
          </QueryState>
        </TabsContent>
      </Tabs>
    </div>
  );
}
