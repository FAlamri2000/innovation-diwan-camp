/**
 * FR-ATT-06 — one person's meetings on one day: room, linked session, join,
 * leave, minutes, status and the recording (FR-REC-04). Export FR-EXP-07.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
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
import { getPersonMeetings } from "@/lib/camp-read.functions";
import { ATT_STATUS_AR } from "@/lib/camp/copy-ar";
import type { PersonMeetingRow } from "@/lib/camp/types";
import { downloadWorkbook } from "../../export-xlsx";
import { AttBadge, campKey, RecordingButton, useCampFormat } from "../../camp-ui";
import { roomAr, timeAr } from "./model";

function exportPersonMeetings(name: string, rows: readonly PersonMeetingRow[]) {
  return downloadWorkbook("اجتماعات المستخدمين", [
    {
      name: "اجتماعات المستخدمين",
      headers: [
        "الاسم",
        "الاجتماع",
        "الغرفة",
        "الفقرة",
        "الدخول",
        "الخروج",
        "الدقائق",
        "الحالة",
        "رابط التسجيل",
      ],
      rows: rows.map((m) => [
        name,
        m.topic,
        roomAr(m.roomLabel),
        m.sessionTitle,
        timeAr(m.joinedAt),
        timeAr(m.leftAt),
        m.minutes,
        m.status ? ATT_STATUS_AR[m.status] : "",
        m.deepLink ? { text: m.deepLink, hyperlink: m.deepLink } : "",
      ]),
    },
  ]);
}

export function PersonMeetings({
  personKey,
  name,
  dayNo,
}: {
  personKey: string;
  name: string;
  dayNo: number;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const fn = useServerFn(getPersonMeetings);
  const query = useQuery({
    queryKey: campKey("personMeetings", personKey, dayNo),
    queryFn: () => fn({ data: { key: personKey, dayNo } }),
  });
  const rows = query.data ?? [];
  return (
    <div className="space-y-2 py-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {t("camp.att.meetingsOf", { name })}
          <span className="ms-2 text-xs font-normal text-muted-foreground">
            {t("camp.common.dayN", { n: dayNo })}
          </span>
        </p>
        {rows.length ? (
          <Button size="sm" variant="outline" onClick={() => void exportPersonMeetings(name, rows)}>
            <Download className="me-1 h-4 w-4" />
            {t("camp.btn.exportExcel")}
          </Button>
        ) : null}
      </div>
      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        skeletonRows={2}
      >
        {rows.length ? (
          <div className="overflow-x-auto rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("camp.att.meeting")}</TableHead>
                  <TableHead>{t("camp.common.room")}</TableHead>
                  <TableHead>{t("camp.common.session")}</TableHead>
                  <TableHead>{t("camp.att.join")}</TableHead>
                  <TableHead>{t("camp.att.leave")}</TableHead>
                  <TableHead>{t("camp.common.minutes")}</TableHead>
                  <TableHead>{t("camp.common.status")}</TableHead>
                  <TableHead>{t("camp.att.recording")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.meetingId}>
                    <TableCell className="max-w-56 truncate" dir="auto" title={m.topic ?? ""}>
                      {m.topic || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap" dir="auto">
                      {m.roomLabel ?? (
                        <span className="text-muted-foreground">
                          {t("camp.status.undetermined")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-48 truncate" dir="auto">
                      {m.sessionTitle ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmt.time(m.joinedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {m.leftAt === null ? (
                        <span className="text-muted-foreground">{t("camp.att.stillIn")}</span>
                      ) : (
                        fmt.time(m.leftAt)
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmt.minutes(m.minutes)}
                    </TableCell>
                    <TableCell>
                      {m.status ? <AttBadge status={m.status} /> : <span>—</span>}
                    </TableCell>
                    <TableCell>
                      <RecordingButton
                        meetingId={m.meetingId}
                        deepLink={m.deepLink}
                        hasRecording={m.hasRecording}
                        compact
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("camp.person.noMeetings")}</p>
        )}
      </QueryState>
    </div>
  );
}
