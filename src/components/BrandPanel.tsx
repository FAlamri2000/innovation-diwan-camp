/**
 * The identity panel: deep green, the geometric motif with yellow dots, the
 * Innovation Diwan mark, the campaign line, and the partners — Misk (the
 * programme owner) and the Two Holy Mosques authority (strategic partner).
 */
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/utils";

export function BrandPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <aside
      className={cn(
        "relative flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground",
        className,
      )}
    >
      <div aria-hidden className="absolute inset-0 bg-motif opacity-90" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 110%, color-mix(in oklab, var(--ring) 45%, transparent), transparent 60%)",
        }}
      />
      <div className="relative">
        <img src="/brand/diwan-white.png" alt={t("app.program")} className="h-24 w-auto" />
      </div>

      <div className="relative space-y-4">
        <p className="text-4xl font-bold leading-tight xl:text-5xl">{t("app.tagline")}</p>
        <p className="max-w-md text-lg font-light text-sidebar-muted">{t("auth.subtitle")}</p>
        <span aria-hidden className="block h-1 w-16 rounded-full bg-highlight" />
      </div>

      <div className="relative flex items-center gap-6">
        <img src="/brand/misk-white.png" alt="Misk" className="h-12 w-auto" />
        <span aria-hidden className="h-10 w-px bg-sidebar-foreground/30" />
        <img src="/brand/haramain-white.png" alt="الحرمين" className="h-12 w-auto" />
      </div>
    </aside>
  );
}
