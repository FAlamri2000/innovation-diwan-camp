import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { LocaleProvider, useLocale } from "@/i18n/locale-context";
import { getBoot, type Boot } from "@/lib/auth.functions";

/** The browser keeps the first boot for the life of the page; sign-in,
 *  sign-out and preference changes reload the page. */
let clientBoot: Boot | undefined;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async () => {
    if (typeof window !== "undefined" && clientBoot) return { boot: clientBoot };
    const boot = await getBoot();
    if (typeof window !== "undefined") clientBoot = boot;
    return { boot };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "عمليات المعسكر — ديوان الابتكار" },
      {
        name: "description",
        content:
          "لوحة عمليات المعسكر الافتراضي لبرنامج ديوان الابتكار: الحسابات والأسماء والحضور والتسجيلات والتنبيهات.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#00362e" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      {
        rel: "preload",
        as: "font",
        type: "font/ttf",
        href: "/fonts/Misk-Regular.ttf",
        crossOrigin: "anonymous",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});

function RootShell({ children }: { children: ReactNode }) {
  const { boot } = Route.useRouteContext();
  const locale = boot?.locale ?? "ar";
  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={boot?.theme === "dark" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function LocalizedToaster() {
  const { direction } = useLocale();
  return (
    <Toaster
      richColors
      position={direction === "rtl" ? "bottom-left" : "bottom-right"}
      dir={direction}
    />
  );
}

function RootComponent() {
  const { queryClient, boot } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider locale={boot.locale}>
        <Outlet />
        <LocalizedToaster />
      </LocaleProvider>
    </QueryClientProvider>
  );
}

function NotFound() {
  const { boot } = Route.useRouteContext();
  return (
    <LocaleProvider locale={boot?.locale ?? "ar"}>
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <p className="text-6xl font-bold text-primary">404</p>
          <h1 className="mt-4 text-xl font-bold">{t("app.notFound.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("app.notFound.description")}</p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("app.error.goHome")}
          </Link>
        </div>
      </div>
    </LocaleProvider>
  );
}

function RootError({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold">{t("app.error.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("app.error.description")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              void router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("app.error.tryAgain")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            {t("app.error.goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}
