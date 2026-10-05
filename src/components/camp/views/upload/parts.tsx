/**
 * Camp operations — small presentational pieces used by the Data upload,
 * Settings and Exports screens.
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Plus, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/utils";
import { toneColor, type Tone } from "../../camp-ui";

const TONE_ICON: Record<Tone, typeof Info> = {
  good: CheckCircle2,
  warn: AlertTriangle,
  bad: XCircle,
  info: Info,
  muted: Info,
};

/** A tinted notice box in one of the RAG tones (no raw colours, §7). */
export function ToneBox({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const color = toneColor(tone);
  const Icon = TONE_ICON[tone];
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border p-3 text-sm",
        className,
      )}
      style={{
        borderColor: `color-mix(in oklab, ${color} 50%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color} 9%, transparent)`,
      }}
      role={tone === "bad" ? "alert" : undefined}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/** A titled card section. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? (
            <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Free-text values as removable chips, with an add box (role labels, topics, honorifics). */
export function ChipListEditor({
  values,
  onChange,
  disabled,
  placeholder,
  addLabel,
  maxLength = 200,
  maxItems = 50,
  inputId,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  addLabel: string;
  maxLength?: number;
  maxItems?: number;
  inputId?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    const exists = values.some((v) => v.toLowerCase() === value.toLowerCase());
    if (!exists && values.length < maxItems) onChange([...values, value.slice(0, maxLength)]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.length ? (
          values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pe-1 ps-2.5 text-xs"
            >
              <span dir="auto">{value}</span>
              {disabled ? null : (
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onChange(values.filter((v) => v !== value))}
                  aria-label={t("camp.settings.removeValue", { value })}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{t("camp.settings.emptyList")}</span>
        )}
      </div>
      {disabled ? null : (
        <div className="flex max-w-md gap-2">
          <Input
            id={inputId}
            dir="auto"
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="h-8"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={add}
            disabled={!draft.trim() || values.length >= maxItems}
          >
            <Plus className="me-1 h-3.5 w-3.5" />
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
