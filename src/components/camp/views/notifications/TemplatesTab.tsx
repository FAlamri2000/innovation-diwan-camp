/**
 * الرسائل الشخصية — the M01/M02 naming messages and the P01–P07 nudges (§9,
 * §11). Each shows when it is sent and to whom; admins edit the text and turn
 * the automatic ones on or off; editors send a test to their own account.
 * FR-NOT-04: at most N nudges per person per day, none during breaks.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Info, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { saveCampTemplate } from "@/lib/camp-admin.functions";
import type { TemplateRow } from "@/lib/camp/types";
import {
  errorMessage,
  ToneBadge,
  useCampAbilities,
  useCampFormat,
  useInvalidateCamp,
} from "../../camp-ui";
import { CharCount, FieldChips, FieldText, TestSendButton, TextProblems } from "./shared";
import { textBlocked, textLength, useTextareaRef, type Messaging } from "./lib";

/** Direct messages: the server accepts up to 4,000 characters. */
const DM_LIMIT = 4000;

/** The fields each sender fills (camp-admin / camp-actions / automation). */
const TEMPLATE_FIELDS: Record<string, string[]> = {
  M01: ["الاسم", "الاسم المقترح"],
  M02: ["الاسم", "الاسم المقترح"],
  P01: ["الاسم", "الفقرة", "الوقت", "المكان"],
  P02: ["الاسم", "الرقم"],
  P03: ["الاسم", "الفقرة", "الرقم"],
  P05: ["الاسم", "اسم الحساب"],
  P06: ["الاسم"],
  P07: ["الاسم", "الوقت"],
};

/** Sent by the scheduler, so the on/off switch means something. M01, M02 and
 *  P05 go out only when an operator sends them. */
const AUTOMATIC = new Set(["P01", "P02", "P03", "P04", "P06", "P07"]);

/** P04 has no text of its own: it sends M01 or M02. */
const USES_NAMING = "P04";

const KNOWN = new Set(["M01", "M02", "P01", "P02", "P03", "P04", "P05", "P06", "P07"]);

function useSaveTemplate() {
  const { t } = useTranslation();
  const invalidate = useInvalidateCamp();
  const fn = useServerFn(saveCampTemplate);
  return useMutation({
    mutationFn: (v: { key: string; text: string; enabled: boolean }) => fn({ data: v }),
    onSuccess: async () => {
      toast.success(t("camp.common.saved"));
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function TemplatesTab({ messaging }: { messaging: Messaging }) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const naming = messaging.templates.filter((x) => x.kind === "message");
  const nudges = messaging.templates.filter((x) => x.kind === "nudge");

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {t("camp.notif.maxPerDay", { count: messaging.maxNudgesPerDay })}
      </div>

      {nudges.length ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("camp.notif.groupNudges")}</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {nudges.map((x) => (
              <TemplateCard
                key={x.key}
                template={x}
                myAccount={messaging.myAccount}
                onEdit={() => setEditing(x)}
                triggerParams={{
                  time: fmt.hhmm(messaging.namingReminderTime),
                  max: messaging.namingReminderMax,
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {naming.length ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("camp.notif.groupNaming")}</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {naming.map((x) => (
              <TemplateCard
                key={x.key}
                template={x}
                myAccount={messaging.myAccount}
                onEdit={() => setEditing(x)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {!messaging.templates.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          {t("camp.common.noResults")}
        </p>
      ) : null}

      {editing ? (
        <TemplateDialog
          key={editing.key}
          template={editing}
          myAccount={messaging.myAccount}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function TemplateCard({
  template: x,
  myAccount,
  onEdit,
  triggerParams,
}: {
  template: TemplateRow;
  myAccount: string | null;
  onEdit: () => void;
  /** Live P04 settings: reminder time and the cap (FR-NOT P04). */
  triggerParams?: Record<string, string | number>;
}) {
  const { t } = useTranslation();
  const { admin } = useCampAbilities();
  const save = useSaveTemplate();
  const known = KNOWN.has(x.key);
  const automatic = AUTOMATIC.has(x.key);
  const ownText = x.key !== USES_NAMING;
  return (
    <article
      className={`flex flex-col gap-3 rounded-lg border bg-card p-4 ${
        automatic && !x.enabled ? "opacity-70" : ""
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <ToneBadge tone="info">{x.key}</ToneBadge>
            {known ? t(`camp.template.${x.key}` as MessageKey) : null}
          </p>
        </div>
        {automatic ? (
          admin ? (
            <label className="flex items-center gap-2 text-sm">
              {x.enabled ? t("camp.notif.on") : t("camp.notif.off")}
              <Switch
                checked={x.enabled}
                disabled={save.isPending}
                onCheckedChange={(enabled) => save.mutate({ key: x.key, text: x.text, enabled })}
                aria-label={x.key}
              />
            </label>
          ) : (
            <ToneBadge tone={x.enabled ? "good" : "muted"}>
              {x.enabled ? t("camp.notif.on") : t("camp.notif.off")}
            </ToneBadge>
          )
        ) : (
          <ToneBadge tone="muted">{t("camp.notif.manual")}</ToneBadge>
        )}
      </header>

      {known ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("camp.notif.when")}</dt>
          <dd>{t(`camp.notif.trigger.${x.key}` as MessageKey, triggerParams)}</dd>
          <dt className="text-muted-foreground">{t("camp.notif.to")}</dt>
          <dd>{t(`camp.notif.recipient.${x.key}` as MessageKey)}</dd>
        </dl>
      ) : null}

      {ownText ? (
        <div className="rounded-md border bg-muted/20 p-3">
          <FieldText text={x.text} />
        </div>
      ) : (
        <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
          {t("camp.notif.usesNaming")}
        </p>
      )}
      {!automatic ? (
        <p className="text-xs text-muted-foreground">{t("camp.notif.manualHint")}</p>
      ) : null}

      {ownText ? (
        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <CharCount count={textLength(x.text)} limit={DM_LIMIT} />
          <div className="flex flex-wrap gap-2">
            <TestSendButton text={x.text} myAccount={myAccount} />
            {admin ? (
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Pencil className="me-1 h-3.5 w-3.5" />
                {t("camp.notif.edit")}
              </Button>
            ) : null}
          </div>
        </footer>
      ) : null}
    </article>
  );
}

function TemplateDialog({
  template,
  myAccount,
  onClose,
}: {
  template: TemplateRow;
  myAccount: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const save = useSaveTemplate();
  const textareaRef = useTextareaRef();
  const [text, setText] = useState(template.text);
  const fields = TEMPLATE_FIELDS[template.key] ?? [];
  const blocked = textBlocked(text, DM_LIMIT, fields);
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("camp.notif.editTemplate", { key: template.key })}</DialogTitle>
          {KNOWN.has(template.key) ? (
            <DialogDescription>
              {t(`camp.template.${template.key}` as MessageKey)}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="tpl-text">{t("camp.notif.text")}</Label>
              <CharCount count={textLength(text)} limit={DM_LIMIT} />
            </div>
            <Textarea
              id="tpl-text"
              ref={textareaRef}
              dir="auto"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={blocked}
            />
            <TextProblems text={text} limit={DM_LIMIT} allowed={fields} />
            <FieldChips fields={fields} textareaRef={textareaRef} value={text} onChange={setText} />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("camp.notif.preview")}</p>
            <div className="rounded-md border bg-muted/20 p-3">
              <FieldText text={text || "—"} />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <TestSendButton text={text} myAccount={myAccount} disabled={blocked} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("camp.btn.cancel")}
            </Button>
            <Button
              disabled={blocked || save.isPending}
              onClick={() =>
                save.mutate(
                  { key: template.key, text: text.trim(), enabled: template.enabled },
                  { onSuccess: onClose },
                )
              }
            >
              {save.isPending ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : null}
              {t("camp.btn.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
