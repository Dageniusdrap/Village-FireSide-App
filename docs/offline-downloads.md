# Offline Downloads

## How it works

1. Tapping the download icon on an episode row, or "Download series" on
   a series detail page, calls `download-queue-store.ts`'s `enqueue`/
   `enqueueSeries`.
2. `enqueue` calls `resolveRemoteEpisodeSource` — the exact same
   accessibility check the player uses (free, coin-unlocked, or active
   premium). A locked episode never enters the queue; the user sees a
   toast instead.
3. Downloads run one at a time (`download-queue-store.ts`), writing to
   a temp file via `expo-file-system`'s resumable download task, then
   renaming to a final path and recording it in a local SQLite table
   (`downloads-db.ts`) once complete.
4. `local-downloads.ts`'s `getLocalDownloadPath` — the seam Prompt 8
   built — looks up that table. `resolve-episode-source.ts` already
   prefers a local path over streaming, so playback picks up downloaded
   episodes automatically with no player changes.

## Fairness: downloads are permanent

Once an episode is downloaded, there is no further entitlement check at
offline playback time — mirrors Prompt 9's "unlocked episodes stay
unlocked through a premium lapse" rule. If a premium-tier episode was
downloaded while a subscription was active and that subscription later
lapses, the downloaded file keeps playing. Re-verifying entitlement for
offline playback would mean either phoning home (defeating the point of
"offline") or trusting a locally-stored expiry against a device clock
that can't be trusted to enforce it — this is a deliberate simplification,
not an oversight. Only the _download action itself_ is gated on current
accessibility; already-downloaded files are exempt from any later
re-check.

## Wifi-only by default

`Settings` → "Download over Wi-Fi only" defaults **on**, to protect
users' data bundles. When enabled, a queued download that's only
reachable over cellular sits in a `paused_wifi` state until Wi-Fi
becomes available (or the setting is turned off), at which point it
resumes automatically.

## Security note

Downloaded audio files live in the app's sandboxed documents directory
with no additional encryption or DRM beyond the OS's own app sandboxing.
This is an accepted trade-off for v1 — acceptable because these are the
same publicly-licensed/produced episodes the app already streams, not a
higher-security asset class. If piracy of downloaded audio becomes a
real problem, a DRM-backed streaming approach (e.g. FairPlay/Widevine)
is the natural future option, at the cost of losing simple
file-based offline playback.

## Known scope boundaries (v1)

- **Foreground-only downloads.** No background `URLSession`/foreground
  service — a backgrounded download pauses and needs the app reopened to
  resume or be retried.
- **Cold-start-only offline detection.** Connectivity is checked once at
  launch to decide whether to land on Library instead of Home. A
  connection dropping mid-session shows the banner but never
  force-navigates the user away from what they're doing.
