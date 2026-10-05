/**
 * Camp operations — person profile (FR-USR-04, FR-USR-05).
 *
 * One person = a registry record and every SoWork account linked to it (or a
 * lone account). Opened from any list via usePersonSheet().openPerson(key).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link2, Link2Off, Loader2, Mail, Phone, SearchX, Send } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QueryState } from "@/components/ui/query-state";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { getCampDirectory, getCampPerson } from "@/lib/camp-read.functions";
import { setCampAccountLink } from "@/lib/camp-actions.functions";
import type { AccountRow } from "@/lib/camp/types";
import {
  AccountTypeBadge,
  AttBadge,
  campKey,
  errorMessage,
  MatchBadge,
  matchesSearch,
  NamingBadge,
  PresenceDot,
  ReasonDialog,
  RecordingButton,
  ROLE_KEY,
  SearchBox,
  SendMessageDialog,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
} from "./camp-ui";

export function PersonSheet({
  personKey,
  onClose,
}: {
  personKey: string | null;
  onClose: () => void;
}) {
  const { t, direction } = useTranslation();
  const fmt = useCampFormat();
  const fn = useServerFn(getCampPerson);
  const query = useQuery({
    queryKey: campKey("person", personKey),
    queryFn: () => fn({ data: { key: personKey! } }),
    enabled: !!personKey,
  });
  const data = query.data;
  const p = data?.person;
  return (
    <Sheet open={!!personKey} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={direction === "rtl" ? "left" : "right"}
        className="w-full p-0 sm:max-w-2xl"
      >
        <ScrollArea className="h-full">
          <div className="space-y-6 p-6">
            <QueryState
              isPending={query.isPending}
              isError={query.isError}
              error={query.error}
              onRetry={() => void query.refetch()}
            >
              {p ? (
                <>
                  <SheetHeader className="text-start">
                    <SheetTitle className="text-xl">{p.name || "—"}</SheetTitle>
                    <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>{t(ROLE_KEY[p.role])}</span>
                      {p.teamNo !== null ? (
                        <span>{t("camp.common.teamN", { n: p.teamNo })}</span>
                      ) : null}
                      {data.registry?.guiderTeams.length ? (
                        <span>
                          {t("camp.person.guiderTeams", {
                            teams: data.registry.guiderTeams.join("، "),
                          })}
                        </span>
                      ) : null}
                    </SheetDescription>
                  </SheetHeader>

                  <section className="grid gap-2 text-sm sm:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {p.phone ? (
                        <span dir="ltr">{p.phone}</span>
                      ) : (
                        <span className="text-muted-foreground">{t("camp.msg.M08")}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {p.email ? (
                        <span dir="ltr">{p.email}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    {data.registry?.notes ? (
                      <p className="text-muted-foreground sm:col-span-2">{data.registry.notes}</p>
                    ) : null}
                    {!data.registry ? (
                      <p className="text-muted-foreground sm:col-span-2">
                        {t("camp.person.notInRegistry")}
                      </p>
                    ) : null}
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-semibold">{t("camp.person.accounts")}</h3>
                    {data.accounts.length ? (
                      <div className="space-y-2">
                        {data.accounts.map((a) => (
                          <AccountCard key={a.swUserId} account={a} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("camp.status.notOnPlatform")}
                      </p>
                    )}
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-semibold">{t("camp.person.daily")}</h3>
                    {data.daily.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("camp.common.day")}</TableHead>
                            <TableHead>{t("camp.att.attendedOfExpected")}</TableHead>
                            <TableHead>{t("camp.att.meetingTime")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.daily.map((d) => (
                            <TableRow key={d.dayNo}>
                              <TableCell>{t("camp.common.dayN", { n: d.dayNo })}</TableCell>
                              <TableCell className="tabular-nums">
                                {d.rate.expected ? `${d.rate.attended} / ${d.rate.expected}` : "—"}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {fmt.minutes(d.minutes)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("camp.person.noAttendance")}
                      </p>
                    )}
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-semibold">{t("camp.person.meetings")}</h3>
                    {data.meetings.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("camp.common.time")}</TableHead>
                            <TableHead>{t("camp.common.room")}</TableHead>
                            <TableHead>{t("camp.common.session")}</TableHead>
                            <TableHead>{t("camp.common.minutes")}</TableHead>
                            <TableHead>{t("camp.common.status")}</TableHead>
                            <TableHead>{t("camp.nav.recordings")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...data.meetings].reverse().map((m) => (
                            <TableRow key={`${m.meetingId}-${m.joinedAt}`}>
                              <TableCell className="whitespace-nowrap">
                                {fmt.dateTime(m.joinedAt)}
                              </TableCell>
                              <TableCell>{m.roomLabel ?? t("camp.status.undetermined")}</TableCell>
                              <TableCell className="max-w-48 truncate">
                                {m.sessionTitle ?? "—"}
                              </TableCell>
                              <TableCell className="tabular-nums">{m.minutes}</TableCell>
                              <TableCell>
                                {m.status ? <AttBadge status={m.status} /> : "—"}
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
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("camp.person.noMeetings")}</p>
                    )}
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-semibold">{t("camp.person.messages")}</h3>
                    {data.messages.length ? (
                      <ul className="space-y-2">
                        {data.messages.map((m) => (
                          <li key={m.id} className="rounded-md border p-2 text-sm">
                            <div className="mb-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span>{fmt.dateTime(m.createdAt)}</span>
                              {m.itemKey ? <span>{m.itemKey}</span> : null}
                              <span>{t(`camp.sendStatus.${m.status}` as MessageKey)}</span>
                            </div>
                            <p dir="rtl" className="whitespace-pre-wrap">
                              {m.text}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("camp.person.noMessages")}</p>
                    )}
                  </section>
                </>
              ) : null}
            </QueryState>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function AccountCard({ account }: { account: AccountRow }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const linkFn = useServerFn(setCampAccountLink);
  const [dialog, setDialog] = useState<null | "link" | "unlink" | "not_in_registry">(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  const reset = useMutation({
    mutationFn: () => linkFn({ data: { action: "reset", swUserId: account.swUserId } }),
    onSuccess: () => void invalidate(),
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium" dir="auto">
            {account.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <AccountTypeBadge type={account.accountType} expected={account.expectedType} />
            <NamingBadge status={account.naming} />
            <MatchBadge state={account.matchState} />
            <PresenceDot presence={account.presence} />
          </div>
        </div>
        {edit ? (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
              <Send className="me-1 h-3.5 w-3.5" />
              {t("camp.btn.sendMessage")}
            </Button>
            {account.registryId &&
            (account.matchStatus === "manual" ||
              account.matchStatus === "auto" ||
              account.matchStatus === "probable") ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("unlink")}>
                <Link2Off className="me-1 h-3.5 w-3.5" />
                {t("camp.btn.unlink")}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setDialog("link")}>
                <Link2 className="me-1 h-3.5 w-3.5" />
                {t("camp.btn.link")}
              </Button>
            )}
            {account.matchStatus !== "not_in_registry" ? (
              <Button size="sm" variant="ghost" onClick={() => setDialog("not_in_registry")}>
                <SearchX className="me-1 h-3.5 w-3.5" />
                {t("camp.btn.notInRegistry")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={reset.isPending}
                onClick={() => reset.mutate()}
              >
                {t("camp.btn.resetLink")}
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {account.issues.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {account.issues
            .map((code) => `${code} ${t(`camp.naming.code.${code}` as MessageKey)}`)
            .join(" · ")}
        </p>
      ) : null}
      {account.suggestedName ? (
        <p className="mt-1 text-xs">
          <span className="text-muted-foreground">{t("camp.naming.suggested")}: </span>
          <span dir="auto">{account.suggestedName}</span>
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        {t("camp.person.firstSeen")}: {fmt.dateTime(account.firstSeenAt)} ·{" "}
        {t("camp.person.lastActivity")}: {fmt.dateTime(account.lastActivityAt)}
        {account.candidateName && !account.registryId
          ? ` · ${t("camp.person.candidate")}: ${account.candidateName} (${account.matchScore})`
          : ""}
      </p>

      <ReasonDialog
        open={dialog === "link"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("camp.btn.link")}
        description={account.name}
        confirmLabel={t("camp.btn.link")}
        onSubmit={async (reason) => {
          const target = chosen ?? account.candidateId;
          if (!target) throw new Error(t("camp.person.chooseRecord"));
          await linkFn({
            data: { action: "link", swUserId: account.swUserId, personId: target, reason },
          });
          await invalidate();
          toast.success(t("camp.common.saved"));
        }}
      >
        <RegistryPicker value={chosen ?? account.candidateId} onChange={setChosen} />
      </ReasonDialog>
      <ReasonDialog
        open={dialog === "unlink" || dialog === "not_in_registry"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog === "unlink" ? t("camp.btn.unlink") : t("camp.btn.notInRegistry")}
        description={account.name}
        onSubmit={async (reason) => {
          await linkFn({
            data: {
              action: dialog === "unlink" ? "unlink" : "not_in_registry",
              swUserId: account.swUserId,
              reason,
            },
          });
          await invalidate();
          toast.success(t("camp.common.saved"));
        }}
      />
      <SendMessageDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        swUserIds={[account.swUserId]}
        defaultTemplate={account.eventRole === "participant" ? "M01" : "M02"}
      />
    </div>
  );
}

/** Searchable registry list for linking an account (FR-USR-05). */
export function RegistryPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const fn = useServerFn(getCampDirectory);
  const query = useQuery({ queryKey: campKey("directory"), queryFn: () => fn() });
  const [search, setSearch] = useState("");
  const list = useMemo(
    () =>
      (query.data?.registry ?? [])
        .filter((r) => matchesSearch(search, [r.name, r.teamNo, r.phone, r.email]))
        .slice(0, 60),
    [query.data, search],
  );
  if (query.isPending) return <Loader2 className="h-4 w-4 animate-spin" />;
  return (
    <div className="space-y-2">
      <SearchBox value={search} onChange={setSearch} />
      <div className="max-h-64 overflow-y-auto rounded-md border">
        {list.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onChange(r.id)}
            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-accent ${value === r.id ? "bg-accent" : ""}`}
          >
            <span dir="auto">{r.name}</span>
            <span className="text-xs text-muted-foreground">
              {t(ROLE_KEY[r.kind])}
              {r.teamNo !== null ? ` · ${r.teamNo}` : ""}
            </span>
          </button>
        ))}
        {!list.length ? (
          <p className="p-3 text-sm text-muted-foreground">{t("camp.common.noResults")}</p>
        ) : null}
      </div>
    </div>
  );
}
