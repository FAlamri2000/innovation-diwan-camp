import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/** A server function refusing the session means it expired or was revoked:
 *  go to the sign-in page instead of rendering an error in every panel. */
function onUnauthorized(error: unknown) {
  if (typeof window === "undefined") return;
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Unauthorized") && window.location.pathname !== "/login") {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    // Cache-level handlers fire in addition to each query's/mutation's own.
    queryCache: new QueryCache({ onError: onUnauthorized }),
    mutationCache: new MutationCache({ onError: onUnauthorized }),
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    },
  });

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
};
