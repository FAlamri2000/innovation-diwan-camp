/**
 * The app frame: the deep-green rail (Innovation Diwan mark, the eleven camp
 * screens, admin-only access management, the signed-in user and partners), a
 * mobile bar with the same navigation in a sheet, and the page header. It also
 * owns the person profile any screen can open (PersonProvider/PersonSheet).
 */
import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Languages, LogOut, Menu, Moon, ShieldCheck, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PersonProvider } from "@/components/camp/camp-ui";
import { PersonSheet } from "@/components/camp/PersonSheet";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { setPreferences, signOut, type BootUser, type Theme } from "@/lib/auth.functions";
import { CAMP_NAV, campPath } from "@/lib/camp/nav";
import { cn } from "@/lib/utils";

type NavEntry = { to: string; labelKey: MessageKey; icon: typeof KeyRound };

function navFor(user: BootUser): NavEntry[] {
  const camp: NavEntry[] = CAMP_NAV.map((item) => ({
    to: campPath(item.segment),
    labelKey: item.labelKey,
    icon: item.icon,
  }));
  return user.role === "admin"
    ? [...camp, { to: "/access", labelKey: "shell.access", icon: ShieldCheck }]
    : camp;
}

function isActive(pathname: string, to: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
}

export function AppShell({
  user,
  theme,
  children,
}: {
  user: BootUser;
  theme: Theme;
  children: ReactNode;
}) {
  const { t, direction } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [personKey, setPersonKey] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const entries = navFor(user);

  return (
    <PersonProvider value={{ openPerson: setPersonKey }}>
      <div className="flex min-h-screen bg-background">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
          <RailBody user={user} theme={theme} entries={entries} pathname={pathname} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-sidebar px-3 py-2 text-sidebar-foreground md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={() => setMenuOpen(true)}
              aria-label={t("shell.menu")}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <img src="/brand/diwan-white.png" alt={t("app.program")} className="h-8 w-auto" />
            <LanguageSwitch tone="dark" compact />
          </div>

          <header className="border-b bg-card px-4 py-4 md:px-6">
            <h1 className="brand-underline text-lg font-bold md:text-xl">{t("camp.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("camp.subtitle")}</p>
          </header>

          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side={direction === "rtl" ? "right" : "left"}
          className="w-72 border-none bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t("shell.menu")}</SheetTitle>
          </SheetHeader>
          <div
            className="flex h-full flex-col"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setMenuOpen(false);
            }}
          >
            <RailBody user={user} theme={theme} entries={entries} pathname={pathname} />
          </div>
        </SheetContent>
      </Sheet>

      <PersonSheet personKey={personKey} onClose={() => setPersonKey(null)} />
    </PersonProvider>
  );
}

function RailBody({
  user,
  theme,
  entries,
  pathname,
}: {
  user: BootUser;
  theme: Theme;
  entries: NavEntry[];
  pathname: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="relative overflow-hidden border-b border-sidebar-border px-5 py-5">
        <div aria-hidden className="absolute inset-0 bg-motif opacity-60" />
        <Link
          to="/"
          className="relative block w-fit rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight"
        >
          <img src="/brand/diwan-white.png" alt={t("app.program")} className="h-14 w-auto" />
        </Link>
        <p className="relative mt-3 text-sm font-medium text-sidebar-muted">{t("app.shortName")}</p>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label={t("app.shortName")}>
        {entries.map((entry) => {
          const active = isActive(pathname, entry.to);
          const Icon = entry.icon;
          return (
            <Link
              key={entry.to}
              to={entry.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                  : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 start-0 w-1 rounded-full bg-highlight"
                />
              ) : null}
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{t(entry.labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 px-2">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sidebar-accent text-sm font-bold"
          >
            {(user.name || user.email).trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name || user.email}</p>
            <p className="truncate text-xs text-sidebar-muted">
              {t(`role.${user.role}` as MessageKey)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <RailButton asLink="/account" icon={KeyRound} label={t("shell.account")} />
          <SignOutButton />
          <LanguageSwitch tone="dark" />
          <ThemeToggle initial={theme} />
        </div>
        <div className="flex items-center justify-center gap-3 pt-1 opacity-80">
          <img src="/brand/misk-white.png" alt="Misk" className="h-7 w-auto" />
          <span aria-hidden className="h-6 w-px bg-sidebar-foreground/30" />
          <img src="/brand/haramain-white.png" alt="الحرمين" className="h-7 w-auto" />
        </div>
      </div>
    </>
  );
}

const railButtonClass =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight disabled:opacity-60";

function RailButton({
  asLink,
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  asLink?: string;
  icon: typeof KeyRound;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  if (asLink) {
    return (
      <Link to={asLink} className={railButtonClass}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="whitespace-nowrap">{label}</span>
      </Link>
    );
  }
  return (
    <button type="button" className={railButtonClass} onClick={onClick} disabled={disabled}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function SignOutButton() {
  const { t } = useTranslation();
  const fn = useServerFn(signOut);
  const [busy, setBusy] = useState(false);
  return (
    <RailButton
      icon={LogOut}
      label={t("shell.signOut")}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fn();
        } finally {
          window.location.assign("/login");
        }
      }}
    />
  );
}

/** Switch language: stored in a cookie so the server renders it, then reload. */
export function LanguageSwitch({
  tone = "light",
  compact = false,
}: {
  tone?: "light" | "dark";
  compact?: boolean;
}) {
  const { t, locale } = useTranslation();
  const fn = useServerFn(setPreferences);
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    await fn({ data: { locale: locale === "ar" ? "en" : "ar" } });
    window.location.reload();
  };
  if (tone === "dark") {
    return compact ? (
      <Button
        variant="ghost"
        size="sm"
        className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        onClick={onClick}
        disabled={busy}
      >
        <Languages className="me-1 h-4 w-4" aria-hidden />
        {t("shell.switchLanguage")}
      </Button>
    ) : (
      <RailButton
        icon={Languages}
        label={t("shell.switchLanguage")}
        onClick={onClick}
        disabled={busy}
      />
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={busy}>
      <Languages className="me-1 h-4 w-4" aria-hidden />
      {t("shell.switchLanguage")}
    </Button>
  );
}

function ThemeToggle({ initial }: { initial: Theme }) {
  const { t } = useTranslation();
  const fn = useServerFn(setPreferences);
  const [dark, setDark] = useState(initial === "dark");
  return (
    <RailButton
      icon={dark ? Sun : Moon}
      label={dark ? t("shell.themeLight") : t("shell.themeDark")}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        void fn({ data: { theme: next ? "dark" : "light" } });
      }}
    />
  );
}
