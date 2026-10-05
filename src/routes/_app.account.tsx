import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/components/camp/camp-ui";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { changePassword } from "@/lib/auth.functions";

const MIN_LENGTH = 10;

export const Route = createFileRoute("/_app/account")({
  head: () => ({ meta: [{ title: "حسابي — ديوان الابتكار" }] }),
  component: AccountPage,
});

function AccountPage() {
  const { t } = useTranslation();
  const { user } = Route.useRouteContext();
  const save = useServerFn(changePassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (next.length < MIN_LENGTH) return setError(t("auth.error.tooShort", { min: MIN_LENGTH }));
    if (next !== confirm) return setError(t("auth.error.mismatch"));
    setBusy(true);
    try {
      await save({ data: { current, next } });
      toast.success(t("account.saved"));
      // A forced change unlocks the rest of the app; reload so the gate re-reads it.
      if (user.mustChangePassword) window.location.assign("/");
      else {
        setCurrent("");
        setNext("");
        setConfirm("");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-bold">{t("account.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("account.subtitle")}</p>
      </div>

      {user.mustChangePassword ? (
        <p
          role="status"
          className="rounded-md border border-highlight bg-highlight/15 p-3 text-sm font-medium"
        >
          {t("account.mustChange")}
        </p>
      ) : null}

      <section className="rounded-lg border bg-card p-5">
        <h3 className="mb-3 font-bold">{t("account.profile")}</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("users.name")}</dt>
          <dd>{user.name || "—"}</dd>
          <dt className="text-muted-foreground">{t("users.email")}</dt>
          <dd dir="ltr" className="text-start">
            {user.email}
          </dd>
          <dt className="text-muted-foreground">{t("account.role")}</dt>
          <dd>{t(`role.${user.role}` as MessageKey)}</dd>
        </dl>
      </section>

      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-5" noValidate>
        <h3 className="font-bold">{t("account.changePassword")}</h3>
        <PasswordField
          id="current"
          label={t("account.current")}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <PasswordField
          id="next"
          label={t("account.new")}
          value={next}
          onChange={setNext}
          autoComplete="new-password"
        />
        <PasswordField
          id="confirm"
          label={t("account.confirm")}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">
          {t("auth.error.tooShort", { min: MIN_LENGTH })}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || !current || !next || !confirm}>
          {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("account.save")}
        </Button>
      </form>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        dir="ltr"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
