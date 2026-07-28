// `type` is deliberately a plain `string`, not a closed union mirroring
// NetInfo's own `NetInfoStateType` enum — the real `NetInfoState` object
// passed in by download-queue-store.ts should satisfy this structurally
// with no cast, and the only comparison that matters is "is it exactly
// wifi", so a wider type here costs nothing.
export function shouldPauseForWifi(netState: { type: string }, wifiOnlyEnabled: boolean): boolean {
  if (!wifiOnlyEnabled) {
    return false;
  }
  return netState.type !== "wifi";
}
