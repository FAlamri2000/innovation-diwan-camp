import type { ReactNode } from "react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/i18n/use-translation";

/**
 * Loading / error / empty states for a query-backed surface.
 *
 * Exists because the codebase's default has been to render the EMPTY state on
 * failure — ServiceInbox shows "No incoming requests" when the query errored,
 * which tells the user the opposite of the truth (Nielsen N1: visibility of
 * system status, N9: help users recognize and recover from errors). Wrapping a
 * list in <QueryState> makes the three cases distinguishable and gives the
 * error case a retry.
 */

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: typeof Inbox;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <Icon className="h-7 w-7 text-muted-foreground/50" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function QueryState({
  isPending,
  isError,
  error,
  isEmpty,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyAction,
  skeletonRows = 3,
  children,
}: {
  isPending: boolean;
  isError?: boolean;
  error?: unknown;
  isEmpty?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  skeletonRows?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  if (isPending) {
    return (
      <div className="space-y-2" role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t("common.loading")}</span>
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    const message = error instanceof Error ? error.message : undefined;
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center"
      >
        <AlertCircle className="h-7 w-7 text-destructive/70" aria-hidden />
        <p className="text-sm font-medium">{t("common.loadFailed")}</p>
        {message && <p className="max-w-md text-xs text-muted-foreground">{message}</p>}
        {onRetry && (
          <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("common.retry")}
          </Button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle ?? t("common.nothingHere")}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return <>{children}</>;
}
