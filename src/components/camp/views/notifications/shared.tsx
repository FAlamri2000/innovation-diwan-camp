/**
 * Camp operations — components shared by the notifications tabs (Module 6):
 * the live character counter (FR-NOT-02), field chips and marked text, and the
 * "test to my account" button (FR-NOT-03). Data and rules live in ./lib.ts.
 */
import { type RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/use-translation";
import { sendCampTest } from "@/lib/camp-admin.functions";
import { errorMessage, toneColor, useCampAbilities } from "../../camp-ui";
import { textLength, unknownFields } from "./lib";

export function CharCount({ count, limit }: { count: number; limit: number }) {
  const { t } = useTranslation();
  const over = count > limit;
  const near = !over && count > limit * 0.9;
  return (
    <span
      className="text-xs tabular-nums"
      style={over || near ? { color: toneColor(over ? "bad" : "warn") } : undefined}
      aria-live="polite"
    >
      {t("camp.notif.chars", { count, limit })}
    </span>
  );
}

/** Problems that block saving or sending a text. */
export function TextProblems({
  text,
  limit,
  allowed,
}: {
  text: string;
  limit: number;
  allowed: readonly string[];
}) {
  const { t, locale } = useTranslation();
  const unknown = unknownFields(text, allowed);
  const over = textLength(text) > limit;
  if (!unknown.length && !over) return null;
  return (
    <div className="space-y-1 text-xs" style={{ color: toneColor("bad") }} role="alert">
      {over ? <p>{t("camp.notif.overLimit", { limit })}</p> : null}
      {unknown.length ? (
        <p>
          {t("camp.notif.unknownFields", {
            fields: unknown.map((f) => `{${f}}`).join(locale === "ar" ? "، " : ", "),
          })}
        </p>
      ) : null}
    </div>
  );
}

/** Clickable field chips that insert "{field}" at the cursor. */
export function FieldChips({
  fields,
  textareaRef,
  value,
  onChange,
}: {
  fields: readonly string[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  if (!fields.length)
    return <p className="text-xs text-muted-foreground">{t("camp.notif.noFields")}</p>;
  const insert = (field: string) => {
    const token = `{${field}}`;
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {t("camp.notif.fields")} · {t("camp.notif.fieldsHint")}
      </p>
      <div className="flex flex-wrap gap-1.5" dir="rtl">
        {fields.map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => insert(f)}
          >
            {`{${f}}`}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Message text with its {fields} marked, for previews and lists. */
export function FieldText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\{[^{}]+\})/g);
  return (
    <p dir="auto" className={className ?? "whitespace-pre-wrap text-sm leading-relaxed"}>
      {parts.map((part, i) =>
        /^\{[^{}]+\}$/.test(part) ? (
          <mark
            key={i}
            className="rounded px-0.5 text-foreground"
            style={{
              backgroundColor: `color-mix(in oklab, ${toneColor("info")} 18%, transparent)`,
            }}
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Test send (FR-NOT-03)
// ---------------------------------------------------------------------------

export function TestSendButton({
  text,
  myAccount,
  disabled,
  compact,
}: {
  text: string;
  myAccount: string | null;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { edit } = useCampAbilities();
  const fn = useServerFn(sendCampTest);
  const test = useMutation({
    mutationFn: () => fn({ data: { text: text.trim() } }),
    onSuccess: (res) => {
      if (res.delivered > 0) toast.success(t("camp.notif.testSent"));
      else toast.error(t("camp.notif.testFailed"));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!edit) return null;
  const label = t("camp.notif.test");
  return (
    <Button
      type="button"
      size="sm"
      variant={compact ? "ghost" : "outline"}
      className={compact ? "h-7 px-2" : undefined}
      disabled={disabled || !myAccount || !text.trim() || test.isPending}
      title={myAccount ? label : t("camp.notif.noAccount")}
      aria-label={compact ? label : undefined}
      onClick={() => test.mutate()}
    >
      {test.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FlaskConical className="h-3.5 w-3.5" />
      )}
      {compact ? null : <span className="ms-1">{label}</span>}
    </Button>
  );
}
