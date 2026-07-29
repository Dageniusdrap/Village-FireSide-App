export type OfflineRedirectState = {
  isConnected: boolean;
  segments: readonly string[];
};

/**
 * Pure decision for the root layout's one-time cold-start check: if
 * there's no connectivity and the user is about to land on the default
 * Home tab, send them to Library instead — but never override a deep
 * link into any other route. The "only ever run this once per app
 * session" rule lives in the calling effect (a useRef), not here.
 */
export function resolveOfflineLaunchRedirect(state: OfflineRedirectState): "/library" | null {
  if (state.isConnected) {
    return null;
  }
  const onHomeTab =
    state.segments[0] === "(app)" && state.segments[1] === "(tabs)" && state.segments.length === 2;
  return onHomeTab ? "/library" : null;
}
