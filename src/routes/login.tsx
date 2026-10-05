import { useState, type FormEvent } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { BrandPanel } from "@/components/BrandPanel";
import { LanguageSwitch } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/i18n/use-translation";
import { signIn } from "@/lib/auth.functions";
import { errorMessage } from "@/components/camp/camp-ui";

/** Only same-site paths: never let ?next= send someone off the app. */
function safeNext(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : undefined;
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: safeNext(search.next),
  }),
  beforeLoad: ({ context, search }) => {
    if (context.boot.user) throw redirect({ href: search.next ?? "/" });
  },
  head: () => ({ meta: [{ title: "تسجيل الدخول — ديوان الابتكار" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const { next } = Route.useSearch();
  const submit = useServerFn(signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submit({ data: { email, password } });
      // A full load: the session cookie is new, so the server renders the app.
      window.location.assign(next ?? "/");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <BrandPanel className="hidden lg:flex" />

      <main className="flex flex-col">
        <div className="flex items-center justify-between gap-3 bg-sidebar bg-motif px-4 py-3 lg:hidden">
          <img src="/brand/diwan-white.png" alt={t("app.program")} className="h-10 w-auto" />
          <LanguageSwitch tone="dark" />
        </div>
        <div className="hidden justify-end p-4 lg:flex">
          <LanguageSwitch />
        </div>

        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6" noValidate>
            <div className="space-y-2">
              <h1 className="brand-underline text-2xl font-bold">{t("auth.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("auth.subtitle")}</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  dir="ltr"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!error}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!error}
                />
              </div>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={busy || !email || !password}
            >
              {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {busy ? t("auth.signingIn") : t("auth.submit")}
            </Button>

            <p className="text-center text-xs text-muted-foreground">{t("auth.help")}</p>
          </form>
        </div>
      </main>
    </div>
  );
}
