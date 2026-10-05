/**
 * الآن — FR-ATT-08: who is in which room now, head count per room, and the
 * people each running counted session expects who are not in its room.
 * Refreshes every 30 seconds.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, DoorOpen, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/ui/query-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "@/i18n/use-translation";
import { getAttendanceLive } from "@/lib/camp-read.functions";
import { ROLE_AR } from "@/lib/camp/copy-ar";
import type { LivePayload } from "@/lib/camp/types";
import { downloadWorkbook } from "../../export-xlsx";
import {
  campKey,
  matchesSearch,
  PersonLink,
  ROLE_KEY,
  SearchBox,
  SESSION_TYPE_KEY,
  StatCard,
  ToneBadge,
  useCampFormat,
} from "../../camp-ui";
import { roomAr, timeAr } from "./model";

export function LiveTab() {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const fn = useServerFn(getAttendanceLive);
  const query = useQuery({
    queryKey: campKey("attLive"),
    queryFn: () => fn(),
    refetchInterval: 30_000,
  });
  const [search, setSearch] = useState("");
  const d = query.data;

  const rooms = useMemo(
    () =>
      (d?.rooms ?? [])
        .map((r) => ({
          ...r,
          people: r.people.filter((p) => matchesSearch(search, [p.name, p.teamNo, r.label])),
        }))
        .filter((r) => !search.trim() || r.people.length),
    [d, search],
  );
  const missing = useMemo(
    () =>
      (d?.expectedMissing ?? []).map((m) => ({
        ...m,
        people: m.people.filter((p) => matchesSearch(search, [p.name, p.teamNo, p.where])),
      })),
    [d, search],
  );
  const sessionById = new Map((d?.sessions ?? []).map((s) => [s.id, s]));
  const inMeetings = (d?.rooms ?? []).reduce((sum, r) => sum + r.people.length, 0);
  const missingTotal = (d?.expectedMissing ?? []).reduce((sum, m) => sum + m.people.length, 0);

  return (
    <QueryState
      isPending={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeletonRows={6}
    >
      {d ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SearchBox value={search} onChange={setSearch} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t("camp.att.live.updated", { time: fmt.time(d.now) })}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void exportLive(d, rooms, missing)}
              >
                <Download className="me-1 h-4 w-4" />
                {t("camp.btn.exportExcel")}
              </Button>
            </div>
          </div>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t("camp.overview.presentNow")} value={d.onlineCount} />
            <StatCard label={t("camp.att.live.inMeetings")} value={inMeetings} />
            <StatCard label={t("camp.att.live.roomsInUse")} value={d.rooms.length} />
            <StatCard
              label={t("camp.att.live.missing")}
              value={missingTotal}
              tone={missingTotal ? "warn" : "good"}
            />
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">{t("camp.overview.sessionsNow")}</h3>
            {d.sessions.length ? (
              <ul className="space-y-2">
                {d.sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span dir="auto">{s.title}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ToneBadge tone={s.counted ? "info" : "muted"}>
                        {t(SESSION_TYPE_KEY[s.type])}
                      </ToneBadge>
                      {t("camp.att.timeRange", { from: fmt.time(s.start), to: fmt.time(s.end) })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("camp.overview.noSessionNow")}</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <DoorOpen className="h-4 w-4" aria-hidden />
              {t("camp.att.live.rooms")}
            </h3>
            {rooms.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {rooms.map((r) => (
                  <div key={r.roomId ?? "unplaced"} className="rounded-lg border bg-card p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium" dir="auto">
                        {r.roomId ? r.label : t("camp.status.undetermined")}
                      </span>
                      <ToneBadge tone={r.roomId ? "info" : "warn"}>
                        {t("camp.att.live.headCount", { count: r.people.length })}
                      </ToneBadge>
                    </div>
                    <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
                      {r.people.map((p) => (
                        <li key={p.key} className="flex items-center justify-between gap-2">
                          <PersonLink personKey={p.key} className="min-w-0 truncate">
                            <span dir="auto">{p.name}</span>
                          </PersonLink>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {t(ROLE_KEY[p.role])}
                            {p.teamNo !== null ? ` · ${p.teamNo}` : ""}
                            {" · "}
                            {t("camp.att.live.since", { time: fmt.time(p.since) })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {search.trim() ? t("camp.common.noResults") : t("camp.att.live.noRooms")}
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <UserX className="h-4 w-4" aria-hidden />
              {t("camp.att.live.missingTitle")}
            </h3>
            {missing.length ? (
              missing.map((m) => {
                const s = sessionById.get(m.sessionId);
                return (
                  <div key={m.sessionId} className="space-y-2">
                    <p className="text-sm">
                      <span dir="auto" className="font-medium">
                        {s?.title ?? "—"}
                      </span>
                      <span className="ms-2 text-xs text-muted-foreground">
                        {t("camp.att.live.missingCount", { count: m.people.length })}
                      </span>
                    </p>
                    {m.people.length ? (
                      <div className="overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("camp.att.person")}</TableHead>
                              <TableHead>{t("camp.col.role")}</TableHead>
                              <TableHead>{t("camp.col.team")}</TableHead>
                              <TableHead>{t("camp.att.live.whereNow")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {m.people.map((p) => (
                              <TableRow key={p.key}>
                                <TableCell>
                                  <PersonLink personKey={p.key}>
                                    <span dir="auto">{p.name}</span>
                                  </PersonLink>
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {t(ROLE_KEY[p.role])}
                                </TableCell>
                                <TableCell className="tabular-nums">{p.teamNo ?? "—"}</TableCell>
                                <TableCell dir="auto">
                                  {p.where ?? (
                                    <span className="text-muted-foreground">
                                      {t("camp.att.live.notInRoom")}
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("camp.att.live.allPresent")}
                      </p>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">{t("camp.att.live.noCounted")}</p>
            )}
          </section>
        </div>
      ) : null}
    </QueryState>
  );
}

function exportLive(
  d: LivePayload,
  rooms: LivePayload["rooms"],
  missing: LivePayload["expectedMissing"],
) {
  const titleOf = new Map(d.sessions.map((s) => [s.id, s.title]));
  return downloadWorkbook("الموجودون الآن", [
    {
      name: "الموجودون الآن",
      headers: ["الغرفة", "الاسم", "الدور", "الفريق", "منذ"],
      rows: rooms.flatMap((r) =>
        r.people.map((p) => [
          roomAr(r.roomId ? r.label : null),
          p.name,
          ROLE_AR[p.role],
          p.teamNo,
          timeAr(p.since),
        ]),
      ),
    },
    {
      name: "المطلوبون غير الموجودين",
      headers: ["الفقرة", "الاسم", "الدور", "الفريق", "مكانه الآن"],
      rows: missing.flatMap((m) =>
        m.people.map((p) => [
          titleOf.get(m.sessionId) ?? "",
          p.name,
          ROLE_AR[p.role],
          p.teamNo,
          p.where ?? "",
        ]),
      ),
    },
  ]);
}
