import { QueryClient } from "@tanstack/react-query";

// `.single()`/`.maybeSingle()` failures surface as PostgREST's PGRST116
// ("no rows returned") — a genuinely missing/unpublished row, not a
// transient failure, so retrying it just delays the "Not found" state the
// user is already correctly heading toward. Everything else (network
// blips, cold starts) still gets a couple of retries.
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && error.code === "PGRST116") {
    return false;
  }
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      staleTime: 30_000,
    },
  },
});
