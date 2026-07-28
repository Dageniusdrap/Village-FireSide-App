# Offline Downloads (Prompt 10) — Design Spec

## Scope

Offline listening for the mobile app, per `docs/PROMPT_PACK.md`'s Prompt 10:

- A download affordance on every episode row and a "Download series" bulk
  action, gated by the same accessibility check the player already makes
  (no new entitlement logic).
- A local SQLite manifest of downloaded episodes (`expo-sqlite`, new
  dependency) so the Library works fully offline.
- `apps/mobile/src/lib/local-downloads.ts`'s `getLocalDownloadPath` stub
  (built in Prompt 8 specifically as a seam) gets its real implementation;
  `resolve-episode-source.ts` and `player-store.ts` need no changes — they
  already prefer a local path over streaming.
- A download queue (Zustand store) with progress, pause/resume, retry, and
  a wifi-only gate (`@react-native-community/netinfo`, new dependency),
  default ON.
- A Downloads screen in the Library tab: list, total storage used, delete
  individual / delete all.
- A new minimal Settings screen (reachable from Profile) holding the
  wifi-only toggle.
- Cold-start offline mode: if there's no connectivity when the app
  launches, land on Library instead of Home; a small offline banner
  anywhere in the app.
- `docs/offline-downloads.md` documenting the sandbox/DRM note from the
  spec and the fairness consequence of this design (below).

**Fairness consequence (confirmed with the user, mirrors Prompt 9's
"unlocks stay unlocked" rule):** once an episode is downloaded, it is a
permanent local copy — there is no entitlement re-check at offline
playback time. If a premium subscription lapses after a premium-tier
episode was downloaded while active, the downloaded file keeps playing.
This is a deliberate simplification, not an oversight: re-verifying
entitlement for offline playback would mean either phoning home (defeats
"offline") or storing and trusting a local expiry timestamp the device
clock can't be trusted to enforce. The download _action_ itself is still
gated on current accessibility (see "Download gating" below) — only
already-downloaded files are exempt from re-checking.

**Non-goals (explicitly deferred):**

- **True background downloads** (iOS background `URLSession`, Android
  foreground service). Confirmed with the user: v1 is foreground-only —
  a backgrounded download pauses and needs the user to reopen the app to
  resume/retry. No native background-transfer configuration in this
  prompt.
- **Live (mid-session) offline redirect.** Confirmed with the user:
  connectivity is checked once at cold start. A dropped connection while
  the user is mid-session shows the banner but never force-navigates them.
- **DRM on downloaded files.** The spec explicitly asks for a security
  note, not a DRM implementation — noted in `docs/offline-downloads.md`
  as a future option, per the spec's own wording.
- **`default_free_episode_count` enforcement** — not yet consumed by any
  client code (Prompt 9 left this to a future admin-UI prompt); downloads
  gate on the same accessibility check as playback, whatever that check
  currently allows.
- **Cached browsing data for full offline browsing** (Explore/Learn/Home
  screens showing stale content when offline) — the spec's offline-mode
  bullet mentions this as "where possible"; TanStack Query's default
  cache already serves stale data from previous sessions with no extra
  work needed here, so this prompt does not add a deliberate
  cache-persistence layer (e.g. `persistQueryClient`) beyond that default.

## New dependencies

- `expo-sqlite` (`~57.x`, matching the installed Expo SDK) — the
  downloads manifest table.
- `@react-native-community/netinfo` — connectivity detection, used by the
  wifi-only gate, the offline banner, and the cold-start redirect.

## `apps/mobile/src/lib/downloads-db.ts` (new)

Opens one on-disk SQLite database and exposes plain CRUD functions — no
React hook wrapper, since this needs to be callable from the queue store
and from `local-downloads.ts`, not just from components:

```ts
import * as SQLite from "expo-sqlite";

const db = SQLite.openDatabaseSync("downloads.db");

db.execSync(`
  CREATE TABLE IF NOT EXISTS downloads (
    episode_id TEXT PRIMARY KEY NOT NULL,
    series_id TEXT NOT NULL,
    title TEXT NOT NULL,
    series_title TEXT NOT NULL,
    local_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    downloaded_at TEXT NOT NULL
  )
`);

export type DownloadRecord = {
  episodeId: string;
  seriesId: string;
  title: string;
  seriesTitle: string;
  localPath: string;
  fileSize: number;
  downloadedAt: string;
};

export function insertDownload(record: DownloadRecord): void {
  /* runSync INSERT OR REPLACE */
}
export function deleteDownload(episodeId: string): void {
  /* runSync DELETE */
}
export function getDownload(episodeId: string): DownloadRecord | null {
  /* getFirstSync */
}
export function getAllDownloads(): DownloadRecord[] {
  /* getAllSync, ordered by downloaded_at desc */
}
```

Table created eagerly at module load (mirrors the `progressFile` module-
scope pattern in `local-listening-progress.ts` — one shared handle, no
per-call open/close).

## `apps/mobile/src/lib/local-downloads.ts` (real implementation)

Replaces the Prompt 8 stub. Self-healing: if the OS ever evicts a
downloaded file out from under the app (low storage, etc.), the stale DB
row is cleaned up rather than the player getting a dangling path:

```ts
export async function getLocalDownloadPath(episodeId: string): Promise<string | null> {
  const record = getDownload(episodeId);
  if (!record) {
    return null;
  }
  const file = new File(record.localPath);
  if (!file.exists) {
    deleteDownload(episodeId);
    return null;
  }
  return record.localPath;
}
```

No changes to `resolve-episode-source.ts` or `player-store.ts` — this is
exactly the seam Prompt 8 built for this.

## Download gating — reusing the existing accessibility check

The client has no client-side view of the `unlocks` table today (grep
confirms it — every screen infers "locked" purely from
`accessTier !== "free"`, and actual access is discovered lazily when
`get-episode-audio` is called). Rather than adding a new entitlement
query, the download button reuses the exact function the player already
calls to make this discovery:

- `resolveRemoteEpisodeSource` (currently a private helper inside
  `resolve-episode-source.ts`) is exported so the download queue can call
  it directly, without duplicating the `get-episode-audio` invocation.
- Tapping "Download" calls it. `{ type: "remote", url }` → the episode is
  currently accessible (free, coin-unlocked, or active-premium); enqueue
  a download from that signed URL. `{ type: "locked" }` → open the same
  Unlock Sheet tapping "Play" would open, instead of downloading.
  `{ type: "not_found" }` / `{ type: "error" }` → a toast, same as
  playback's handling.
- This means a coins-tier episode the user hasn't unlocked still shows a
  download affordance (consistent with today's "every row looks the
  same until you try" pattern) — tapping it surfaces the Unlock Sheet
  rather than silently doing nothing, which is more helpful than hiding
  the button and matches how tapping such a row to _play_ already works.

## `apps/mobile/src/stores/download-queue-store.ts` (new, Zustand)

In-memory queue — deliberately not persisted across app restarts (see
"Foreground-only" above; a killed app loses in-flight queue state, and
the user retries manually next launch). Sequential processing (one
active download at a time) — protects the user's bandwidth/battery and
keeps progress reporting to a single number, matching the spec's mention
of "a download queue" rather than parallel downloads.

```ts
export type DownloadStatus = "queued" | "downloading" | "paused_wifi" | "error" | "downloaded";

type DownloadEntry = { status: DownloadStatus; progress: number; error?: string };

type DownloadQueueState = {
  entries: Record<string, DownloadEntry>; // keyed by episodeId; "downloaded" entries are seeded from getAllDownloads() at store init
  enqueue: (episode: DownloadableEpisode) => Promise<void>;
  enqueueSeries: (episodes: DownloadableEpisode[]) => Promise<void>;
  retry: (episodeId: string) => void;
  cancel: (episodeId: string) => void; // removes a queued/downloading/error entry, deletes any partial file
  remove: (episodeId: string) => Promise<void>; // deletes a completed download (file + DB row)
  removeAll: () => Promise<void>;
};
```

Internals:

- `enqueue` calls `resolveRemoteEpisodeSource` first (see gating above);
  on `"locked"` it does not add a queue entry at all — the caller (the
  download button) is responsible for opening the Unlock Sheet.
- Downloads write to a temp path (`Paths.document/downloads/<episodeId>.tmp`)
  using `File.createDownloadTask(url, tempFile, { onProgress })`; on
  `downloadAsync()` resolving, the temp file is renamed to its final path
  (`Paths.document/downloads/<episodeId>.mp3`) and `insertDownload` is
  called with the resolved `file.size`. Only a fully-completed download
  ever gets a DB row — a `.tmp` file with no matching row is always safe
  to delete.
- **Orphan cleanup on app start:** since the queue is memory-only, any
  `.tmp` file found in the downloads directory when the store initializes
  is necessarily a leftover from a session that was killed mid-download
  (foreground-only means there's no legitimate in-flight download that
  survives a restart) — deleted on init, no retry prompt needed since the
  user never saw it complete anyway.
- **Wifi-only gate:** a pure function,
  `shouldPauseForWifi(networkState, wifiOnlyEnabled): boolean`, checked
  before starting each queue item and re-evaluated on every
  `NetInfo.addEventListener` callback. When it flips from true to false
  (wifi became available, or the user turned the setting off), any
  `paused_wifi` entries automatically resume. This function is pure and
  unit-tested directly (no NetInfo/store wiring needed in the test).
- Errors (network failure, storage full) set `status: "error"` with a
  message; `retry` re-enqueues the same episode.

## `apps/mobile/src/stores/settings-store.ts` (new)

A single boolean preference, persisted the same lightweight way
`local-listening-progress.ts` persists progress — one JSON file via
`expo-file-system`'s `File`/`Paths` API (SQLite would be overkill for one
flag):

```ts
export type Settings = { wifiOnlyDownloads: boolean }; // default true
export function readSettings(): Settings {
  /* ... */
}
export function writeSettings(settings: Settings): void {
  /* ... */
}
```

Wrapped in a small Zustand store (`useSettingsStore`) so the toggle and
the download queue both react to changes without prop-drilling.

## Mobile: Settings screen (new)

`apps/mobile/src/app/(app)/settings.tsx` — a single row: "Download over
Wi-Fi only" with a switch bound to `useSettingsStore`. Reached via a new
"Settings" button on `profile.tsx`, placed near the existing "Sign
Out"/"Sign In" button. No auth gating needed — the preference is
device-local and meaningful for guests too.

## Mobile: Downloads screen (new)

A new "Downloads" section inside the existing `library.tsx`, mirroring
its current "Bookmarks" section exactly (`SectionHeader` + row list +
`EmptyState` fallback) rather than a separate nested route — the content
is comparable in weight to Bookmarks, and `library.tsx` already carries
the placeholder copy ("Your favorites, downloads, and listening history
will show up here.") anticipating this. Concretely:

- Total storage used at the top (`sum(file_size)` across
  `getAllDownloads()`, formatted e.g. "124 MB").
- One row per download: title, series, size, a delete button (no
  confirmation — trivially re-downloadable).
- In-progress queue entries (queued/downloading/paused_wifi/error) shown
  above or interleaved with completed downloads, with a progress
  indicator, pause-for-wifi label, or a retry button as appropriate.
- "Delete all" action — this one **does** confirm (a simple native
  `Alert.alert` confirm), since it's a single bulk action that's easy to
  trigger by mistake and mildly annoying to redo from scratch.

## Mobile: download affordance on episode rows

`episode-row.tsx` gains a small trailing icon reflecting
`downloadQueueStore`'s status for that episode: a plain download icon
(idle) → progress ring (queued/downloading) → a "waiting for Wi-Fi" icon
(paused_wifi) → a checkmark (downloaded, tap removes it) → a retry icon
(error). `series/[id].tsx` gains a "Download series" button above the
episode list that calls `enqueueSeries` with every episode not already
downloaded.

## Mobile: offline mode

- `apps/mobile/src/hooks/use-network-status.ts` (new) — thin wrapper
  around `NetInfo.addEventListener`/`NetInfo.fetch()`, returning
  `{ isConnected: boolean }`. Single source of truth for the banner, the
  wifi-only gate, and the cold-start redirect.
- `apps/mobile/src/components/offline-banner.tsx` (new) — renders a
  fixed banner ("You're offline — playing downloaded episodes only")
  whenever `isConnected === false`; mounted once near the app root
  alongside `AudioStatusDriver` so it's visible from any screen. Not
  dismissible — it reflects live state, so it should disappear on its
  own the moment connectivity returns rather than needing a user action.
- **Cold-start redirect:** a new pure function `resolveOfflineLaunchRedirect`
  (tested in isolation, same convention as `resolveAuthRedirect`/
  `auth-redirect.test.ts`), taking `{ isConnected, segments }` and
  returning a redirect href or `null`. `app/_layout.tsx`'s existing
  auth-redirect effect gains a second check _after_ `resolveAuthRedirect`
  resolves to `null` (auth redirect always takes priority): if this is
  the app's first-ever redirect resolution this session (a `useRef` flag,
  not re-evaluated on every render — mirrors why `resolveAuthRedirect`
  itself is effect-gated rather than a bare `<Redirect>`) and the
  resolved location is the default Home tab, and `isConnected` is false,
  replace with the Library tab instead. Guarded so a deep link (e.g. from
  a notification) is never overridden — only the _default_ landing route
  is swapped.

## `docs/offline-downloads.md` (new)

Covers: the download pipeline end-to-end (button tap →
`resolveRemoteEpisodeSource` gating → queue → SQLite manifest →
`resolve-episode-source.ts` preferring local), the fairness consequence
stated above (with the reasoning, not just the assertion — mirroring how
`docs/monetization.md` links assertions back to mechanism), the
wifi-only default and why it defaults ON ("protect users' data bundles,"
the spec's own words), and the security note the spec explicitly asks
for: downloaded files live in the app's sandboxed documents directory
with no encryption or DRM beyond the OS's own app-sandboxing — acceptable
for v1, with DRM (e.g. FairPlay/Widevine-backed streaming) noted as a
future option if piracy of downloaded audio becomes a real problem.

## Testing approach

Following this codebase's established convention (see
`local-listening-progress.test.ts`'s comment and `auth-redirect.test.ts`):
native-I/O wrappers (SQLite calls, `expo-file-system` downloads, NetInfo
itself) are not unit-tested directly — they're thin and mostly
un-mockable in the Jest environment (`jest-expo` ships no `expo-sqlite`
mock). Instead, every piece of actual _logic_ is extracted into a pure,
directly-testable function:

- `shouldPauseForWifi(networkState, wifiOnlyEnabled)` — all four
  input combinations (wifi/cellular × enabled/disabled).
- `resolveOfflineLaunchRedirect({ isConnected, segments }, hasRedirectedOnce)`
  — connected (no redirect), disconnected-and-on-home (redirect to
  Library), disconnected-but-already-redirected-once (no redirect, so a
  user who navigates to Home mid-session while offline isn't yanked back
  to Library), disconnected-but-on-a-deep-link-route (no redirect).
- The queue store's status-transition logic, isolated from the actual
  download call by injecting/mocking the download function — queued →
  downloading → downloaded, and queued → downloading → error → (retry) →
  downloading, following the same "mock the network boundary, test the
  state machine" approach `unlock-episode.test.ts` already uses for its
  edge-function call.
- `downloads-db.ts`'s CRUD and the real `File.createDownloadTask` /
  SQLite wiring are exercised manually (Prompt 8's audio-playback carve-
  out, and Prompt 9's purchase-flow carve-out, are both precedent for
  "real device/native behavior is manual verification, not this
  environment's job").
