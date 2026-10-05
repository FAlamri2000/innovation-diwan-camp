/**
 * Camp operations — رفع البيانات › سجل المعسكر / البرنامج (FR-IMP-01..04, FR-IMP-07).
 *
 * The workbook is read in the browser and sent as plain grids for a PREVIEW:
 * every issue found (FR-IMP-03, M11), the counts, and what would be added,
 * removed or changed. Nothing is written until an operator presses Save; a
 * save that removes records asks first. Cancel discards the preview.
 */
import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ChevronDown,
  Download,
  Eye,
  FileSpreadsheet,
  Loader2,
  Save,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { QueryState } from "@/components/ui/query-state";
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
import { listCampImports } from "@/lib/camp-read.functions";
import { applyCampImport, discardCampImport, previewCampImport } from "@/lib/camp-admin.functions";
import { formatDateAr } from "@/lib/camp/text";
import type { ImportPreview } from "@/lib/camp/types";
import { downloadWorkbook } from "../../export-xlsx";
import {
  campKey,
  errorMessage,
  StatCard,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
  type Tone,
} from "../../camp-ui";
import { Section, ToneBox } from "./parts";
import {
  hasAcceptedExtension,
  MAX_COLS,
  MAX_FILE_BYTES,
  MAX_ROWS,
  MAX_SHEETS,
  readWorkbook,
} from "./read-workbook";
import { issueText, isMessageKey, type Translate } from "./shared";

type Kind = ImportPreview["kind"];

const HINTS: Record<Kind, MessageKey[]> = {
  registry: [
    "camp.upload.hint.registrySheets",
    "camp.upload.hint.registryHeaders",
    "camp.upload.hint.registryBlocks",
    "camp.upload.hint.registryChecks",
    "camp.upload.hint.reupload",
  ],
  agenda: [
    "camp.upload.hint.agendaSheets",
    "camp.upload.hint.agendaRow2",
    "camp.upload.hint.agendaItems",
    "camp.upload.hint.agendaTypes",
    "camp.upload.hint.agendaCues",
  ],
};

const STATUS_TONE: Record<ImportPreview["status"], Tone> = {
  preview: "warn",
  applied: "good",
  discarded: "muted",
};

export function ImportTab({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { edit, loaded } = useCampAbilities();
  const invalidate = useInvalidateCamp();
  const { confirm, confirmDialog } = useConfirm();
  const listFn = useServerFn(listCampImports);
  const previewFn = useServerFn(previewCampImport);
  const applyFn = useServerFn(applyCampImport);
  const discardFn = useServerFn(discardCampImport);
  const history = useQuery({ queryKey: campKey("imports"), queryFn: () => listFn() });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [phase, setPhase] = useState<"idle" | "reading" | "checking">("idle");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mine = (history.data ?? []).filter((x) => x.kind === kind);
  // A preview left open from an earlier visit (or by a colleague) is still saveable.
  const waiting = mine.find((x) => x.status === "preview" && x.id !== preview?.id);
  // Keep the open preview in step with the list (its status changes on save or cancel).
  const shown = preview ? (mine.find((x) => x.id === preview.id) ?? preview) : null;

  const apply = useMutation({
    mutationFn: (id: string) => applyFn({ data: { id } }),
    onSuccess: async (res) => {
      toast.success(t("camp.upload.applied", { file: res.fileName }));
      setPreview(null);
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const discard = useMutation({
    mutationFn: (id: string) => discardFn({ data: { id } }),
    onSuccess: async () => {
      toast.success(t("camp.upload.discarded"));
      setPreview(null);
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  async function handleFile(file: File) {
    if (!hasAcceptedExtension(file.name)) {
      toast.error(t("camp.upload.wrongType"));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t("camp.upload.tooLarge"));
      return;
    }
    setPhase("reading");
    try {
      let read: Awaited<ReturnType<typeof readWorkbook>>;
      try {
        read = await readWorkbook(file);
      } catch {
        toast.error(t("camp.upload.unreadable"));
        return;
      }
      if (!read.sheets.some((s) => s.rows.length)) {
        toast.error(t("camp.upload.emptyFile"));
        return;
      }
      if (read.truncated)
        toast.warning(t("camp.upload.truncated", { rows: MAX_ROWS, cols: MAX_COLS }));
      if (read.skippedSheets)
        toast.warning(
          t("camp.upload.sheetsSkipped", { count: read.skippedSheets, max: MAX_SHEETS }),
        );
      setPhase("checking");
      const res = await previewFn({
        data: { kind, fileName: file.name.slice(0, 255), sheets: read.sheets },
      });
      setPreview(res);
      await invalidate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPhase("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function save(p: ImportPreview) {
    const removed = p.diff.reduce((n, e) => n + e.removed.length, 0);
    if (removed > 0) {
      const ok = await confirm({
        title: t("camp.upload.confirmTitle"),
        description: t("camp.upload.confirmRemoved", { count: removed }),
        confirmLabel: t("camp.btn.save"),
        cancelLabel: t("camp.btn.cancel"),
        destructive: true,
      });
      if (!ok) return;
    }
    apply.mutate(p.id);
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && phase === "idle") void handleFile(file);
  };

  const busy = phase !== "idle";

  return (
    <div className="space-y-4">
      <Section title={t("camp.upload.expectsTitle")}>
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
          {HINTS[kind].map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </Section>

      {edit ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${
            dragging ? "border-primary bg-accent/50" : "bg-card"
          }`}
        >
          <FileSpreadsheet className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm">
            {kind === "registry" ? t("camp.upload.dropRegistry") : t("camp.upload.dropAgenda")}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="sr-only"
            id={`camp-upload-${kind}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? (
              <Loader2 className="me-1 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="me-1 h-4 w-4" />
            )}
            {phase === "reading"
              ? t("camp.upload.reading")
              : phase === "checking"
                ? t("camp.upload.checking")
                : t("camp.upload.chooseFile")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("camp.upload.nothingSaved")}</p>
        </div>
      ) : loaded ? (
        <ToneBox tone="muted">{t("camp.upload.editorsOnly")}</ToneBox>
      ) : null}

      {waiting && edit ? (
        <ToneBox
          tone="warn"
          title={t("camp.upload.waitingTitle")}
          action={
            <Button size="sm" variant="outline" onClick={() => setPreview(waiting)}>
              <Eye className="me-1 h-4 w-4" />
              {t("camp.upload.review")}
            </Button>
          }
        >
          <span dir="auto">
            {t("camp.upload.waiting", {
              file: waiting.fileName,
              time: fmt.dateTime(waiting.createdAt),
            })}
          </span>
        </ToneBox>
      ) : null}

      {shown ? (
        <ImportPreviewPanel
          preview={shown}
          canEdit={edit}
          saving={apply.isPending}
          discarding={discard.isPending}
          onSave={() => void save(shown)}
          onDiscard={() => discard.mutate(shown.id)}
          onClose={() => setPreview(null)}
        />
      ) : null}

      <Section title={t("camp.upload.historyTitle")}>
        <QueryState
          isPending={history.isPending}
          isError={history.isError}
          error={history.error}
          onRetry={() => void history.refetch()}
        >
          {mine.length ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("camp.upload.col.file")}</TableHead>
                    <TableHead>{t("camp.upload.col.uploadedAt")}</TableHead>
                    <TableHead>{t("camp.common.status")}</TableHead>
                    <TableHead>{t("camp.upload.col.issues")}</TableHead>
                    <TableHead>{t("camp.upload.col.contents")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mine.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={shown?.id === row.id ? "selected" : undefined}
                    >
                      <TableCell className="max-w-64 truncate" dir="auto" title={row.fileName}>
                        {row.fileName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {fmt.dateTime(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <ToneBadge tone={STATUS_TONE[row.status]}>
                          {t(`camp.upload.status.${row.status}`)}
                        </ToneBadge>
                      </TableCell>
                      <TableCell className="tabular-nums">{row.issues.length}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <SummaryText summary={row.summary} />
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => setPreview(row)}
                        >
                          <Eye className="me-1 h-3.5 w-3.5" />
                          {t("camp.upload.show")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("camp.upload.noHistory")}</p>
          )}
        </QueryState>
      </Section>
      {confirmDialog}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SummaryText({ summary }: { summary: Record<string, number> }) {
  const { t } = useTranslation();
  const parts = Object.entries(summary).map(([key, value]) => {
    const k = `camp.upload.summary.${key}`;
    return `${isMessageKey(k) ? t(k) : key} ${value}`;
  });
  return <>{parts.length ? parts.join(" · ") : "—"}</>;
}

function ImportPreviewPanel({
  preview,
  canEdit,
  saving,
  discarding,
  onSave,
  onDiscard,
  onClose,
}: {
  preview: ImportPreview;
  canEdit: boolean;
  saving: boolean;
  discarding: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const pending = preview.status === "preview";
  const issues = preview.issues;

  const exportIssues = async () => {
    await ensureLocaleDict("ar");
    const ar: Translate = (key, params) => tFor("ar", key, params);
    await downloadWorkbook("ملاحظات الملف المرفوع", [
      {
        name: "ملاحظات الملف المرفوع",
        headers: ["الورقة", "الصف", "الملاحظة"],
        rows: issues.map((issue) => [
          issue.sheet ?? "",
          issue.row ?? null,
          issueText(issue, ar, formatDateAr),
        ]),
      },
    ]);
  };

  return (
    <Section
      title={pending ? t("camp.upload.previewTitle") : t("camp.upload.pastTitle")}
      description={
        <span dir="auto">
          {preview.fileName} · {fmt.dateTime(preview.createdAt)}
        </span>
      }
      actions={
        <>
          {pending && canEdit ? (
            <>
              <Button size="sm" disabled={saving || discarding} onClick={onSave}>
                {saving ? (
                  <Loader2 className="me-1 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="me-1 h-4 w-4" />
                )}
                {t("camp.btn.save")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving || discarding}
                onClick={onDiscard}
              >
                {discarding ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : null}
                {t("camp.btn.cancel")}
              </Button>
            </>
          ) : (
            <ToneBadge tone={STATUS_TONE[preview.status]}>
              {t(`camp.upload.status.${preview.status}`)}
            </ToneBadge>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={onClose}
            aria-label={t("camp.upload.close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      }
      className="border-primary/40"
    >
      <div className="space-y-4">
        {issues.length ? (
          <div className="space-y-2">
            <ToneBox
              tone="warn"
              title={t("camp.msg.M11", { count: issues.length })}
              action={
                <Button size="sm" variant="outline" onClick={() => void exportIssues()}>
                  <Download className="me-1 h-4 w-4" />
                  {t("camp.btn.exportExcel")}
                </Button>
              }
            />
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">{t("camp.upload.col.sheet")}</TableHead>
                    <TableHead className="w-16">{t("camp.upload.col.row")}</TableHead>
                    <TableHead>{t("camp.upload.col.issue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((issue, index) => (
                    <TableRow key={`${issue.code}-${index}`}>
                      <TableCell className="text-xs" dir="auto">
                        {issue.sheet ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">{issue.row ?? "—"}</TableCell>
                      <TableCell className="text-sm" dir="auto">
                        {issueText(issue, t, fmt.date)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <ToneBox tone="good">{t("camp.upload.noIssues")}</ToneBox>
        )}

        {Object.keys(preview.summary).length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(preview.summary).map(([key, value]) => {
              const k = `camp.upload.summary.${key}`;
              return <StatCard key={key} label={isMessageKey(k) ? t(k) : key} value={value} />;
            })}
          </div>
        ) : null}

        {preview.diff.length ? (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">{t("camp.upload.diffTitle")}</h4>
            {pending ? (
              <p className="text-xs text-muted-foreground">{t("camp.upload.diffHint")}</p>
            ) : null}
            <div className="grid gap-2 lg:grid-cols-2">
              {preview.diff.map((entry) => (
                <DiffEntity key={entry.entity} entry={entry} />
              ))}
            </div>
          </div>
        ) : null}

        {preview.kind === "agenda" && preview.cueShifts.length ? (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">{t("camp.upload.cueShiftsTitle")}</h4>
            <ToneBox tone="info">{t("camp.upload.cueShiftsHint")}</ToneBox>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("camp.upload.col.cue")}</TableHead>
                    <TableHead>{t("camp.common.day")}</TableHead>
                    <TableHead>{t("camp.upload.col.from")}</TableHead>
                    <TableHead>{t("camp.upload.col.to")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.cueShifts.map((shift) => (
                    <TableRow key={`${shift.cue}-${shift.dayNo}`}>
                      <TableCell className="font-medium" dir="ltr">
                        {shift.cue}
                      </TableCell>
                      <TableCell className="tabular-nums">{shift.dayNo}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmt.hhmm(shift.from)}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmt.hhmm(shift.to)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

const LIST_CAP = 150;

function DiffEntity({ entry }: { entry: ImportPreview["diff"][number] }) {
  const { t } = useTranslation();
  const entityKey = `camp.upload.entity.${entry.entity}`;
  const fieldLabel = (field: string) => {
    const k = `camp.upload.field.${field}`;
    return isMessageKey(k) ? t(k) : field;
  };
  const changes = entry.added.length + entry.removed.length + entry.changed.length;
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {isMessageKey(entityKey) ? t(entityKey) : entry.entity}
        </span>
        <span className="flex flex-wrap gap-1.5">
          <ToneBadge tone={entry.added.length ? "good" : "muted"}>
            {t("camp.upload.diff.added", { count: entry.added.length })}
          </ToneBadge>
          <ToneBadge tone={entry.removed.length ? "bad" : "muted"}>
            {t("camp.upload.diff.removed", { count: entry.removed.length })}
          </ToneBadge>
          <ToneBadge tone={entry.changed.length ? "warn" : "muted"}>
            {t("camp.upload.diff.changed", { count: entry.changed.length })}
          </ToneBadge>
          <ToneBadge tone="muted">
            {t("camp.upload.diff.unchanged", { count: entry.unchanged })}
          </ToneBadge>
        </span>
      </div>
      {changes ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="ghost" className="mt-2 h-7 px-2 text-xs">
              <ChevronDown className="me-1 h-3.5 w-3.5" />
              {t("camp.upload.diff.details")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-3 text-sm">
            <DiffList
              title={t("camp.upload.diff.addedTitle")}
              tone="good"
              items={entry.added.map((x) => ({ key: x.key, text: x.label }))}
            />
            <DiffList
              title={t("camp.upload.diff.removedTitle")}
              tone="bad"
              items={entry.removed.map((x) => ({ key: x.key, text: x.label }))}
            />
            <DiffList
              title={t("camp.upload.diff.changedTitle")}
              tone="warn"
              items={entry.changed.map((x) => ({
                key: x.key,
                text: x.label,
                detail: x.fields.map(fieldLabel).join("، "),
              }))}
            />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function DiffList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: Tone;
  items: { key: string; text: string; detail?: string }[];
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium">
        <ToneBadge tone={tone}>{title}</ToneBadge>
      </p>
      <ul className="max-h-60 space-y-0.5 overflow-y-auto ps-1 text-xs">
        {items.slice(0, LIST_CAP).map((item) => (
          <li key={item.key} className="flex flex-wrap gap-x-2">
            <span dir="auto">{item.text}</span>
            {item.detail ? (
              <span className="text-muted-foreground">
                ({t("camp.upload.diff.fields", { fields: item.detail })})
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {items.length > LIST_CAP ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("camp.upload.diff.more", { count: items.length - LIST_CAP })}
        </p>
      ) : null}
    </div>
  );
}
