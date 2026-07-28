# Offline Downloads (Prompt 10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users download episodes for offline listening — a per-episode/per-series download queue backed by a local SQLite manifest, a wifi-only gate, a Downloads section in Library, and a cold-start "open to Library when offline" mode.

**Architecture:** `expo-sqlite` stores a flat `downloads` table (episode metadata + local file path); `expo-file-system`'s resumable download task fetches the actual audio bytes to the app's documents directory. A Zustand `download-queue-store` orchestrates one download at a time, reusing the player's existing `resolveRemoteEpisodeSource` for the "is this episode currently accessible" check (no new entitlement logic). `local-downloads.ts` (a stub since Prompt 8) becomes the real lookup `resolve-episode-source.ts` already calls, so the player prefers local files automatically. `@react-native-community/netinfo` drives the wifi-only gate, an offline banner, and a one-time cold-start redirect to the Library tab.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, Zustand, TanStack Query, Jest + `@testing-library/react-native` (`jest-expo` preset), TypeScript.

## Global Constraints

- **Read the exact versioned Expo docs before writing filesystem/SQLite code.** `apps/mobile/AGENTS.md` requires checking https://docs.expo.dev/versions/v57.0.0/ before writing any code — this plan's `File`/`Directory`/`SQLite` API usage was verified against that version while writing this plan, but if any call in Tasks 2–5 doesn't typecheck or behave as described, re-check the live docs rather than guessing.
- **Native-I/O wrappers are not unit-tested.** This codebase's established convention (see `local-listening-progress.ts`'s test file and its comment, and `docs/superpowers/specs/2026-07-26-coins-unlocks-premium-design.md`'s testing section): `jest-expo` ships no `expo-sqlite` mock, and thin wrappers around `File`/`Directory`/`SQLite` calls are exercised manually, not in Jest. Every task below that touches those directly says so explicitly and has no test step; all _logic_ is pulled out into separate pure functions that _are_ unit-tested.
- **`getLocalDownloadPath` must keep returning a bare filesystem path (no `file://` prefix).** `player-store.ts`'s `loadTrackAtIndex` already does `{ uri: \`file://${result.path}\` }`for a local result — this plan does not touch`player-store.ts`or`resolve-episode-source.ts`'s local-source branch, so the contract must not change.
- **Foreground-only downloads.** No background `URLSession`/foreground-service configuration anywhere in this plan (confirmed non-goal in the design spec).
- **Downloaded files are permanent once downloaded** — no entitlement re-check at offline playback time (confirmed fairness consequence in the design spec). Only the download _action_ checks current accessibility.
- **Commit after every task**, following this repo's existing commit convention: `git commit -m "Prompt 10: <description>"`.
- Full spec: `docs/superpowers/specs/2026-07-28-offline-downloads-design.md`. Read it if any task below is unclear about intent.

---

### Task 1: Add dependencies

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: root `pnpm-lock.yaml`

**Interfaces:**

- Produces: `expo-sqlite` and `@react-native-community/netinfo`, importable by every later task in this plan.

- [ ] **Step 1: Install both packages**

```bash
cd "apps/mobile" && npx expo install expo-sqlite @react-native-community/netinfo
```

Expected: `apps/mobile/package.json` gains `expo-sqlite` and
`@react-native-community/netinfo` entries under `dependencies`, versions
chosen by `expo install` to match Expo SDK 57. Neither package needs an
Expo config plugin for basic usage (SQLite has none; NetInfo's Android
manifest merge is automatic via its own `AndroidManifest.xml` — a config
plugin is only needed for cellular-generation detail via
`READ_PHONE_STATE`, which this feature doesn't use) — no `app.json`
change is expected.

- [ ] **Step 2: Confirm the lockfile change and commit**

```bash
git status
```

This is a pnpm workspace with one root lockfile — confirm
`pnpm-lock.yaml` at the repo root changed (not a nested one), per the
lesson noted in Prompt 8's Task 1 and repeated in Prompt 9's Task 4.

```bash
git add apps/mobile/package.json pnpm-lock.yaml
git commit -m "Prompt 10: install expo-sqlite and @react-native-community/netinfo"
```

---

### Task 2: `downloads-db.ts` — SQLite CRUD

**Files:**

- Create: `apps/mobile/src/lib/downloads-db.ts`

**Interfaces:**

- Produces: `DownloadRecord` type, `insertDownload(record)`,
  `deleteDownload(episodeId)`, `getDownload(episodeId)`,
  `getAllDownloads()`. Consumed by Task 5 (`local-downloads.ts`) and
  Task 11 (`download-queue-store.ts`).

No test for this file — see "Native-I/O wrappers are not unit-tested"
in Global Constraints.

- [ ] **Step 1: Write the module**

```ts
// apps/mobile/src/lib/downloads-db.ts
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

type DownloadRow = {
  episode_id: string;
  series_id: string;
  title: string;
  series_title: string;
  local_path: string;
  file_size: number;
  downloaded_at: string;
};

function fromRow(row: DownloadRow): DownloadRecord {
  return {
    episodeId: row.episode_id,
    seriesId: row.series_id,
    title: row.title,
    seriesTitle: row.series_title,
    localPath: row.local_path,
    fileSize: row.file_size,
    downloadedAt: row.downloaded_at,
  };
}

export function insertDownload(record: DownloadRecord): void {
  db.runSync(
    `INSERT OR REPLACE INTO downloads
       (episode_id, series_id, title, series_title, local_path, file_size, downloaded_at)
     VALUES ($episode_id, $series_id, $title, $series_title, $local_path, $file_size, $downloaded_at)`,
    {
      $episode_id: record.episodeId,
      $series_id: record.seriesId,
      $title: record.title,
      $series_title: record.seriesTitle,
      $local_path: record.localPath,
      $file_size: record.fileSize,
      $downloaded_at: record.downloadedAt,
    },
  );
}

export function deleteDownload(episodeId: string): void {
  db.runSync(`DELETE FROM downloads WHERE episode_id = $episode_id`, {
    $episode_id: episodeId,
  });
}

export function getDownload(episodeId: string): DownloadRecord | null {
  const row = db.getFirstSync<DownloadRow>(
    `SELECT * FROM downloads WHERE episode_id = $episode_id`,
    { $episode_id: episodeId },
  );
  return row ? fromRow(row) : null;
}

export function getAllDownloads(): DownloadRecord[] {
  const rows = db.getAllSync<DownloadRow>(`SELECT * FROM downloads ORDER BY downloaded_at DESC`);
  return rows.map(fromRow);
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add apps/mobile/src/lib/downloads-db.ts
git commit -m "Prompt 10: add downloads-db SQLite manifest"
```

---

### Task 3: Export `resolveRemoteEpisodeSource`

**Files:**

- Modify: `apps/mobile/src/lib/resolve-episode-source.ts:21`

**Interfaces:**

- Produces: `resolveRemoteEpisodeSource(episodeId): Promise<EpisodeSourceResult>` (previously private), the exact "is this episode currently accessible" check the player already uses — reused by Task 11's download queue instead of duplicating the `get-episode-audio` call.
- Consumes: nothing new.

This is a one-line visibility change to an already-tested function
(`resolve-episode-source.test.ts` already exercises it indirectly
through `resolveEpisodeSource` — no behavior changes here, so no new
test is needed).

- [ ] **Step 1: Export the function**

In `apps/mobile/src/lib/resolve-episode-source.ts`, change:

```ts
async function resolveRemoteEpisodeSource(episodeId: string): Promise<EpisodeSourceResult> {
```

to:

```ts
export async function resolveRemoteEpisodeSource(episodeId: string): Promise<EpisodeSourceResult> {
```

- [ ] **Step 2: Run the existing tests to confirm nothing broke**

```bash
cd apps/mobile && npx jest resolve-episode-source
```

Expected: all existing tests in `resolve-episode-source.test.ts` still
pass unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/lib/resolve-episode-source.ts
git commit -m "Prompt 10: export resolveRemoteEpisodeSource for the download queue to reuse"
```

---

### Task 4: `format-bytes.ts` — storage-size formatting

**Files:**

- Create: `apps/mobile/src/lib/format-bytes.ts`
- Test: `apps/mobile/src/lib/format-bytes.test.ts`

**Interfaces:**

- Produces: `formatBytes(bytes: number): string`. Consumed by Task 13's Downloads section (total storage used) and per-row file sizes.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/format-bytes.test.ts
import { formatBytes } from "./format-bytes";

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats plain bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(15 * 1024 * 1024)).toBe("15.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest format-bytes
```

Expected: FAIL — `Cannot find module './format-bytes'`.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/lib/format-bytes.ts
const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unitIndex]}`;
}
```

- [ ] **Step 4: Run it to confirm it passes**

```bash
cd apps/mobile && npx jest format-bytes
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/format-bytes.ts apps/mobile/src/lib/format-bytes.test.ts
git commit -m "Prompt 10: add formatBytes helper"
```

---

### Task 5: `download-file.ts` — resumable download wrapper

**Files:**

- Create: `apps/mobile/src/lib/download-file.ts`

**Interfaces:**

- Produces: `downloadEpisodeFile(episodeId, url, onProgress): Promise<{ localPath: string; fileSize: number }>`, `deleteEpisodeFile(localPath: string): void`, `cleanupOrphanedDownloads(): void`, `toFileUri(bareOrUri: string): string`. Consumed by Task 6 (`local-downloads.ts` uses `toFileUri`) and Task 11 (`download-queue-store.ts` uses all four).

No test for this file — it's a direct wrapper around `File`/`Directory`/
`DownloadTask`, exactly the native-I/O category Global Constraints
exempts from unit testing. Verified manually in Task 18.

- [ ] **Step 1: Write the module**

```ts
// apps/mobile/src/lib/download-file.ts
import { Directory, File, Paths } from "expo-file-system";

// downloads-db.ts stores `localPath` bare (no `file://` prefix — the
// same contract player-store.ts's local-source branch already depends
// on). The File/Directory classes need a real URI, so this is the one
// place that prefix gets added back.
export function toFileUri(bareOrUri: string): string {
  return bareOrUri.startsWith("file://") ? bareOrUri : `file://${bareOrUri}`;
}

function toBarePath(uri: string): string {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}

function getDownloadsDirectory(): Directory {
  const dir = new Directory(Paths.document, "downloads");
  if (!dir.exists) {
    dir.create();
  }
  return dir;
}

function extensionFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const match = /\.[a-zA-Z0-9]+$/.exec(pathname);
  return match ? match[0] : ".m4a";
}

export async function downloadEpisodeFile(
  episodeId: string,
  url: string,
  onProgress: (fraction: number) => void,
): Promise<{ localPath: string; fileSize: number }> {
  const dir = getDownloadsDirectory();
  const tempFile = new File(dir, `${episodeId}.tmp`);
  const task = File.createDownloadTask(url, tempFile, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) {
        onProgress(bytesWritten / totalBytes);
      }
    },
  });

  const downloaded = await task.downloadAsync();

  const finalFile = new File(dir, `${episodeId}${extensionFromUrl(url)}`);
  if (finalFile.exists) {
    finalFile.delete();
  }
  // .move() updates `downloaded`'s own `.uri` in place to point at the
  // new location — read `.uri`/`.size` off `downloaded` afterward, not
  // off `finalFile`.
  await downloaded.move(finalFile);

  return { localPath: toBarePath(downloaded.uri), fileSize: downloaded.size };
}

export function deleteEpisodeFile(localPath: string): void {
  const file = new File(toFileUri(localPath));
  if (file.exists) {
    file.delete();
  }
}

// Foreground-only downloads (Global Constraints) mean the in-memory
// queue is always empty right after a cold start — any ".tmp" file
// found at startup is necessarily a leftover from a session that was
// killed mid-download, safe to delete unconditionally.
export function cleanupOrphanedDownloads(): void {
  const dir = getDownloadsDirectory();
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.endsWith(".tmp")) {
      entry.delete();
    }
  }
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add apps/mobile/src/lib/download-file.ts
git commit -m "Prompt 10: add resumable episode download wrapper"
```

---

### Task 6: `local-downloads.ts` — real implementation

**Files:**

- Modify: `apps/mobile/src/lib/local-downloads.ts` (replaces the Prompt 8 stub in full)

**Interfaces:**

- Consumes: `getDownload`, `deleteDownload` (Task 2); `toFileUri` (Task 5).
- Produces: `getLocalDownloadPath(episodeId): Promise<string | null>` — same signature the stub already had; `resolve-episode-source.ts` and `player-store.ts` need no changes.

No test — touches `File` directly (native I/O). `resolve-episode-source.test.ts` already mocks this whole module, so its own tests are unaffected by this change.

- [ ] **Step 1: Replace the stub**

```ts
// apps/mobile/src/lib/local-downloads.ts
import { File } from "expo-file-system";

import { deleteDownload, getDownload } from "@/lib/downloads-db";
import { toFileUri } from "@/lib/download-file";

// Self-healing: if the OS ever evicts a downloaded file out from under
// the app (low device storage, etc.), the stale DB row is cleaned up
// here rather than the player getting a dangling path back.
export async function getLocalDownloadPath(episodeId: string): Promise<string | null> {
  const record = getDownload(episodeId);
  if (!record) {
    return null;
  }
  const file = new File(toFileUri(record.localPath));
  if (!file.exists) {
    deleteDownload(episodeId);
    return null;
  }
  return record.localPath;
}
```

- [ ] **Step 2: Run resolve-episode-source's tests (which mock this module) to confirm nothing broke**

```bash
cd apps/mobile && npx jest resolve-episode-source
```

Expected: PASS, unchanged.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add apps/mobile/src/lib/local-downloads.ts
git commit -m "Prompt 10: implement getLocalDownloadPath against the real downloads manifest"
```

---

### Task 7: `wifi-gate.ts` — wifi-only pause decision (TDD)

**Files:**

- Create: `apps/mobile/src/lib/wifi-gate.ts`
- Test: `apps/mobile/src/lib/wifi-gate.test.ts`

**Interfaces:**

- Produces: `shouldPauseForWifi(netState, wifiOnlyEnabled): boolean`. Consumed by Task 11 (`download-queue-store.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/wifi-gate.test.ts
import { shouldPauseForWifi } from "./wifi-gate";

describe("shouldPauseForWifi", () => {
  it("does not pause on wifi when wifi-only is enabled", () => {
    expect(shouldPauseForWifi({ type: "wifi" }, true)).toBe(false);
  });

  it("pauses on cellular when wifi-only is enabled", () => {
    expect(shouldPauseForWifi({ type: "cellular" }, true)).toBe(true);
  });

  it("does not pause on cellular when wifi-only is disabled", () => {
    expect(shouldPauseForWifi({ type: "cellular" }, false)).toBe(false);
  });

  it("does not pause on wifi when wifi-only is disabled", () => {
    expect(shouldPauseForWifi({ type: "wifi" }, false)).toBe(false);
  });

  it("pauses when offline/unknown and wifi-only is enabled", () => {
    expect(shouldPauseForWifi({ type: "none" }, true)).toBe(true);
    expect(shouldPauseForWifi({ type: "unknown" }, true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest wifi-gate
```

Expected: FAIL — `Cannot find module './wifi-gate'`.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/lib/wifi-gate.ts
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
```

- [ ] **Step 4: Run it to confirm it passes**

```bash
cd apps/mobile && npx jest wifi-gate
```

Expected: PASS, 5 tests (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/wifi-gate.ts apps/mobile/src/lib/wifi-gate.test.ts
git commit -m "Prompt 10: add shouldPauseForWifi gate"
```

---

### Task 8: `settings.ts` + `settings-store.ts` — wifi-only preference

**Files:**

- Create: `apps/mobile/src/lib/settings.ts`
- Create: `apps/mobile/src/stores/settings-store.ts`

**Interfaces:**

- Produces: `useSettingsStore` (Zustand: `{ wifiOnlyDownloads: boolean; setWifiOnlyDownloads(value): void }`). Consumed by Task 11 (`download-queue-store.ts`) and Task 15 (`settings.tsx` screen).

No test — `settings.ts` is a one-boolean JSON file, the same
`local-listening-progress.ts` pattern already left untested;
`settings-store.ts` is a trivial wrapper around it.

- [ ] **Step 1: Write the settings file module**

```ts
// apps/mobile/src/lib/settings.ts
import { File, Paths } from "expo-file-system";

export type Settings = { wifiOnlyDownloads: boolean };

const DEFAULT_SETTINGS: Settings = { wifiOnlyDownloads: true };

const settingsFile = new File(Paths.document, "settings.json");

export function readSettings(): Settings {
  if (!settingsFile.exists) {
    return DEFAULT_SETTINGS;
  }
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(settingsFile.textSync()) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: Settings): void {
  if (!settingsFile.exists) {
    settingsFile.create();
  }
  settingsFile.write(JSON.stringify(settings));
}
```

- [ ] **Step 2: Write the store**

```ts
// apps/mobile/src/stores/settings-store.ts
import { create } from "zustand";

import { readSettings, writeSettings } from "@/lib/settings";

type SettingsState = {
  wifiOnlyDownloads: boolean;
  setWifiOnlyDownloads: (value: boolean) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  ...readSettings(),
  setWifiOnlyDownloads: (value) => {
    writeSettings({ wifiOnlyDownloads: value });
    set({ wifiOnlyDownloads: value });
  },
}));
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add apps/mobile/src/lib/settings.ts apps/mobile/src/stores/settings-store.ts
git commit -m "Prompt 10: add wifi-only download preference store"
```

---

### Task 9: `use-network-status.ts` (TDD)

**Files:**

- Create: `apps/mobile/src/hooks/use-network-status.ts`
- Test: `apps/mobile/src/hooks/use-network-status.test.ts`

**Interfaces:**

- Produces: `useNetworkStatus(): { isConnected: boolean | null }` — `null` until the first real reading arrives, so callers can distinguish "still finding out" from "confirmed offline." Consumed by Task 14 (`offline-banner.tsx`) and Task 16 (root layout's cold-start redirect).

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/hooks/use-network-status.test.ts
import { act, renderHook, waitFor } from "@testing-library/react-native";
import NetInfo from "@react-native-community/netinfo";

import { useNetworkStatus } from "./use-network-status";

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: jest.fn(), addEventListener: jest.fn() },
}));

const mockFetch = NetInfo.fetch as jest.Mock;
const mockAddEventListener = NetInfo.addEventListener as jest.Mock;

describe("useNetworkStatus", () => {
  beforeEach(() => {
    mockAddEventListener.mockReturnValue(() => {});
  });

  it("starts as null before the first reading resolves", () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves in this test
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isConnected).toBeNull();
  });

  it("reflects the initial fetch result", async () => {
    mockFetch.mockResolvedValue({ isConnected: false });
    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isConnected).toBe(false));
  });

  it("updates when the NetInfo listener fires", async () => {
    mockFetch.mockResolvedValue({ isConnected: true });
    let listener: ((state: { isConnected: boolean }) => void) | undefined;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb;
      return () => {};
    });

    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    act(() => {
      listener?.({ isConnected: false });
    });
    expect(result.current.isConnected).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest use-network-status
```

Expected: FAIL — `Cannot find module './use-network-status'`.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/hooks/use-network-status.ts
import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

export function useNetworkStatus(): { isConnected: boolean | null } {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    NetInfo.fetch().then((state) => setIsConnected(state.isConnected ?? true));
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected ?? true);
    });
    return unsubscribe;
  }, []);

  return { isConnected };
}
```

- [ ] **Step 4: Run it to confirm it passes**

```bash
cd apps/mobile && npx jest use-network-status
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hooks/use-network-status.ts apps/mobile/src/hooks/use-network-status.test.ts
git commit -m "Prompt 10: add useNetworkStatus hook"
```

---

### Task 10: `offline-redirect.ts` — cold-start redirect decision (TDD)

**Files:**

- Create: `apps/mobile/src/lib/offline-redirect.ts`
- Test: `apps/mobile/src/lib/offline-redirect.test.ts`

**Interfaces:**

- Produces: `resolveOfflineLaunchRedirect({ isConnected, segments }): "/library" | null`. Consumed by Task 16 (root layout).

Follows the exact convention of `auth-redirect.ts`/`auth-redirect.test.ts`
— a pure function, the one-time "only at cold start" gating is the
calling effect's job (a `useRef`), not this function's.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/offline-redirect.test.ts
import { resolveOfflineLaunchRedirect } from "./offline-redirect";

describe("resolveOfflineLaunchRedirect", () => {
  it("does nothing when connected", () => {
    expect(
      resolveOfflineLaunchRedirect({ isConnected: true, segments: ["(app)", "(tabs)"] }),
    ).toBeNull();
  });

  it("redirects to Library when offline and landing on the Home tab", () => {
    expect(
      resolveOfflineLaunchRedirect({ isConnected: false, segments: ["(app)", "(tabs)"] }),
    ).toBe("/library");
  });

  it("leaves a deep-linked route alone even when offline", () => {
    expect(
      resolveOfflineLaunchRedirect({
        isConnected: false,
        segments: ["(app)", "series", "[id]"],
      }),
    ).toBeNull();
  });

  it("leaves an auth-group route alone even when offline", () => {
    expect(
      resolveOfflineLaunchRedirect({ isConnected: false, segments: ["(auth)", "sign-in"] }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest offline-redirect
```

Expected: FAIL — `Cannot find module './offline-redirect'`.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/lib/offline-redirect.ts
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
```

- [ ] **Step 4: Run it to confirm it passes**

```bash
cd apps/mobile && npx jest offline-redirect
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/offline-redirect.ts apps/mobile/src/lib/offline-redirect.test.ts
git commit -m "Prompt 10: add resolveOfflineLaunchRedirect"
```

---

### Task 11: `download-queue-store.ts` — the download queue (TDD)

**Files:**

- Create: `apps/mobile/src/stores/download-queue-store.ts`
- Test: `apps/mobile/src/stores/download-queue-store.test.ts`

**Interfaces:**

- Consumes: `resolveRemoteEpisodeSource` (Task 3), `downloadEpisodeFile`/`deleteEpisodeFile`/`cleanupOrphanedDownloads` (Task 5), `insertDownload`/`deleteDownload`/`getAllDownloads`/`getDownload` (Task 2), `shouldPauseForWifi` (Task 7), `useSettingsStore` (Task 8), `usePlayerStore`/`QueueEpisode` (`player-store.ts`, pre-existing), `NetInfo`.
- Produces: `useDownloadQueueStore` (Zustand), `DownloadStatus = "queued" | "downloading" | "paused_wifi" | "error" | "downloaded"`, actions `enqueue(episode: QueueEpisode)`, `enqueueSeries(episodes: QueueEpisode[])`, `retry(episodeId)`, `cancel(episodeId)`, `remove(episodeId)`, `removeAll()`. Consumed by Task 12 (`episode-row.tsx`'s parent screens), Task 13 (`series/[id].tsx`), Task 14 (`library.tsx`).

Following this codebase's "mock the network boundary, test the state
machine" convention (`unlock-episode.test.ts`, `resolve-episode-source.test.ts`):
`resolveRemoteEpisodeSource`, `downloadEpisodeFile`, `downloads-db.ts`,
`NetInfo`, and `useSettingsStore` are all mocked; only this store's own
orchestration logic is under test.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/stores/download-queue-store.test.ts
import NetInfo from "@react-native-community/netinfo";

import { resolveRemoteEpisodeSource } from "@/lib/resolve-episode-source";
import { downloadEpisodeFile } from "@/lib/download-file";
import { getAllDownloads, getDownload, insertDownload, deleteDownload } from "@/lib/downloads-db";
import { useSettingsStore } from "@/stores/settings-store";
import { usePlayerStore, type QueueEpisode } from "@/stores/player-store";

import { useDownloadQueueStore } from "./download-queue-store";

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: jest.fn(), addEventListener: jest.fn(() => () => {}) },
}));
jest.mock("@/lib/resolve-episode-source", () => ({ resolveRemoteEpisodeSource: jest.fn() }));
jest.mock("@/lib/download-file", () => ({
  downloadEpisodeFile: jest.fn(),
  deleteEpisodeFile: jest.fn(),
  cleanupOrphanedDownloads: jest.fn(),
}));
jest.mock("@/lib/downloads-db", () => ({
  getAllDownloads: jest.fn(() => []),
  getDownload: jest.fn(),
  insertDownload: jest.fn(),
  deleteDownload: jest.fn(),
}));

const mockFetch = NetInfo.fetch as jest.Mock;
const mockAddEventListener = NetInfo.addEventListener as jest.Mock;
const mockResolveRemote = resolveRemoteEpisodeSource as jest.Mock;
const mockDownloadFile = downloadEpisodeFile as jest.Mock;
const mockGetAllDownloads = getAllDownloads as jest.Mock;
const mockGetDownload = getDownload as jest.Mock;

// download-queue-store.ts calls NetInfo.addEventListener exactly once,
// at module-evaluation time (inside its Zustand `create()` initializer)
// — which has already happened by the time this line runs, since the
// `import { useDownloadQueueStore } ...` above triggered it. Capture the
// listener now, before any `beforeEach`'s `jest.clearAllMocks()` wipes
// `mockAddEventListener`'s call history — reading `.mock.calls[0]` from
// inside a test would find nothing by then.
const networkListener = mockAddEventListener.mock.calls[0]?.[0] as
  ((state: { type: string }) => void) | undefined;

const episode: QueueEpisode = {
  id: "ep-1",
  title: "Episode One",
  episodeNumber: 1,
  durationSeconds: 600,
  accessTier: "free",
  coinPrice: 0,
  contentSource: "elder_testimony",
  resumePositionSeconds: null,
  seriesId: "series-1",
  seriesTitle: "Series One",
  coverImageUrl: null,
};

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  // Deliberately not jest.clearAllMocks() here — that would also clear
  // mockAddEventListener's call history, but `networkListener` above
  // already captured what we need from it, so clearing the others
  // individually is enough and avoids any temptation to re-derive the
  // listener from `.mock.calls` later (it won't be there).
  mockFetch.mockReset();
  mockResolveRemote.mockReset();
  mockDownloadFile.mockReset();
  mockGetAllDownloads.mockReset();
  mockGetDownload.mockReset();
  (insertDownload as jest.Mock).mockReset();
  (deleteDownload as jest.Mock).mockReset();

  mockGetAllDownloads.mockReturnValue([]);
  mockFetch.mockResolvedValue({ type: "wifi" });
  useSettingsStore.setState({ wifiOnlyDownloads: false });
  useDownloadQueueStore.setState({ entries: {} });
  usePlayerStore.setState({ toastMessage: null });
});

describe("useDownloadQueueStore", () => {
  it("enqueues, downloads, and marks an episode downloaded", async () => {
    mockResolveRemote.mockResolvedValue({ type: "remote", url: "https://example.com/ep-1.m4a" });
    mockDownloadFile.mockResolvedValue({ localPath: "/docs/downloads/ep-1.m4a", fileSize: 1000 });

    await useDownloadQueueStore.getState().enqueue(episode);
    await flush();

    expect(insertDownload).toHaveBeenCalledWith(
      expect.objectContaining({ episodeId: "ep-1", fileSize: 1000 }),
    );
    expect(useDownloadQueueStore.getState().entries["ep-1"]?.status).toBe("downloaded");
  });

  it("does not enqueue a locked episode and shows a toast instead", async () => {
    mockResolveRemote.mockResolvedValue({ type: "locked" });

    await useDownloadQueueStore.getState().enqueue(episode);
    await flush();

    expect(useDownloadQueueStore.getState().entries["ep-1"]).toBeUndefined();
    expect(usePlayerStore.getState().toastMessage).toBe("Unlock this episode to download it.");
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it("moves a failed download to error and retry re-attempts it", async () => {
    mockResolveRemote.mockResolvedValue({ type: "remote", url: "https://example.com/ep-1.m4a" });
    mockDownloadFile.mockRejectedValueOnce(new Error("network down"));

    await useDownloadQueueStore.getState().enqueue(episode);
    await flush();
    expect(useDownloadQueueStore.getState().entries["ep-1"]?.status).toBe("error");

    mockDownloadFile.mockResolvedValueOnce({
      localPath: "/docs/downloads/ep-1.m4a",
      fileSize: 500,
    });
    useDownloadQueueStore.getState().retry("ep-1");
    await flush();
    expect(useDownloadQueueStore.getState().entries["ep-1"]?.status).toBe("downloaded");
  });

  it("pauses for wifi-only on cellular and resumes when wifi becomes available", async () => {
    useSettingsStore.setState({ wifiOnlyDownloads: true });
    mockFetch.mockResolvedValue({ type: "cellular" });
    mockResolveRemote.mockResolvedValue({ type: "remote", url: "https://example.com/ep-1.m4a" });
    mockDownloadFile.mockResolvedValue({ localPath: "/docs/downloads/ep-1.m4a", fileSize: 500 });

    await useDownloadQueueStore.getState().enqueue(episode);
    await flush();
    expect(useDownloadQueueStore.getState().entries["ep-1"]?.status).toBe("paused_wifi");
    expect(mockDownloadFile).not.toHaveBeenCalled();

    // The listener firing with `{ type: "wifi" }` represents connectivity
    // having genuinely changed — processNext re-confirms that via its own
    // NetInfo.fetch() call (for freshness right before downloading, same
    // as the entitlement re-check), so the fetch mock needs to agree with
    // the event or this would immediately re-pause on stale "cellular".
    mockFetch.mockResolvedValue({ type: "wifi" });
    networkListener?.({ type: "wifi" });
    await flush();

    expect(useDownloadQueueStore.getState().entries["ep-1"]?.status).toBe("downloaded");
  });

  it("remove deletes the file and the DB row for a downloaded episode", async () => {
    mockResolveRemote.mockResolvedValue({ type: "remote", url: "https://example.com/ep-1.m4a" });
    mockDownloadFile.mockResolvedValue({ localPath: "/docs/downloads/ep-1.m4a", fileSize: 500 });
    mockGetDownload.mockReturnValue({
      episodeId: "ep-1",
      seriesId: "series-1",
      title: "Episode One",
      seriesTitle: "Series One",
      localPath: "/docs/downloads/ep-1.m4a",
      fileSize: 500,
      downloadedAt: "2026-01-01T00:00:00Z",
    });

    await useDownloadQueueStore.getState().enqueue(episode);
    await flush();

    useDownloadQueueStore.getState().remove("ep-1");

    expect(deleteDownload).toHaveBeenCalledWith("ep-1");
    expect(useDownloadQueueStore.getState().entries["ep-1"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest download-queue-store
```

Expected: FAIL — `Cannot find module './download-queue-store'`.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/stores/download-queue-store.ts
import NetInfo from "@react-native-community/netinfo";
import { create } from "zustand";

import { deleteEpisodeFile, downloadEpisodeFile } from "@/lib/download-file";
import { deleteDownload, getAllDownloads, getDownload, insertDownload } from "@/lib/downloads-db";
import { resolveRemoteEpisodeSource } from "@/lib/resolve-episode-source";
import { shouldPauseForWifi } from "@/lib/wifi-gate";
import { usePlayerStore, type QueueEpisode } from "@/stores/player-store";
import { useSettingsStore } from "@/stores/settings-store";

export type DownloadStatus = "queued" | "downloading" | "paused_wifi" | "error" | "downloaded";

// Only the fields this store and the Downloads/EpisodeRow UI actually
// read — a fresh `enqueue(episode: QueueEpisode)` call always has the
// full QueueEpisode, but an entry seeded from the SQLite manifest at
// store-init time (seedDownloadedEntries below) only has these four,
// so the entry type is intentionally the narrower, honest one rather
// than a `QueueEpisode` obtained by casting a partial object into it.
type QueueEntryEpisode = Pick<QueueEpisode, "id" | "seriesId" | "seriesTitle" | "title">;

type QueueEntry = {
  episode: QueueEntryEpisode;
  status: DownloadStatus;
  progress: number;
  fileSize?: number;
  error?: string;
};

type DownloadQueueState = {
  entries: Record<string, QueueEntry>;
  enqueue: (episode: QueueEpisode) => Promise<void>;
  enqueueSeries: (episodes: QueueEpisode[]) => Promise<void>;
  retry: (episodeId: string) => void;
  cancel: (episodeId: string) => void;
  remove: (episodeId: string) => void;
  removeAll: () => void;
};

function seedDownloadedEntries(): Record<string, QueueEntry> {
  const entries: Record<string, QueueEntry> = {};
  for (const record of getAllDownloads()) {
    entries[record.episodeId] = {
      episode: {
        id: record.episodeId,
        seriesId: record.seriesId,
        seriesTitle: record.seriesTitle,
        title: record.title,
      },
      status: "downloaded",
      progress: 1,
      fileSize: record.fileSize,
    };
  }
  return entries;
}

let processing = false;

export const useDownloadQueueStore = create<DownloadQueueState>((set, get) => {
  function patchEntry(episodeId: string, patch: Partial<QueueEntry>): void {
    set((state) => {
      const current = state.entries[episodeId];
      if (!current) {
        return state;
      }
      return { entries: { ...state.entries, [episodeId]: { ...current, ...patch } } };
    });
  }

  async function processNext(): Promise<void> {
    if (processing) {
      return;
    }
    const nextId = Object.keys(get().entries).find((id) => get().entries[id]?.status === "queued");
    if (!nextId) {
      return;
    }
    processing = true;

    const netState = await NetInfo.fetch();
    const wifiOnly = useSettingsStore.getState().wifiOnlyDownloads;
    if (shouldPauseForWifi(netState, wifiOnly)) {
      patchEntry(nextId, { status: "paused_wifi" });
      processing = false;
      return;
    }

    patchEntry(nextId, { status: "downloading", progress: 0 });
    const entry = get().entries[nextId]!;

    try {
      // Re-resolved here (not reused from enqueue's check) because a
      // queued item can sit for a while waiting for Wi-Fi, and the
      // signed URL get-episode-audio issues expires after 6 hours.
      const source = await resolveRemoteEpisodeSource(nextId);
      if (source.type !== "remote") {
        throw new Error(source.type);
      }
      const { localPath, fileSize } = await downloadEpisodeFile(nextId, source.url, (progress) =>
        patchEntry(nextId, { progress }),
      );
      insertDownload({
        episodeId: nextId,
        seriesId: entry.episode.seriesId,
        title: entry.episode.title,
        seriesTitle: entry.episode.seriesTitle,
        localPath,
        fileSize,
        downloadedAt: new Date().toISOString(),
      });
      patchEntry(nextId, { status: "downloaded", progress: 1, fileSize });
    } catch {
      patchEntry(nextId, { status: "error", error: "Couldn't download this episode." });
    } finally {
      processing = false;
      void processNext();
    }
  }

  NetInfo.addEventListener((state) => {
    const wifiOnly = useSettingsStore.getState().wifiOnlyDownloads;
    if (shouldPauseForWifi(state, wifiOnly)) {
      return;
    }
    const entries = get().entries;
    const resumed = Object.entries(entries).filter(([, e]) => e.status === "paused_wifi");
    if (resumed.length === 0) {
      return;
    }
    set({
      entries: Object.fromEntries(
        Object.entries(entries).map(([id, e]) =>
          e.status === "paused_wifi" ? [id, { ...e, status: "queued" as const }] : [id, e],
        ),
      ),
    });
    void processNext();
  });

  return {
    entries: seedDownloadedEntries(),

    enqueue: async (episode) => {
      if (get().entries[episode.id]) {
        return; // already downloaded, queued, or in progress
      }
      const source = await resolveRemoteEpisodeSource(episode.id);
      if (source.type === "locked") {
        usePlayerStore.setState({ toastMessage: "Unlock this episode to download it." });
        return;
      }
      if (source.type !== "remote") {
        usePlayerStore.setState({ toastMessage: "Couldn't download this episode." });
        return;
      }
      set((state) => ({
        entries: { ...state.entries, [episode.id]: { episode, status: "queued", progress: 0 } },
      }));
      void processNext();
    },

    enqueueSeries: async (episodes) => {
      for (const episode of episodes) {
        await get().enqueue(episode);
      }
    },

    retry: (episodeId) => {
      if (!get().entries[episodeId]) {
        return;
      }
      patchEntry(episodeId, { status: "queued", progress: 0, error: undefined });
      void processNext();
    },

    cancel: (episodeId) => {
      set((state) => {
        const next = { ...state.entries };
        delete next[episodeId];
        return { entries: next };
      });
    },

    remove: (episodeId) => {
      const record = getDownload(episodeId);
      if (record) {
        deleteEpisodeFile(record.localPath);
        deleteDownload(episodeId);
      }
      set((state) => {
        const next = { ...state.entries };
        delete next[episodeId];
        return { entries: next };
      });
    },

    removeAll: () => {
      for (const [id, entry] of Object.entries(get().entries)) {
        if (entry.status !== "downloaded") {
          continue;
        }
        const record = getDownload(id);
        if (record) {
          deleteEpisodeFile(record.localPath);
        }
        deleteDownload(id);
      }
      set((state) => {
        const next: Record<string, QueueEntry> = {};
        for (const [id, entry] of Object.entries(state.entries)) {
          if (entry.status !== "downloaded") {
            next[id] = entry;
          }
        }
        return { entries: next };
      });
    },
  };
});
```

- [ ] **Step 4: Run it to confirm it passes**

```bash
cd apps/mobile && npx jest download-queue-store
```

Expected: PASS, 5 tests. If the wifi-pause/resume test is flaky, double
check `flush()`'s three microtask ticks are enough to drain
`enqueue` → `processNext` → the `NetInfo.fetch()` await → the
`downloadEpisodeFile` await; add one more `await Promise.resolve()` if
needed rather than switching to fake timers.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add apps/mobile/src/stores/download-queue-store.ts apps/mobile/src/stores/download-queue-store.test.ts
git commit -m "Prompt 10: add download-queue-store"
```

---

### Task 12: Download affordance on `episode-row.tsx`

**Files:**

- Modify: `apps/mobile/src/components/ui/episode-row.tsx`

**Interfaces:**

- Consumes: `DownloadStatus` (Task 11).
- Produces: two new optional props, `downloadStatus?: DownloadStatus` and `onDownloadPress?: () => void` — when `onDownloadPress` is omitted (e.g. Home's Continue Listening row, left untouched), no download icon renders at all, so this task changes zero visible behavior anywhere it isn't explicitly wired up.

No test — `episode-row.tsx` is a presentational component with no
existing test file (consistent with every other `components/ui/*.tsx`
file in this codebase); verified manually in Task 18 alongside the
rest of the UI.

- [ ] **Step 1: Add the props and the trailing icon**

In `apps/mobile/src/components/ui/episode-row.tsx`, add the import and a
small icon-mapping helper near the existing `lockLabel` helper:

```ts
import type { AccessTier, ContentSource } from "@/types/content";
import type { DownloadStatus } from "@/stores/download-queue-store";
```

```ts
function downloadIcon(status: DownloadStatus | undefined): string {
  switch (status) {
    case "downloaded":
      return "✓";
    case "downloading":
      return "↓";
    case "queued":
      return "⏳";
    case "paused_wifi":
      return "📶";
    case "error":
      return "⟳";
    default:
      return "⬇";
  }
}
```

Extend the props type and destructuring:

```ts
export function EpisodeRow({
  title,
  durationSeconds,
  accessTier,
  contentSource,
  coinPrice,
  resumePositionSeconds,
  onPress,
  downloadStatus,
  onDownloadPress,
}: {
  title: string;
  durationSeconds: number | null;
  accessTier: AccessTier;
  contentSource: ContentSource;
  coinPrice?: number;
  resumePositionSeconds?: number | null;
  onPress?: () => void;
  downloadStatus?: DownloadStatus;
  onDownloadPress?: () => void;
}) {
```

Add the icon as a sibling of the lock label, inside the row's JSX
(after the existing lock-label `<ThemedText>`, before the row's closing
`</Pressable>`):

```tsx
{
  onDownloadPress ? (
    <Pressable onPress={onDownloadPress} hitSlop={8} style={styles.downloadButton}>
      <ThemedText
        type="default"
        themeColor={downloadStatus === "downloaded" ? "success" : "textSecondary"}
      >
        {downloadIcon(downloadStatus)}
      </ThemedText>
    </Pressable>
  ) : null;
}
```

Add the style:

```ts
downloadButton: {
  paddingHorizontal: Spacing.one,
},
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add apps/mobile/src/components/ui/episode-row.tsx
git commit -m "Prompt 10: add download affordance to EpisodeRow"
```

---

### Task 13: Wire downloads into `series/[id].tsx`

**Files:**

- Modify: `apps/mobile/src/app/(app)/series/[id].tsx`

**Interfaces:**

- Consumes: `useDownloadQueueStore` (Task 11).

No test — this is a screen-level wiring change with no existing test
file (matches the rest of `app/(app)/**`).

- [ ] **Step 1: Add the store and a "Download series" button**

Add the import:

```ts
import { useDownloadQueueStore } from "@/stores/download-queue-store";
```

Inside `SeriesDetailScreen`, alongside the other store selectors:

```ts
const downloadEntries = useDownloadQueueStore((state) => state.entries);
const enqueueDownload = useDownloadQueueStore((state) => state.enqueue);
const enqueueSeriesDownload = useDownloadQueueStore((state) => state.enqueueSeries);
```

Add a handler next to `handleFavorite`:

```ts
const handleDownloadSeries = () => {
  enqueueSeriesDownload(buildQueue()).catch(() => {});
};
```

Add a button in the `actions` row (after the existing Favorite
`Pressable`):

```tsx
<Pressable onPress={handleDownloadSeries}>
  <ThemedText type="default" themeColor="textSecondary">
    ⬇ Download series
  </ThemedText>
</Pressable>
```

- [ ] **Step 2: Pass download props to each `EpisodeRow`**

Change the `EpisodeRow` mapping to add:

```tsx
downloadStatus={downloadEntries[episode.id]?.status}
onDownloadPress={() =>
  enqueueDownload({
    ...episode,
    seriesId: series.id,
    seriesTitle: series.title,
    coverImageUrl: series.coverImageUrl,
  }).catch(() => {})
}
```

(This builds the same `QueueEpisode` shape `buildQueue()` already
builds for a single episode — `episode` here is a `SeriesDetailEpisode`,
and `QueueEpisode = SeriesDetailEpisode & { seriesId, seriesTitle, coverImageUrl }`.)

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add "apps/mobile/src/app/(app)/series/[id].tsx"
git commit -m "Prompt 10: wire downloads into the series detail screen"
```

---

### Task 14: Downloads section in `library.tsx`

**Files:**

- Modify: `apps/mobile/src/app/(app)/(tabs)/library.tsx`

**Interfaces:**

- Consumes: `useDownloadQueueStore` (Task 11), `formatBytes` (Task 4).

No test — screen-level UI, matches convention.

- [ ] **Step 1: Add the section**

Add imports:

```ts
import { Alert } from "react-native";

import { formatBytes } from "@/lib/format-bytes";
import { useDownloadQueueStore } from "@/stores/download-queue-store";
```

(`Alert` joins the existing `react-native` import line rather than a
new one — add it to the destructured import at the top of the file.)

Inside `LibraryScreen`, alongside the existing `bookmarksQuery`/`playQueue` reads:

```ts
const downloadEntries = useDownloadQueueStore((state) => state.entries);
const removeDownload = useDownloadQueueStore((state) => state.remove);
const retryDownload = useDownloadQueueStore((state) => state.retry);
const removeAllDownloads = useDownloadQueueStore((state) => state.removeAll);

const downloads = Object.entries(downloadEntries).map(([episodeId, entry]) => ({
  episodeId,
  ...entry,
}));
const totalBytes = downloads
  .filter((d) => d.status === "downloaded")
  .reduce((sum, d) => sum + (d.fileSize ?? 0), 0);

const confirmDeleteAll = () => {
  Alert.alert("Delete all downloads?", "This removes every downloaded episode from this device.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete All", style: "destructive", onPress: removeAllDownloads },
  ]);
};
```

Add a "Downloads" section after the existing "Bookmarks" section (same
`SectionHeader` + row + `EmptyState` pattern):

```tsx
<SectionHeader
  title={`Downloads${downloads.length > 0 ? ` · ${formatBytes(totalBytes)}` : ""}`}
  actionLabel={downloads.some((d) => d.status === "downloaded") ? "Delete All" : undefined}
  onActionPress={downloads.some((d) => d.status === "downloaded") ? confirmDeleteAll : undefined}
/>;
{
  downloads.length === 0 ? (
    <EmptyState
      title="No downloads yet"
      body="Download an episode from its series page to listen offline."
    />
  ) : (
    downloads.map((download) => (
      <ThemedView key={download.episodeId} style={styles.row}>
        <ThemedText type="default">{download.episode.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {download.episode.seriesTitle}
          {download.status === "downloaded" && download.fileSize
            ? ` · ${formatBytes(download.fileSize)}`
            : ""}
          {download.status === "downloading" ? ` · ${Math.round(download.progress * 100)}%` : ""}
          {download.status === "queued" ? " · Queued" : ""}
          {download.status === "paused_wifi" ? " · Waiting for Wi-Fi" : ""}
          {download.status === "error" ? ` · ${download.error}` : ""}
        </ThemedText>
        {download.status === "downloaded" ? (
          <Pressable onPress={() => removeDownload(download.episodeId)}>
            <ThemedText type="small" themeColor="accent">
              Delete
            </ThemedText>
          </Pressable>
        ) : null}
        {download.status === "error" ? (
          <Pressable onPress={() => retryDownload(download.episodeId)}>
            <ThemedText type="small" themeColor="accent">
              Retry
            </ThemedText>
          </Pressable>
        ) : null}
      </ThemedView>
    ))
  );
}
```

`library.tsx` doesn't currently import `ThemedView` — add
`import { ThemedView } from "@/components/themed-view";` to its import
block.

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add "apps/mobile/src/app/(app)/(tabs)/library.tsx"
git commit -m "Prompt 10: add Downloads section to the Library tab"
```

---

### Task 15: Settings screen + Profile entry point

**Files:**

- Create: `apps/mobile/src/app/(app)/settings.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/profile.tsx`

**Interfaces:**

- Consumes: `useSettingsStore` (Task 8).

No test — screen-level UI, matches convention.

- [ ] **Step 1: Write the Settings screen**

```tsx
// apps/mobile/src/app/(app)/settings.tsx
import { StyleSheet, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BackButton } from "@/components/ui/back-button";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { useSettingsStore } from "@/stores/settings-store";

export default function SettingsScreen() {
  const wifiOnlyDownloads = useSettingsStore((state) => state.wifiOnlyDownloads);
  const setWifiOnlyDownloads = useSettingsStore((state) => state.setWifiOnlyDownloads);

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <SectionHeader title="Settings" />
      <ThemedView style={styles.row}>
        <ThemedView style={styles.rowText}>
          <ThemedText type="default">Download over Wi-Fi only</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Protects your data bundle. Downloads wait for Wi-Fi when this is on.
          </ThemedText>
        </ThemedView>
        <Switch value={wifiOnlyDownloads} onValueChange={setWifiOnlyDownloads} />
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
```

- [ ] **Step 2: Register the route**

In `apps/mobile/src/app/(app)/_layout.tsx`, add a new `Stack.Screen`
next to the existing `coins` one:

```tsx
<Stack.Screen name="coins" options={{ headerShown: false }} />
<Stack.Screen name="settings" options={{ headerShown: false }} />
```

- [ ] **Step 3: Add the entry point on Profile**

In `apps/mobile/src/app/(app)/(tabs)/profile.tsx`, add a "Settings"
button. Place it right before the existing Sign Out/Sign In button:

```tsx
<Button label="Settings" variant="ghost" onPress={() => router.push("/settings")} />
```

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add "apps/mobile/src/app/(app)/settings.tsx" "apps/mobile/src/app/(app)/_layout.tsx" "apps/mobile/src/app/(app)/(tabs)/profile.tsx"
git commit -m "Prompt 10: add Settings screen with the wifi-only download toggle"
```

---

### Task 16: Offline banner + cold-start redirect

**Files:**

- Create: `apps/mobile/src/components/offline-banner.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx`

**Interfaces:**

- Consumes: `useNetworkStatus` (Task 9), `resolveOfflineLaunchRedirect` (Task 10).

No test for the banner component or the layout wiring (UI/effect
wiring, matches convention) — the decision logic underneath both is
already unit-tested in Tasks 9 and 10.

- [ ] **Step 1: Write the banner**

```tsx
// apps/mobile/src/components/offline-banner.tsx
import { StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useNetworkStatus } from "@/hooks/use-network-status";

export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();

  if (isConnected !== false) {
    return null;
  }

  return (
    <ThemedView style={styles.banner}>
      <ThemedText type="small" style={styles.text}>
        You&apos;re offline — playing downloaded episodes only.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
  },
  text: {
    color: "#FFFFFF",
  },
});
```

- [ ] **Step 2: Wire the cold-start redirect and mount the banner in the root layout**

In `apps/mobile/src/app/_layout.tsx`, add imports:

```ts
import { useRef } from "react";
```

```ts
import { OfflineBanner } from "@/components/offline-banner";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { resolveOfflineLaunchRedirect } from "@/lib/offline-redirect";
```

Inside `RootLayout`, alongside the other hook calls:

```ts
const { isConnected } = useNetworkStatus();
const hasCheckedOfflineLaunch = useRef(false);
```

Extend the existing auth-redirect effect — after `resolveAuthRedirect`
returns `null` (auth redirect always takes priority) and only once per
app session:

```ts
useEffect(() => {
  if (loading || !fontsLoaded) {
    return;
  }
  const href = resolveAuthRedirect({
    session: session !== null,
    guestMode,
    passwordRecovery,
    segments,
  });
  if (href) {
    router.replace(href);
    return;
  }
  if (!hasCheckedOfflineLaunch.current && isConnected !== null) {
    hasCheckedOfflineLaunch.current = true;
    const offlineHref = resolveOfflineLaunchRedirect({ isConnected, segments });
    if (offlineHref) {
      router.replace(offlineHref);
    }
  }
}, [loading, fontsLoaded, session, guestMode, passwordRecovery, segments, router, isConnected]);
```

Mount the banner in both render branches — the loading branch:

```tsx
return (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider value={theme}>
      <ThemedView style={styles.loadingContainer}>
        <ActivityIndicator />
      </ThemedView>
      <AudioStatusDriver />
      <OfflineBanner />
    </ThemeProvider>
  </QueryClientProvider>
);
```

and the main branch:

```tsx
return (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider value={theme}>
      <AnimatedSplashOverlay />
      <Slot />
      <AudioStatusDriver />
      <OfflineBanner />
    </ThemeProvider>
  </QueryClientProvider>
);
```

- [ ] **Step 3: Typecheck, run the full test suite, and commit**

```bash
pnpm typecheck
cd apps/mobile && npx jest
```

Expected: everything passes, including the pre-existing
`auth-redirect.test.ts` (untouched) alongside the new
`offline-redirect.test.ts` and `use-network-status.test.ts`.

```bash
git add apps/mobile/src/components/offline-banner.tsx apps/mobile/src/app/_layout.tsx
git commit -m "Prompt 10: add offline banner and cold-start Library redirect"
```

---

### Task 17: `docs/offline-downloads.md`

**Files:**

- Create: `docs/offline-downloads.md`

- [ ] **Step 1: Write the document**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/offline-downloads.md
git commit -m "Prompt 10: add docs/offline-downloads.md"
```

---

### Task 18: Whole-repo verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck, lint, and test run**

```bash
pnpm typecheck
pnpm lint
cd apps/mobile && npx jest
```

Expected: all green — every workspace package typechecks and lints
clean, and every test file (including this feature's `wifi-gate.test.ts`,
`offline-redirect.test.ts`, `use-network-status.test.ts`,
`download-queue-store.test.ts`, `format-bytes.test.ts`, plus every
pre-existing test) passes.

- [ ] **Step 2: Confirm no stray references to the old stub's contract remain**

```bash
grep -rn "Prompt 10 replaces this function's body" apps/mobile/src
```

Expected: no matches — the comment left in `local-downloads.ts` by
Prompt 8 should have been fully replaced by Task 6, not left alongside
the real implementation.

- [ ] **Step 3: Manual device/simulator verification**

The following are native-I/O paths this environment cannot exercise in
Jest (matches the carve-out Prompt 8 made for real audio playback and
Prompt 9 made for real purchases) — verify by hand on a device or
simulator with a dev client build:

- Download a free episode from a series detail screen; confirm it
  appears in Library → Downloads with a size, and that turning on
  Airplane Mode still plays it.
- Attempt to download a locked (coins/premium) episode you don't have
  access to; confirm the toast appears and nothing gets queued.
- Toggle "Download over Wi-Fi only" on in Settings, switch the device to
  cellular, and start a download; confirm it shows "Waiting for Wi-Fi"
  and resumes automatically once Wi-Fi reconnects.
- Force-kill the app mid-download; relaunch and confirm the orphaned
  `.tmp` file is gone and the episode is not falsely listed as
  downloaded (re-download works cleanly).
- Launch the app in Airplane Mode; confirm it opens directly to the
  Library tab with the offline banner visible, and that navigating to
  Home manually afterward does _not_ get force-redirected back.
- Delete a single download and use "Delete All"; confirm both remove the
  underlying files (check device storage) and the Downloads list total
  updates.

- [ ] **Step 4: Final commit if anything was fixed during verification**

Only if Steps 1–3 required a fix:

```bash
git add -A
git commit -m "Prompt 10: verification fixes"
```
