/**
 * Camp operations — المستخدمون (Module 1: directory and account management).
 *
 *   الحسابات              every SoWork account, filters, bulk actions (FR-USR-01..06)
 *   لم يدخلوا المنصة       registry people with no account, with phones (FR-USR-09)
 *   طلبات تغيير نوع الحساب  the change list the API cannot apply (FR-USR-07/08, M06)
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCheck, Download, ExternalLink, ListPlus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/ui/query-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { getCampDirectory } from "@/lib/camp-read.functions";
import {
  addCampTypeChanges,
  markCampReviewed,
  updateCampTypeChange,
} from "@/lib/camp-actions.functions";
import {
  ACCOUNT_TYPE_AR,
  DUPLICATE_LEVEL_AR,
  MATCH_STATE_AR,
  NAMING_STATUS_AR,
  ROLE_AR,
  TYPE_CHANGE_STATUS_AR,
} from "@/lib/camp/copy-ar";
import type {
  AccountRow,
  AccountType,
  DuplicateLevel,
  EventRole,
  MatchState,
  NamingStatus,
} from "@/lib/camp/types";
import { downloadWorkbook } from "../export-xlsx";
import {
  ACCOUNT_TYPE_KEY,
  AccountTypeBadge,
  campKey,
  DUP_KEY,
  DupBadge,
  errorMessage,
  FilterSelect,
  MATCH_KEY,
  MatchBadge,
  matchesSearch,
  NAMING_KEY,
  NamingBadge,
  PageTitle,
  PersonLink,
  PresenceDot,
  ReasonDialog,
  ROLE_KEY,
  SearchBox,
  SendMessageDialog,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
} from "../camp-ui";

const ROLES: EventRole[] = [
  "participant",
  "guider",
  "coach",
  "expert",
  "speaker",
  "supervisor",
  "unknown",
];
const TYPES: AccountType[] = ["admin", "teammate", "guest"];
const NAMING: NamingStatus[] = ["ok", "note", "violation"];
const MATCHES: MatchState[] = ["linked", "candidate", "not_in_registry"];
const DUPS: (DuplicateLevel | "none")[] = ["confirmed", "suspected", "lookalike", "none"];

export function DirectoryView() {
  const { t } = useTranslation();
  const fn = useServerFn(getCampDirectory);
  const query = useQuery({
    queryKey: campKey("directory"),
    queryFn: () => fn(),
    refetchInterval: 120_000,
  });
  const d = query.data;
  const pending = d?.typeChanges.filter((c) => c.status === "pending").length ?? 0;
  return (
    <div>
      <PageTitle title={t("camp.nav.users")} description={t("camp.users.description")} />
      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        skeletonRows={8}
      >
        {d ? (
          <Tabs defaultValue="accounts">
            <TabsList className="mb-4 flex-wrap">
              <TabsTrigger value="accounts">
                {t("camp.users.tabAccounts")} ({d.accounts.length})
              </TabsTrigger>
              <TabsTrigger value="missing">
                {t("camp.users.tabMissing")} ({d.missing.length})
              </TabsTrigger>
              <TabsTrigger value="changes">
                {t("camp.users.tabChanges")} ({pending})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="accounts">
              <AccountsTab accounts={d.accounts} teamCount={d.teamCount} />
            </TabsContent>
            <TabsContent value="missing">
              <MissingTab rows={d.missing} />
            </TabsContent>
            <TabsContent value="changes">
              <ChangesTab rows={d.typeChanges} adminUrl={d.soworkAdminUrl} />
            </TabsContent>
          </Tabs>
        ) : null}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AccountsTab({ accounts, teamCount }: { accounts: AccountRow[]; teamCount: number }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<EventRole | "all">("all");
  const [team, setTeam] = useState<string>("all");
  const [type, setType] = useState<AccountType | "all">("all");
  const [presence, setPresence] = useState<"online" | "offline" | "all">("all");
  const [naming, setNaming] = useState<NamingStatus | "all">("all");
  const [match, setMatch] = useState<MatchState | "all">("all");
  const [dup, setDup] = useState<DuplicateLevel | "none" | "all">("all");
  const [mismatch, setMismatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [requestedType, setRequestedType] = useState<AccountType | "expected">("expected");
  const reviewFn = useServerFn(markCampReviewed);
  const changeFn = useServerFn(addCampTypeChanges);

  const rows = useMemo(
    () =>
      accounts
        .filter((a) => role === "all" || a.eventRole === role)
        .filter((a) => team === "all" || String(a.teamNo ?? "") === team)
        .filter((a) => type === "all" || a.accountType === type)
        .filter(
          (a) =>
            presence === "all" ||
            (presence === "online"
              ? !!a.presence && a.presence !== "offline"
              : !a.presence || a.presence === "offline"),
        )
        .filter((a) => naming === "all" || a.naming === naming)
        .filter((a) => match === "all" || a.matchState === match)
        .filter((a) => dup === "all" || (dup === "none" ? !a.duplicate : a.duplicate === dup))
        .filter((a) => !mismatch || a.typeMismatch)
        .filter((a) => matchesSearch(search, [a.name, a.registryName, a.phone, a.email, a.teamNo]))
        .sort(
          (a, b) => (a.teamNo ?? 999) - (b.teamNo ?? 999) || a.name.localeCompare(b.name, "ar"),
        ),
    [accounts, role, team, type, presence, naming, match, dup, mismatch, search],
  );
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.swUserId));
  const selectedIds = [...selected];
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((r) => next.delete(r.swUserId));
      else rows.forEach((r) => next.add(r.swUserId));
      return next;
    });
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const review = useMutation({
    mutationFn: (reviewed: boolean) => reviewFn({ data: { swUserIds: selectedIds, reviewed } }),
    onSuccess: () => {
      toast.success(t("camp.common.saved"));
      void invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const exportRows = (list: AccountRow[]) =>
    downloadWorkbook("دليل المستخدمين", [
      {
        name: "دليل المستخدمين",
        headers: [
          "الاسم كما يظهر",
          "الدور في المعسكر",
          "الفريق",
          "المرشد",
          "نوع الحساب",
          "الجوال",
          "حالة الربط بالسجل",
          "حالة التسمية",
          "التكرار",
        ],
        rows: list.map((a) => [
          a.name,
          ROLE_AR[a.eventRole],
          a.teamNo,
          a.guiderName,
          ACCOUNT_TYPE_AR[a.accountType],
          a.phone,
          MATCH_STATE_AR[a.matchState],
          NAMING_STATUS_AR[a.naming],
          a.duplicate ? DUPLICATE_LEVEL_AR[a.duplicate] : "",
        ]),
      },
    ]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder={t("camp.users.searchHint")} />
        <FilterSelect
          label={t("camp.col.role")}
          value={role}
          onChange={setRole}
          options={ROLES.map((r) => ({ value: r, label: t(ROLE_KEY[r]) }))}
        />
        <FilterSelect
          label={t("camp.col.team")}
          value={team}
          onChange={setTeam}
          options={Array.from({ length: teamCount }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1),
          }))}
        />
        <FilterSelect
          label={t("camp.col.accountType")}
          value={type}
          onChange={setType}
          options={TYPES.map((x) => ({ value: x, label: t(ACCOUNT_TYPE_KEY[x]) }))}
        />
        <FilterSelect
          label={t("camp.col.presence")}
          value={presence}
          onChange={setPresence}
          options={[
            { value: "online", label: t("camp.presence.online") },
            { value: "offline", label: t("camp.presence.offline") },
          ]}
        />
        <FilterSelect
          label={t("camp.col.naming")}
          value={naming}
          onChange={setNaming}
          options={NAMING.map((x) => ({ value: x, label: t(NAMING_KEY[x]) }))}
        />
        <FilterSelect
          label={t("camp.col.match")}
          value={match}
          onChange={setMatch}
          options={MATCHES.map((x) => ({ value: x, label: t(MATCH_KEY[x]) }))}
        />
        <FilterSelect
          label={t("camp.col.duplicate")}
          value={dup}
          onChange={setDup}
          options={DUPS.map((x) => ({
            value: x,
            label: x === "none" ? t("camp.users.noDuplicate") : t(DUP_KEY[x]),
          }))}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={mismatch} onCheckedChange={(v) => setMismatch(v === true)} />
          {t("camp.users.typeMismatch")}
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {t("camp.users.showing", { shown: rows.length, total: accounts.length })}
          {selected.size ? ` · ${t("camp.users.selected", { count: selected.size })}` : ""}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void exportRows(rows)}>
            <Download className="me-1 h-4 w-4" />
            {t("camp.btn.exportExcel")}
          </Button>
          {selected.size ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void exportRows(accounts.filter((a) => selected.has(a.swUserId)))}
              >
                <Download className="me-1 h-4 w-4" />
                {t("camp.users.exportSelection")}
              </Button>
              {edit ? (
                <>
                  <Button size="sm" onClick={() => setSendOpen(true)}>
                    <Send className="me-1 h-4 w-4" />
                    {t("camp.btn.sendMessage")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setChangeOpen(true)}>
                    <ListPlus className="me-1 h-4 w-4" />
                    {t("camp.btn.addToTypeChanges")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={review.isPending}
                    onClick={() => review.mutate(true)}
                  >
                    <CheckCheck className="me-1 h-4 w-4" />
                    {t("camp.users.markReviewed")}
                  </Button>
                </>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                <X className="me-1 h-4 w-4" />
                {t("camp.users.clearSelection")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label={t("camp.users.selectAll")}
                />
              </TableHead>
              <TableHead>{t("camp.col.name")}</TableHead>
              <TableHead>{t("camp.col.suffix")}</TableHead>
              <TableHead>{t("camp.col.role")}</TableHead>
              <TableHead>{t("camp.col.team")}</TableHead>
              <TableHead>{t("camp.col.guider")}</TableHead>
              <TableHead>{t("camp.col.accountType")}</TableHead>
              <TableHead>{t("camp.col.presence")}</TableHead>
              <TableHead>{t("camp.col.lastActivity")}</TableHead>
              <TableHead>{t("camp.col.phone")}</TableHead>
              <TableHead>{t("camp.col.match")}</TableHead>
              <TableHead>{t("camp.col.naming")}</TableHead>
              <TableHead>{t("camp.col.duplicate")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow
                key={a.swUserId}
                data-state={selected.has(a.swUserId) ? "selected" : undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={selected.has(a.swUserId)}
                    onCheckedChange={() => toggle(a.swUserId)}
                    aria-label={a.name}
                  />
                </TableCell>
                <TableCell className="min-w-48">
                  <PersonLink personKey={a.personKey}>
                    <span dir="auto">{a.name || "—"}</span>
                  </PersonLink>
                  {a.registryName && a.registryName !== a.namePart ? (
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {a.registryName}
                    </p>
                  ) : null}
                  {a.reviewed ? (
                    <span className="text-xs text-muted-foreground">
                      ✓ {t("camp.users.reviewed")}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell dir="auto">{a.suffix || "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{t(ROLE_KEY[a.eventRole])}</TableCell>
                <TableCell className="tabular-nums">{a.teamNo ?? "—"}</TableCell>
                <TableCell className="max-w-40 truncate" dir="auto">
                  {a.guiderName ?? "—"}
                </TableCell>
                <TableCell>
                  <AccountTypeBadge type={a.accountType} expected={a.expectedType} />
                  {a.pendingChange ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("camp.users.changePending")}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <PresenceDot presence={a.presence} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {fmt.dateTime(a.lastActivityAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap" dir="ltr">
                  {a.phone ?? "—"}
                </TableCell>
                <TableCell>
                  <MatchBadge state={a.matchState} />
                </TableCell>
                <TableCell>
                  <NamingBadge status={a.naming} />
                </TableCell>
                <TableCell>{a.duplicate ? <DupBadge level={a.duplicate} /> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("camp.common.noResults")}
          </p>
        ) : null}
      </div>

      <SendMessageDialog open={sendOpen} onOpenChange={setSendOpen} swUserIds={selectedIds} />
      <ReasonDialog
        open={changeOpen}
        onOpenChange={setChangeOpen}
        title={t("camp.btn.addToTypeChanges")}
        description={t("camp.users.selected", { count: selected.size })}
        onSubmit={async (reason) => {
          const res = await changeFn({
            data: {
              reason,
              items: selectedIds.map((swUserId) => ({
                swUserId,
                kind: "type" as const,
                requestedType: requestedType === "expected" ? null : requestedType,
              })),
            },
          });
          toast.success(t("camp.users.changesAdded", { count: res.added }));
          await invalidate();
        }}
      >
        <div className="space-y-1.5">
          <Label>{t("camp.col.requestedType")}</Label>
          <Select
            value={requestedType}
            onValueChange={(v) => setRequestedType(v as AccountType | "expected")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="expected">{t("camp.users.expectedType")}</SelectItem>
              {TYPES.map((x) => (
                <SelectItem key={x} value={x}>
                  {t(ACCOUNT_TYPE_KEY[x])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ReasonDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MissingTab({ rows: all }: { rows: import("@/lib/camp/types").RegistryRow[] }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const rows = all.filter((r) => matchesSearch(search, [r.name, r.phone, r.email, r.teamNo]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchBox value={search} onChange={setSearch} />
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void downloadWorkbook("لم يدخلوا المنصة", [
              {
                name: "لم يدخلوا المنصة",
                headers: ["الاسم", "الفريق", "الدور في المعسكر", "الجوال", "البريد الإلكتروني"],
                rows: rows.map((r) => [r.name, r.teamNo, ROLE_AR[r.kind], r.phone, r.email]),
              },
            ])
          }
        >
          <Download className="me-1 h-4 w-4" />
          {t("camp.btn.exportExcel")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("camp.users.missingHint")}</p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("camp.col.name")}</TableHead>
              <TableHead>{t("camp.col.team")}</TableHead>
              <TableHead>{t("camp.col.role")}</TableHead>
              <TableHead>{t("camp.col.phone")}</TableHead>
              <TableHead>{t("camp.col.email")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <PersonLink personKey={`p:${r.id}`}>
                    <span dir="auto">{r.name}</span>
                  </PersonLink>
                </TableCell>
                <TableCell className="tabular-nums">{r.teamNo ?? "—"}</TableCell>
                <TableCell>{t(ROLE_KEY[r.kind])}</TableCell>
                <TableCell dir="ltr">{r.phone ?? "—"}</TableCell>
                <TableCell dir="ltr">{r.email ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("camp.users.noneMissing")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ChangesTab({
  rows,
  adminUrl,
}: {
  rows: import("@/lib/camp/types").TypeChangeRow[];
  adminUrl: string;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const [status, setStatus] = useState<"pending" | "done" | "cancelled" | "all">("pending");
  const updateFn = useServerFn(updateCampTypeChange);
  const update = useMutation({
    mutationFn: (v: { ids: string[]; status: "pending" | "done" | "cancelled" }) =>
      updateFn({ data: v }),
    onSuccess: () => void invalidate(),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const list = rows.filter((r) => status === "all" || r.status === status);
  const typeLabel = (x: AccountType | null) => (x ? t(ACCOUNT_TYPE_KEY[x]) : "—");
  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/30 p-3 text-sm">{t("camp.msg.M06")}</div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterSelect
          label={t("camp.common.status")}
          value={status}
          onChange={setStatus}
          options={(["pending", "done", "cancelled"] as const).map((x) => ({
            value: x,
            label: t(`camp.change.${x}` as MessageKey),
          }))}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void downloadWorkbook("طلبات تغيير نوع الحساب", [
                {
                  name: "طلبات تغيير نوع الحساب",
                  headers: ["الاسم", "نوع الحساب الحالي", "نوع الحساب المطلوب", "السبب", "الحالة"],
                  rows: list.map((r) => [
                    r.name,
                    r.currentType ? ACCOUNT_TYPE_AR[r.currentType] : "",
                    r.kind === "remove"
                      ? "حذف الحساب"
                      : r.requestedType
                        ? ACCOUNT_TYPE_AR[r.requestedType]
                        : "",
                    r.reason,
                    TYPE_CHANGE_STATUS_AR[r.status],
                  ]),
                },
              ])
            }
          >
            <Download className="me-1 h-4 w-4" />
            {t("camp.btn.exportExcel")}
          </Button>
          <Button asChild size="sm">
            <a href={adminUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="me-1 h-4 w-4" />
              {t("camp.btn.openSoworkSettings")}
            </a>
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("camp.col.name")}</TableHead>
              <TableHead>{t("camp.col.currentType")}</TableHead>
              <TableHead>{t("camp.col.requestedType")}</TableHead>
              <TableHead>{t("camp.common.reason")}</TableHead>
              <TableHead>{t("camp.common.status")}</TableHead>
              <TableHead>{t("camp.col.requestedAt")}</TableHead>
              {edit ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((r) => (
              <TableRow key={r.id}>
                <TableCell dir="auto">{r.name}</TableCell>
                <TableCell>{typeLabel(r.currentType)}</TableCell>
                <TableCell>
                  {r.kind === "remove" ? t("camp.change.remove") : typeLabel(r.requestedType)}
                </TableCell>
                <TableCell className="max-w-64 truncate">{r.reason}</TableCell>
                <TableCell>
                  <ToneBadge
                    tone={r.status === "done" ? "good" : r.status === "pending" ? "warn" : "muted"}
                  >
                    {t(`camp.change.${r.status}` as MessageKey)}
                  </ToneBadge>
                  {r.doneAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">{fmt.dateTime(r.doneAt)}</p>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {fmt.dateTime(r.requestedAt)}
                </TableCell>
                {edit ? (
                  <TableCell className="whitespace-nowrap">
                    {r.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => update.mutate({ ids: [r.id], status: "done" })}
                        >
                          {t("camp.change.markDone")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => update.mutate({ ids: [r.id], status: "cancelled" })}
                        >
                          {t("camp.btn.cancel")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => update.mutate({ ids: [r.id], status: "pending" })}
                      >
                        {t("camp.change.reopen")}
                      </Button>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!list.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("camp.users.noChanges")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
