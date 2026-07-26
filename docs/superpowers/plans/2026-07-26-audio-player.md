# Audio Player (Prompt 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full audio playback for the mobile app per `docs/PROMPT_PACK.md`'s Prompt 8 — play/pause/seek/skip±15s/next/previous, background + lock-screen controls, position persistence surviving app kill, auto-advance with a locked-episode stub sheet, sleep timer, bookmarks, and a Prompt-10-ready offline-source seam.

**Architecture:** A single `expo-audio` `AudioPlayer` singleton (`apps/mobile/src/lib/audio-player.ts`) is the source of truth for the currently-loaded track's playback state; the Zustand `player-store.ts` owns the queue (which episodes, what order, current index) and every playback action, calling into the singleton — the same "store owns side effects" pattern `auth-store.ts` already uses. One always-mounted, render-nothing `AudioStatusDriver` component is the sole place that reacts to native status changes (15s position saves, auto-advance on track end, sleep timer firing). This deviates from `docs/superpowers/specs/2026-07-26-audio-player-design.md`'s original `AudioPlaylist`-based design — see that file's "State architecture" section for why (`AudioPlaylist` has no lock-screen metadata support at all; only the single-track `AudioPlayer` class does, and lock-screen controls are a hard requirement of this prompt). The spec file has already been corrected to match this plan; read it for the full reasoning, this plan is the executable version of it.

**Tech Stack:** `expo-audio` (replacing the never-integrated `react-native-track-player`), `expo-file-system`'s SDK-57 class-based `File`/`Paths` API, existing Zustand + TanStack Query + Supabase stack.

## Global Constraints

- Package versions: `expo-audio` must be installed via `npx expo install expo-audio` (not a hand-picked version) so the SDK-57-compatible release is resolved automatically.
- `expo-file-system` usage in this feature must use the SDK-57 class-based API (`import { File, Paths } from "expo-file-system"`) — **not** `expo-file-system/legacy` and not `FileSystem.documentDirectory` string concatenation.
- `expo-audio`'s `AudioPlaylist` class must **not** be used anywhere in this feature (see Architecture above) — always use the single `AudioPlayer` singleton plus the store-owned queue.
- A Dev Client build is required from this task onward (Expo Go cannot run a project with a native config-plugin change) — this is an infrastructure/device step outside this environment's scope, not a coding task in this plan.
- Verification bar for every task: `pnpm typecheck` and `pnpm lint` from the repo root (fanned out via Turborepo) must pass. Only the four modules called out as TDD tasks (Task 3, Task 4, Task 5) get real unit tests — actual native audio playback, lock-screen controls, background behavior, and interruption recovery are manual/device verification, matching every prior prompt's testing approach and the design spec's own "Testing approach" section.
- Money/coins/unlock purchase flow is explicitly out of scope (Prompt 9's job) — the "Unlock Sheet" this plan builds is a stub: episode title + price + a disabled button.
- Actually downloading/caching audio for offline playback is explicitly out of scope (Prompt 10's job) — `getLocalDownloadPath` stays a stub returning `null`.

---

### Task 1: Swap `react-native-track-player` for `expo-audio`

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.json`

**Interfaces:**

- Produces: a working `expo-audio` install whose exact named exports (`useAudioPlayer`, `useAudioPlayerStatus`, `createAudioPlayer`, `setAudioModeAsync`) are confirmed to exist as flat named exports from `"expo-audio"` before any later task writes code against them.

- [ ] **Step 1: Remove the unused native audio dependency**

In `apps/mobile/package.json`, delete this line from `dependencies`:

```json
"react-native-track-player": "^4.1.2",
```

- [ ] **Step 2: Install expo-audio**

Run from `apps/mobile/`:

```bash
cd apps/mobile && npx expo install expo-audio
```

Expected: `package.json` gains an `expo-audio` entry under `dependencies` with a version compatible with Expo SDK 57 (picked automatically by the install command — do not hand-edit the version).

- [ ] **Step 3: Add the expo-audio config plugin**

In `apps/mobile/app.json`, add to the `"plugins"` array (after `"expo-web-browser"`):

```json
[
  "expo-audio",
  {
    "enableBackgroundPlayback": true,
    "enableBackgroundRecording": false
  }
]
```

- [ ] **Step 4: Verify the actual named exports before any later task depends on them**

Run:

```bash
find apps/mobile/node_modules/expo-audio -name "*.d.ts" | xargs grep -n "^export " | grep -E "useAudioPlayer\b|useAudioPlayerStatus\b|createAudioPlayer\b|setAudioModeAsync\b"
```

Expected: all four names appear as flat named exports (e.g. `export declare function createAudioPlayer(...)`, `export declare function setAudioModeAsync(...)`), not nested under an `Audio.` namespace object. If any of them is instead exposed only via a namespace object (e.g. `export declare const Audio: {...}`), stop and adjust the import style in every later task's code accordingly (`import { Audio } from "expo-audio"` + `Audio.createAudioPlayer(...)` / `Audio.setAudioModeAsync(...)`) before proceeding — this single checkpoint prevents that mistake from propagating through the whole plan.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add apps/mobile/package.json apps/mobile/app.json
git commit -m "Prompt 8: swap react-native-track-player for expo-audio"
```

---

### Task 2: `episode_bookmarks` table + schema/RLS docs

**Files:**

- Create: `supabase/migrations/20260726110000_episode_bookmarks.sql`
- Modify: `docs/schema.md`
- Modify: `docs/rls-policies.md`

**Interfaces:**

- Produces: `episode_bookmarks` table — `id uuid PK`, `user_id uuid FK profiles`, `episode_id uuid FK episodes`, `position_seconds int`, `note text nullable`, `created_at timestamptz` — owner-only RLS, consumed by Task 11's bookmark hooks.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260726110000_episode_bookmarks.sql

create table episode_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  episode_id uuid not null references episodes (id) on delete cascade,
  position_seconds int not null,
  note text,
  created_at timestamptz not null default now()
);

create index episode_bookmarks_user_id_idx on episode_bookmarks (user_id);
create index episode_bookmarks_episode_id_idx on episode_bookmarks (episode_id);

alter table episode_bookmarks enable row level security;

create policy episode_bookmarks_owner_all
  on episode_bookmarks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 2: Document the table in `docs/schema.md`**

Add this section immediately after the existing `## plays` section (end of file):

```markdown
### `episode_bookmarks`

A user bookmarking a specific moment in an episode, with an optional note.

| Column             | Type                              | Notes                |
| ------------------ | --------------------------------- | -------------------- |
| `id`               | `uuid`, PK                        |                      |
| `user_id`          | `uuid`, not null, FK → `profiles` | `ON DELETE CASCADE`. |
| `episode_id`       | `uuid`, not null, FK → `episodes` | `ON DELETE CASCADE`. |
| `position_seconds` | `int`, not null                   |                      |
| `note`             | `text`, nullable                  |                      |
| `created_at`       | `timestamptz`                     |                      |

No unique constraint — a user can bookmark multiple moments in the same
episode.
```

- [ ] **Step 3: Document the RLS policy in `docs/rls-policies.md`**

Add `episode_bookmarks` to the existing `### \`favorites\`, \`listening_progress\``heading's table list — rename that heading to`### \`favorites\`, \`listening_progress\`, \`episode_bookmarks\`` since all three share the exact same owner-full-access pattern, and its body text already says "Both tables are user-mutable state" — update that to "All three tables are user-mutable state".

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260726110000_episode_bookmarks.sql docs/schema.md docs/rls-policies.md
git commit -m "Prompt 8: add episode_bookmarks table"
```

---

### Task 3: `resolveEpisodeSource` — the audio-source seam

**Files:**

- Create: `apps/mobile/src/lib/local-downloads.ts`
- Create: `apps/mobile/src/lib/resolve-episode-source.ts`
- Test: `apps/mobile/src/lib/resolve-episode-source.test.ts`

**Interfaces:**

- Consumes: `supabase` from `@/lib/supabase` (`supabase.functions.invoke`), `FunctionsHttpError` from `@supabase/supabase-js`.
- Produces: `resolveEpisodeSource(episodeId: string): Promise<EpisodeSourceResult>` and `getLocalDownloadPath(episodeId: string): Promise<string | null>` (stub, always `null`) — consumed by Task 7's `player-store.ts`.

- [ ] **Step 1: Write the local-downloads stub**

```ts
// apps/mobile/src/lib/local-downloads.ts
// Prompt 10 replaces this function's body with a real lookup against
// downloaded files (expo-file-system). Prompt 8 stubs it so
// resolveEpisodeSource's seam exists without building the download
// mechanism itself.
export async function getLocalDownloadPath(_episodeId: string): Promise<string | null> {
  return null;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// apps/mobile/src/lib/resolve-episode-source.test.ts
import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

import { resolveEpisodeSource } from "./resolve-episode-source";

jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock("./local-downloads", () => ({
  getLocalDownloadPath: jest.fn().mockResolvedValue(null),
}));

const mockInvoke = supabase.functions.invoke as jest.Mock;

describe("resolveEpisodeSource", () => {
  it("returns a local source without calling the edge function when a local file exists", async () => {
    jest
      .requireMock("./local-downloads")
      .getLocalDownloadPath.mockResolvedValueOnce("/local/ep-1.m4a");

    const result = await resolveEpisodeSource("ep-1");

    expect(result).toEqual({ type: "local", path: "/local/ep-1.m4a" });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("maps a 200 response to a remote source", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { signedUrl: "https://example.com/signed.m4a", expiresIn: 21600 },
      error: null,
    });

    const result = await resolveEpisodeSource("ep-2");

    expect(result).toEqual({ type: "remote", url: "https://example.com/signed.m4a" });
  });

  it("maps a 403 response to locked", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 403 })),
    });

    expect(await resolveEpisodeSource("ep-3")).toEqual({ type: "locked" });
  });

  it("maps a 404 response to not_found", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 404 })),
    });

    expect(await resolveEpisodeSource("ep-4")).toEqual({ type: "not_found" });
  });

  it("maps a 400 response to error", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 400 })),
    });

    expect(await resolveEpisodeSource("ep-5")).toEqual({ type: "error" });
  });

  it("maps a 500 response to error", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 500 })),
    });

    expect(await resolveEpisodeSource("ep-6")).toEqual({ type: "error" });
  });

  it("maps a network/relay error (no FunctionsHttpError) to error", async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error("network down") });

    expect(await resolveEpisodeSource("ep-7")).toEqual({ type: "error" });
  });

  it("maps a 200 response missing signedUrl to error", async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });

    expect(await resolveEpisodeSource("ep-8")).toEqual({ type: "error" });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd apps/mobile && npx jest resolve-episode-source
```

Expected: FAIL — `Cannot find module './resolve-episode-source'`.

- [ ] **Step 4: Implement `resolveEpisodeSource`**

```ts
// apps/mobile/src/lib/resolve-episode-source.ts
import { FunctionsHttpError } from "@supabase/supabase-js";

import { getLocalDownloadPath } from "@/lib/local-downloads";
import { supabase } from "@/lib/supabase";

export type EpisodeSourceResult =
  | { type: "local"; path: string }
  | { type: "remote"; url: string }
  | { type: "locked" }
  | { type: "not_found" }
  | { type: "error" };

export async function resolveEpisodeSource(episodeId: string): Promise<EpisodeSourceResult> {
  const localPath = await getLocalDownloadPath(episodeId);
  if (localPath) {
    return { type: "local", path: localPath };
  }
  return resolveRemoteEpisodeSource(episodeId);
}

async function resolveRemoteEpisodeSource(episodeId: string): Promise<EpisodeSourceResult> {
  const { data, error } = await supabase.functions.invoke<{ signedUrl: string; expiresIn: number }>(
    "get-episode-audio",
    { body: { episode_id: episodeId } },
  );

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context.status;
      if (status === 403) {
        return { type: "locked" };
      }
      if (status === 404) {
        return { type: "not_found" };
      }
    }
    return { type: "error" };
  }

  if (!data?.signedUrl) {
    return { type: "error" };
  }

  return { type: "remote", url: data.signedUrl };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd apps/mobile && npx jest resolve-episode-source
```

Expected: PASS, all 8 cases.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/lib/local-downloads.ts apps/mobile/src/lib/resolve-episode-source.ts apps/mobile/src/lib/resolve-episode-source.test.ts
git commit -m "Prompt 8: add resolveEpisodeSource audio-source seam"
```

---

### Task 4: Local-first listening-progress persistence

**Files:**

- Create: `apps/mobile/src/lib/local-listening-progress.ts`
- Test: `apps/mobile/src/lib/local-listening-progress.test.ts`

**Interfaces:**

- Consumes: `File`, `Paths` from `expo-file-system`; `supabase` from `@/lib/supabase`.
- Produces: `writeLocalProgress(episodeId, positionSeconds)`, `readLocalProgress(episodeId): LocalProgress | null`, `resolveResumePosition(local, server): number`, `persistListeningProgress(episodeId, positionSeconds, durationSeconds, userId): Promise<void>` — consumed by Task 7's `player-store.ts` (resume-position lookup) and Task 8's `AudioStatusDriver` (save tick).

- [ ] **Step 1: Write the failing tests for the pure logic**

```ts
// apps/mobile/src/lib/local-listening-progress.test.ts
import { resolveResumePosition } from "./local-listening-progress";

describe("resolveResumePosition", () => {
  it("returns 0 when neither local nor server progress exists", () => {
    expect(resolveResumePosition(null, null)).toBe(0);
  });

  it("returns the local position when there is no server progress", () => {
    expect(
      resolveResumePosition({ positionSeconds: 42, updatedAt: "2026-07-01T00:00:00Z" }, null),
    ).toBe(42);
  });

  it("returns the server position when there is no local progress", () => {
    expect(
      resolveResumePosition(null, { positionSeconds: 99, updatedAt: "2026-07-01T00:00:00Z" }),
    ).toBe(99);
  });

  it("prefers the newer local progress over a stale server row", () => {
    const local = { positionSeconds: 120, updatedAt: "2026-07-02T00:00:00Z" };
    const server = { positionSeconds: 30, updatedAt: "2026-07-01T00:00:00Z" };
    expect(resolveResumePosition(local, server)).toBe(120);
  });

  it("prefers the newer server progress over a stale local row", () => {
    const local = { positionSeconds: 30, updatedAt: "2026-07-01T00:00:00Z" };
    const server = { positionSeconds: 200, updatedAt: "2026-07-02T00:00:00Z" };
    expect(resolveResumePosition(local, server)).toBe(200);
  });

  it("prefers local when both timestamps are exactly equal", () => {
    const local = { positionSeconds: 10, updatedAt: "2026-07-01T00:00:00Z" };
    const server = { positionSeconds: 20, updatedAt: "2026-07-01T00:00:00Z" };
    expect(resolveResumePosition(local, server)).toBe(10);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/mobile && npx jest local-listening-progress
```

Expected: FAIL — `Cannot find module './local-listening-progress'`.

- [ ] **Step 3: Implement the module**

```ts
// apps/mobile/src/lib/local-listening-progress.ts
import { File, Paths } from "expo-file-system";

import { supabase } from "@/lib/supabase";

export type LocalProgress = { positionSeconds: number; updatedAt: string };
type ServerProgress = { positionSeconds: number; updatedAt: string };
type ProgressFile = Record<string, LocalProgress>;

const progressFile = new File(Paths.document, "listening-progress.json");

function readAll(): ProgressFile {
  if (!progressFile.exists) {
    return {};
  }
  try {
    return JSON.parse(progressFile.textSync()) as ProgressFile;
  } catch {
    return {};
  }
}

function writeAll(data: ProgressFile): void {
  if (!progressFile.exists) {
    progressFile.create();
  }
  progressFile.write(JSON.stringify(data));
}

export function readLocalProgress(episodeId: string): LocalProgress | null {
  return readAll()[episodeId] ?? null;
}

export function writeLocalProgress(episodeId: string, positionSeconds: number): void {
  const all = readAll();
  all[episodeId] = { positionSeconds, updatedAt: new Date().toISOString() };
  writeAll(all);
}

/**
 * A stale server row (progress made on another device, then this device
 * played further before losing connectivity) never regresses a fresher
 * local one, and vice versa.
 */
export function resolveResumePosition(
  local: LocalProgress | null,
  server: ServerProgress | null,
): number {
  if (!local && !server) {
    return 0;
  }
  if (!local) {
    return server!.positionSeconds;
  }
  if (!server) {
    return local.positionSeconds;
  }
  return new Date(local.updatedAt) >= new Date(server.updatedAt)
    ? local.positionSeconds
    : server.positionSeconds;
}

/**
 * Always writes locally (guest or signed-in). Only signed-in users
 * additionally upsert to `listening_progress` — a real composite-PK
 * upsert, since that table's primary key is the plain
 * `(user_id, episode_id)` pair (unlike `favorites`' partial-index
 * workaround).
 */
export async function persistListeningProgress(
  episodeId: string,
  positionSeconds: number,
  durationSeconds: number,
  userId: string | null,
): Promise<void> {
  writeLocalProgress(episodeId, positionSeconds);

  if (!userId) {
    return;
  }

  const completed = durationSeconds > 0 && positionSeconds / durationSeconds >= 0.95;
  const { error } = await supabase.from("listening_progress").upsert(
    {
      user_id: userId,
      episode_id: episodeId,
      position_seconds: Math.floor(positionSeconds),
      completed,
    },
    { onConflict: "user_id,episode_id" },
  );

  if (error) {
    console.error("persistListeningProgress upsert error:", error);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/mobile && npx jest local-listening-progress
```

Expected: PASS, all 6 cases.

- [ ] **Step 5: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/lib/local-listening-progress.ts apps/mobile/src/lib/local-listening-progress.test.ts
git commit -m "Prompt 8: add local-first listening-progress persistence"
```

---

### Task 5: Sleep timer module

**Files:**

- Create: `apps/mobile/src/lib/sleep-timer.ts`
- Test: `apps/mobile/src/lib/sleep-timer.test.ts`

**Interfaces:**

- Produces: `SleepTimerOption = 10 | 20 | 30 | 45 | "end-of-episode"`, `startSleepTimer(option, onFire): () => void` — consumed by Task 7's `player-store.ts` (numeric options only; `"end-of-episode"` is handled directly in the store/driver as a flag, not via this function).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/lib/sleep-timer.test.ts
import { startSleepTimer } from "./sleep-timer";

describe("startSleepTimer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("calls onFire after the given number of minutes", () => {
    const onFire = jest.fn();
    startSleepTimer(10, onFire);

    jest.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(onFire).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("supports each documented option", () => {
    for (const minutes of [10, 20, 30, 45] as const) {
      const onFire = jest.fn();
      startSleepTimer(minutes, onFire);
      jest.advanceTimersByTime(minutes * 60 * 1000);
      expect(onFire).toHaveBeenCalledTimes(1);
    }
  });

  it("returns a cancel function that stops onFire from firing", () => {
    const onFire = jest.fn();
    const cancel = startSleepTimer(10, onFire);

    cancel();
    jest.advanceTimersByTime(10 * 60 * 1000);

    expect(onFire).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/mobile && npx jest sleep-timer
```

Expected: FAIL — `Cannot find module './sleep-timer'`.

- [ ] **Step 3: Implement the module**

```ts
// apps/mobile/src/lib/sleep-timer.ts
export type SleepTimerOption = 10 | 20 | 30 | 45 | "end-of-episode";

/**
 * Only handles the numeric (minutes) options — "end-of-episode" isn't a
 * timer at all, it's a one-shot flag the player store/AudioStatusDriver
 * check directly when a track finishes.
 */
export function startSleepTimer(minutes: 10 | 20 | 30 | 45, onFire: () => void): () => void {
  const timeoutId = setTimeout(onFire, minutes * 60 * 1000);
  return () => clearTimeout(timeoutId);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/mobile && npx jest sleep-timer
```

Expected: PASS, all 3 cases (6 assertions across the loop in the second test).

- [ ] **Step 5: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/lib/sleep-timer.ts apps/mobile/src/lib/sleep-timer.test.ts
git commit -m "Prompt 8: add sleep timer module"
```

---

### Task 6: Audio player singleton + startup audio mode

**Files:**

- Create: `apps/mobile/src/lib/audio-player.ts`
- Create: `apps/mobile/src/hooks/use-configure-audio-mode.ts`
- Modify: `apps/mobile/src/app/_layout.tsx`

**Interfaces:**

- Produces: `audioPlayer: AudioPlayer` (module-scoped singleton) — consumed by Task 7 (`player-store.ts`), Task 8 (`AudioStatusDriver`), Task 9 (`MiniPlayer`), Task 13 (Now Playing overlay).
- Produces: `useConfigureAudioMode()` — called once from `RootLayout`.

- [ ] **Step 1: Create the AudioPlayer singleton**

```ts
// apps/mobile/src/lib/audio-player.ts
// A single, module-scoped AudioPlayer — playback must survive screen
// navigation and app backgrounding, so it can't be component-scoped
// state. `createAudioPlayer()` (not the `useAudioPlayer()` hook) is
// used deliberately: the hook's player auto-releases on the owning
// component's unmount, which is wrong for a singleton that outlives
// every component. Mirrors query-client.ts's singleton pattern.
import { createAudioPlayer } from "expo-audio";

export const audioPlayer = createAudioPlayer();
```

- [ ] **Step 2: Create the startup audio-mode hook**

```ts
// apps/mobile/src/hooks/use-configure-audio-mode.ts
import { setAudioModeAsync } from "expo-audio";
import { useEffect } from "react";

// `doNotMix` requests exclusive audio focus (required for lock-screen
// media controls to function at all) — it does NOT reliably resume
// playback automatically once an interruption (e.g. a phone call)
// ends. The UI never assumes it does; see
// docs/superpowers/specs/2026-07-26-audio-player-design.md's
// "Interruption handling" section for the verified reasoning.
export function useConfigureAudioMode() {
  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    });
  }, []);
}
```

- [ ] **Step 3: Wire it into the root layout**

In `apps/mobile/src/app/_layout.tsx`, add the import next to the other hook imports:

```ts
import { useConfigureAudioMode } from "@/hooks/use-configure-audio-mode";
```

And call it next to the other startup hooks inside `RootLayout`:

```ts
useAuthListener();
useRecoveryLinkHandler();
useConfigureAudioMode();
```

- [ ] **Step 4: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/lib/audio-player.ts apps/mobile/src/hooks/use-configure-audio-mode.ts apps/mobile/src/app/_layout.tsx
git commit -m "Prompt 8: add AudioPlayer singleton and startup audio mode"
```

---

### Task 7: Rewrite `player-store.ts` — queue ownership + playback actions

**Files:**

- Modify: `apps/mobile/src/stores/player-store.ts`

**Interfaces:**

- Consumes: `audioPlayer` from `@/lib/audio-player` (Task 6); `resolveEpisodeSource` from `@/lib/resolve-episode-source` (Task 3); `readLocalProgress`, `resolveResumePosition` from `@/lib/local-listening-progress` (Task 4); `startSleepTimer`, `SleepTimerOption` from `@/lib/sleep-timer` (Task 5); `supabase` from `@/lib/supabase`; `useAuthStore` from `@/stores/auth-store`; `SeriesDetailEpisode` type from `@/hooks/queries/use-series-detail`.
- Produces: `QueueEpisode` type and the full `PlayerState` (queue, currentIndex, currentEpisode, expanded, sleepTimer, lockedEpisode, toastMessage, and all actions below) — consumed by Task 8 (driver), Task 9 (MiniPlayer), Task 11 (bookmark note capture), Task 12 (Unlock Sheet stub), Task 13 (Now Playing overlay), Task 14 (series detail screen), Task 15 (Library bookmarks tap-to-open).

This task has no automated test — per the Global Constraints, native-audio-adjacent integration logic is manual/device-verified. `pnpm typecheck` is the correctness bar here, since every branch's types are load-bearing.

- [ ] **Step 1: Replace the store**

```ts
// apps/mobile/src/stores/player-store.ts
import { create } from "zustand";

import { audioPlayer } from "@/lib/audio-player";
import { readLocalProgress, resolveResumePosition } from "@/lib/local-listening-progress";
import { resolveEpisodeSource } from "@/lib/resolve-episode-source";
import { startSleepTimer, type SleepTimerOption } from "@/lib/sleep-timer";
import { supabase } from "@/lib/supabase";
import type { SeriesDetailEpisode } from "@/hooks/queries/use-series-detail";
import { useAuthStore } from "@/stores/auth-store";

export type QueueEpisode = SeriesDetailEpisode & {
  seriesId: string;
  seriesTitle: string;
  coverImageUrl: string | null;
};

type SleepTimerState =
  | { mode: "off" }
  | { mode: "timer"; minutes: 10 | 20 | 30 | 45; cancel: () => void }
  | { mode: "end-of-episode" };

type PlayerState = {
  queue: QueueEpisode[];
  currentIndex: number;
  currentEpisode: QueueEpisode | null;
  expanded: boolean;
  sleepTimer: SleepTimerState;
  lockedEpisode: QueueEpisode | null;
  toastMessage: string | null;

  playQueue: (
    episodes: QueueEpisode[],
    startIndex: number,
    startPositionOverrideSeconds?: number,
  ) => Promise<void>;
  playPause: () => void;
  seekBy: (deltaSeconds: number) => void;
  seekTo: (seconds: number) => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  setPlaybackRate: (rate: number) => void;
  expand: () => void;
  collapse: () => void;
  dismissLockedEpisode: () => void;
  startSleepTimer: (option: SleepTimerOption) => void;
  cancelSleepTimer: () => void;
  dismissToast: () => void;
};

async function fetchServerProgress(
  episodeId: string,
  userId: string,
): Promise<{ positionSeconds: number; updatedAt: string } | null> {
  const { data, error } = await supabase
    .from("listening_progress")
    .select("position_seconds, updated_at")
    .eq("user_id", userId)
    .eq("episode_id", episodeId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return { positionSeconds: data.position_seconds, updatedAt: data.updated_at };
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  async function loadTrackAtIndex(
    index: number,
    startPositionOverrideSeconds?: number,
  ): Promise<void> {
    const { queue } = get();
    if (index < 0 || index >= queue.length) {
      audioPlayer.pause();
      return;
    }
    const episode = queue[index];
    const result = await resolveEpisodeSource(episode.id);

    if (result.type === "locked") {
      set({ lockedEpisode: episode });
      audioPlayer.pause();
      return;
    }
    if (result.type === "not_found") {
      await loadTrackAtIndex(index + 1);
      return;
    }
    if (result.type === "error") {
      // Current track keeps playing per the spec's queue-building
      // behavior table — this is reached mid-queue (auto-advance or
      // manual next/previous), never on the very first track of a
      // freshly built queue.
      set({ toastMessage: "Couldn't load the next episode." });
      return;
    }

    const source = result.type === "local" ? { uri: `file://${result.path}` } : { uri: result.url };
    audioPlayer.replace(source);
    audioPlayer.setActiveForLockScreen(true, {
      title: episode.title,
      artist: episode.seriesTitle,
      artworkUrl: episode.coverImageUrl ?? undefined,
    });

    const session = useAuthStore.getState().session;
    const localProgress = readLocalProgress(episode.id);
    const serverProgress = session ? await fetchServerProgress(episode.id, session.user.id) : null;
    const resumeSeconds =
      startPositionOverrideSeconds ?? resolveResumePosition(localProgress, serverProgress);

    set({ currentIndex: index, currentEpisode: episode, lockedEpisode: null });

    if (resumeSeconds > 0) {
      try {
        await audioPlayer.seekTo(resumeSeconds);
      } catch {
        // Best-effort — a native timing edge case right after replace(),
        // not fatal to playback starting.
      }
    }
    audioPlayer.play();
  }

  return {
    queue: [],
    currentIndex: -1,
    currentEpisode: null,
    expanded: false,
    sleepTimer: { mode: "off" },
    lockedEpisode: null,
    toastMessage: null,

    playQueue: async (episodes, startIndex, startPositionOverrideSeconds) => {
      set({ queue: episodes });
      await loadTrackAtIndex(startIndex, startPositionOverrideSeconds);
    },
    playPause: () => {
      if (audioPlayer.playing) {
        audioPlayer.pause();
      } else {
        audioPlayer.play();
      }
    },
    seekBy: (deltaSeconds) => {
      const target = Math.max(0, audioPlayer.currentTime + deltaSeconds);
      audioPlayer.seekTo(target).catch(() => {});
    },
    seekTo: (seconds) => {
      audioPlayer.seekTo(Math.max(0, seconds)).catch(() => {});
    },
    next: async () => {
      await loadTrackAtIndex(get().currentIndex + 1);
    },
    previous: async () => {
      await loadTrackAtIndex(get().currentIndex - 1);
    },
    setPlaybackRate: (rate) => {
      audioPlayer.setPlaybackRate(rate);
    },
    expand: () => set({ expanded: true }),
    collapse: () => set({ expanded: false }),
    dismissLockedEpisode: () => set({ lockedEpisode: null }),
    startSleepTimer: (option) => {
      const current = get().sleepTimer;
      if (current.mode === "timer") {
        current.cancel();
      }
      if (option === "end-of-episode") {
        set({ sleepTimer: { mode: "end-of-episode" } });
        return;
      }
      const cancel = startSleepTimer(option, () => {
        audioPlayer.pause();
        set({ sleepTimer: { mode: "off" } });
      });
      set({ sleepTimer: { mode: "timer", minutes: option, cancel } });
    },
    cancelSleepTimer: () => {
      const current = get().sleepTimer;
      if (current.mode === "timer") {
        current.cancel();
      }
      set({ sleepTimer: { mode: "off" } });
    },
    dismissToast: () => set({ toastMessage: null }),
  };
});
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/stores/player-store.ts
git commit -m "Prompt 8: rewrite player-store around a single-AudioPlayer queue"
```

---

### Task 8: `AudioStatusDriver` — position saves, auto-advance, sleep timer firing

**Files:**

- Create: `apps/mobile/src/components/audio-status-driver.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: `useAudioPlayerStatus` from `expo-audio`; `audioPlayer` from `@/lib/audio-player`; `persistListeningProgress` from `@/lib/local-listening-progress`; `usePlayerStore` from `@/stores/player-store`; `useAuthStore` from `@/stores/auth-store`.
- Produces: `<AudioStatusDriver />` — a render-nothing component mounted once in `(app)/_layout.tsx`.

- [ ] **Step 1: Implement the driver**

```tsx
// apps/mobile/src/components/audio-status-driver.tsx
import { useAudioPlayerStatus } from "expo-audio";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { audioPlayer } from "@/lib/audio-player";
import { persistListeningProgress } from "@/lib/local-listening-progress";
import { useAuthStore } from "@/stores/auth-store";
import { usePlayerStore } from "@/stores/player-store";

// Render-nothing component, mounted once alongside <MiniPlayer />. It
// exists because no native event fires on a 15s tick or a track
// finishing — useAudioPlayerStatus's periodic status object is the only
// signal available, so this is the one place that watches it and drives
// every status-triggered side effect (position saves, auto-advance,
// sleep timer firing).
export function AudioStatusDriver() {
  const status = useAudioPlayerStatus(audioPlayer);
  const currentEpisode = usePlayerStore((state) => state.currentEpisode);
  const sleepTimer = usePlayerStore((state) => state.sleepTimer);
  const next = usePlayerStore((state) => state.next);
  const cancelSleepTimer = usePlayerStore((state) => state.cancelSleepTimer);
  const session = useAuthStore((state) => state.session);

  const statusRef = useRef(status);
  statusRef.current = status;
  const episodeRef = useRef(currentEpisode);
  episodeRef.current = currentEpisode;
  const userIdRef = useRef(session?.user.id ?? null);
  userIdRef.current = session?.user.id ?? null;

  const saveProgressRef = useRef(() => {
    const episode = episodeRef.current;
    const currentStatus = statusRef.current;
    if (episode && currentStatus.currentTime > 0) {
      void persistListeningProgress(
        episode.id,
        currentStatus.currentTime,
        currentStatus.duration,
        userIdRef.current,
      );
    }
  });

  // 15-second save tick — a stable interval reading the latest status via
  // a ref, so it isn't torn down and rebuilt on every ~500ms status
  // update.
  useEffect(() => {
    const interval = setInterval(() => saveProgressRef.current(), 15000);
    return () => clearInterval(interval);
  }, []);

  // Save immediately on a playing -> paused transition.
  const wasPlayingRef = useRef(status.playing);
  useEffect(() => {
    if (wasPlayingRef.current && !status.playing) {
      saveProgressRef.current();
    }
    wasPlayingRef.current = status.playing;
  }, [status.playing]);

  // Save immediately when the app leaves the foreground (background/kill).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        saveProgressRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  // didJustFinish edges false -> true exactly once per track end.
  const didJustFinishRef = useRef(false);
  useEffect(() => {
    if (status.didJustFinish && !didJustFinishRef.current) {
      didJustFinishRef.current = true;
      if (sleepTimer.mode === "end-of-episode") {
        audioPlayer.pause();
        cancelSleepTimer();
      } else {
        void next();
      }
    } else if (!status.didJustFinish) {
      didJustFinishRef.current = false;
    }
  }, [status.didJustFinish, sleepTimer.mode, next, cancelSleepTimer]);

  return null;
}
```

- [ ] **Step 2: Mount it in the app layout**

In `apps/mobile/src/app/(app)/_layout.tsx`, add the import:

```ts
import { AudioStatusDriver } from "@/components/audio-status-driver";
```

And render it as a sibling of `<MiniPlayer />`:

```tsx
      <MiniPlayer />
      <AudioStatusDriver />
```

- [ ] **Step 3: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/components/audio-status-driver.tsx "apps/mobile/src/app/(app)/_layout.tsx"
git commit -m "Prompt 8: add AudioStatusDriver for position saves and auto-advance"
```

---

### Task 9: Rewire `MiniPlayer` to real playback state

**Files:**

- Modify: `apps/mobile/src/components/ui/mini-player.tsx`

**Interfaces:**

- Consumes: `useAudioPlayerStatus` from `expo-audio`; `audioPlayer` from `@/lib/audio-player`; `usePlayerStore`'s `currentEpisode`, `playPause`, `seekTo`, `expand`.

- [ ] **Step 1: Replace the component**

```tsx
// apps/mobile/src/components/ui/mini-player.tsx
import { useAudioPlayerStatus } from "expo-audio";
import { useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { BottomTabInset, Spacing } from "@/constants/theme";
import { useRouteSegments } from "@/hooks/use-route-segments";
import { useTheme } from "@/hooks/use-theme";
import { audioPlayer } from "@/lib/audio-player";
import { usePlayerStore } from "@/stores/player-store";

export function MiniPlayer() {
  const theme = useTheme();
  const segments = useRouteSegments();
  const insets = useSafeAreaInsets();
  const currentEpisode = usePlayerStore((state) => state.currentEpisode);
  const playPause = usePlayerStore((state) => state.playPause);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const expand = usePlayerStore((state) => state.expand);
  const status = useAudioPlayerStatus(audioPlayer);
  const [trackWidth, setTrackWidth] = useState(0);

  if (!currentEpisode) {
    return null;
  }

  const isInTabs = segments.includes("(tabs)");
  const bottomOffset = isInTabs ? BottomTabInset : insets.bottom + Spacing.two;
  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const handleTrackPress = (event: { nativeEvent: { locationX: number } }) => {
    if (trackWidth <= 0 || status.duration <= 0) {
      return;
    }
    const fraction = Math.min(1, Math.max(0, event.nativeEvent.locationX / trackWidth));
    seekTo(fraction * status.duration);
  };

  return (
    <Pressable style={[styles.container, { bottom: bottomOffset }]} onPress={expand}>
      <Card style={styles.card}>
        <View style={[styles.artworkPlaceholder, { backgroundColor: theme.accentSoft }]} />
        <View style={styles.body}>
          <ThemedText type="small" style={styles.title} numberOfLines={1}>
            {currentEpisode.title}
          </ThemedText>
          <Pressable style={styles.track} onLayout={handleTrackLayout} onPress={handleTrackPress}>
            <View style={[styles.trackBackground, { backgroundColor: theme.border }]} />
            <View
              style={[
                styles.trackFill,
                { backgroundColor: theme.accent, width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </Pressable>
        </View>
        <Pressable onPress={playPause} hitSlop={Spacing.two}>
          <ThemedText type="default" themeColor="primary">
            {status.playing ? "⏸" : "▶"}
          </ThemedText>
        </Pressable>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginHorizontal: Spacing.two,
    padding: Spacing.two,
  },
  artworkPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: Spacing.one,
  },
  body: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    flex: 1,
  },
  track: {
    height: 4,
    justifyContent: "center",
  },
  trackBackground: {
    height: 2,
    borderRadius: 1,
  },
  trackFill: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
  },
});
```

- [ ] **Step 2: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/components/ui/mini-player.tsx
git commit -m "Prompt 8: wire MiniPlayer to real playback state"
```

---

### Task 10: `useEpisodeContributor` hook

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-episode-contributor.ts`

**Interfaces:**

- Produces: `useEpisodeContributor(episodeId: string | null)` returning a TanStack Query result whose `data` is `string | null` (the contributor's display name, or `null` if none) — consumed by Task 13 (Now Playing overlay's "Told by {contributor}" line).

- [ ] **Step 1: Implement the hook**

```ts
// apps/mobile/src/hooks/queries/use-episode-contributor.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

type EpisodeContributorLinkRow = { contributor_id: string };
type PublicContributorRow = { display_name: string };

/**
 * An episode can have several contributors; only the first linked row is
 * shown, matching the prompt pack's single-name "Told by Jajja Nakato of
 * Masaka" example. No linked row (or a row hidden by public_contributors'
 * own visibility rules) resolves to `null` — the caller omits the line
 * entirely rather than rendering it empty.
 */
export function useEpisodeContributor(episodeId: string | null) {
  return useQuery({
    queryKey: ["episode-contributor", episodeId],
    enabled: Boolean(episodeId),
    queryFn: async (): Promise<string | null> => {
      const { data: links, error: linksError } = await supabase
        .from("episode_contributors")
        .select("contributor_id")
        .eq("episode_id", episodeId as string)
        .limit(1)
        .returns<EpisodeContributorLinkRow[]>();
      if (linksError) {
        throw linksError;
      }
      const firstLink = links[0];
      if (!firstLink) {
        return null;
      }

      const { data: contributor, error: contributorError } = await supabase
        .from("public_contributors")
        .select("display_name")
        .eq("id", firstLink.contributor_id)
        .maybeSingle()
        .returns<PublicContributorRow | null>();
      if (contributorError) {
        throw contributorError;
      }
      return contributor?.display_name ?? null;
    },
  });
}
```

- [ ] **Step 2: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/hooks/queries/use-episode-contributor.ts
git commit -m "Prompt 8: add useEpisodeContributor hook"
```

---

### Task 11: Bookmark hooks + `BookmarkSheet`

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-bookmarks.ts`
- Create: `apps/mobile/src/hooks/queries/use-create-bookmark.ts`
- Create: `apps/mobile/src/components/bookmark-sheet.tsx`

**Interfaces:**

- Produces: `useBookmarks()` returning `BookmarkListItem[]` (`{ id, positionSeconds, note, episode: QueueEpisode }`) — consumed by Task 15 (Library Bookmarks section).
- Produces: `useCreateBookmark()` returning `{ createBookmark: (vars: { episodeId: string; positionSeconds: number; note: string | null }) => Promise<void> }` — consumed by Task 13 (Now Playing overlay).
- Produces: `<BookmarkSheet visible onDismiss onSave />` — consumed by Task 13.

- [ ] **Step 1: Implement `useBookmarks`**

```ts
// apps/mobile/src/hooks/queries/use-bookmarks.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import type { QueueEpisode } from "@/stores/player-store";
import type { AccessTier, ContentSource } from "@/types/content";

export type BookmarkListItem = {
  id: string;
  positionSeconds: number;
  note: string | null;
  episode: QueueEpisode;
};

type BookmarkRow = {
  id: string;
  position_seconds: number;
  note: string | null;
  // Null when the linked episode (or its series) is currently hidden
  // from this user by its own RLS policy — mirrors use-series-detail.ts's
  // and use-contributor-detail.ts's nested-embed nullability pattern.
  episodes: {
    id: string;
    title: string;
    episode_number: number;
    duration_seconds: number | null;
    access_tier: AccessTier;
    coin_price: number;
    content_source: ContentSource;
    series_id: string;
    series: { title: string; cover_image_url: string | null } | null;
  } | null;
};

export function useBookmarks() {
  const session = useAuthStore((state) => state.session);

  return useQuery({
    queryKey: ["bookmarks", session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async (): Promise<BookmarkListItem[]> => {
      if (!session) {
        return [];
      }
      const { data, error } = await supabase
        .from("episode_bookmarks")
        .select(
          "id, position_seconds, note, episodes(id, title, episode_number, duration_seconds, access_tier, coin_price, content_source, series_id, series(title, cover_image_url))",
        )
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .returns<BookmarkRow[]>();
      if (error) {
        throw error;
      }
      return data
        .filter(
          (
            row,
          ): row is BookmarkRow & {
            episodes: NonNullable<BookmarkRow["episodes"]> & {
              series: NonNullable<NonNullable<BookmarkRow["episodes"]>["series"]>;
            };
          } => row.episodes !== null && row.episodes.series !== null,
        )
        .map((row) => ({
          id: row.id,
          positionSeconds: row.position_seconds,
          note: row.note,
          episode: {
            id: row.episodes.id,
            title: row.episodes.title,
            episodeNumber: row.episodes.episode_number,
            durationSeconds: row.episodes.duration_seconds,
            accessTier: row.episodes.access_tier,
            coinPrice: row.episodes.coin_price,
            contentSource: row.episodes.content_source,
            resumePositionSeconds: null,
            seriesId: row.episodes.series_id,
            seriesTitle: row.episodes.series.title,
            coverImageUrl: row.episodes.series.cover_image_url,
          },
        }));
    },
  });
}
```

- [ ] **Step 2: Implement `useCreateBookmark`**

```ts
// apps/mobile/src/hooks/queries/use-create-bookmark.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

type CreateBookmarkVariables = { episodeId: string; positionSeconds: number; note: string | null };

export function useCreateBookmark() {
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);

  const mutation = useMutation<void, Error, CreateBookmarkVariables>({
    mutationFn: async ({ episodeId, positionSeconds, note }) => {
      if (!session) {
        // Every call site wraps this in useRequireAuth's requireAuth(...),
        // so this should be unreachable in practice.
        throw new Error("Cannot bookmark an episode without a signed-in session");
      }
      const { error } = await supabase.from("episode_bookmarks").insert({
        user_id: session.user.id,
        episode_id: episodeId,
        position_seconds: Math.floor(positionSeconds),
        note,
      });
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookmarks", session?.user.id ?? null] });
    },
  });

  return { createBookmark: mutation.mutateAsync };
}
```

- [ ] **Step 3: Implement `BookmarkSheet`**

```tsx
// apps/mobile/src/components/bookmark-sheet.tsx
import { useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function BookmarkSheet({
  visible,
  onDismiss,
  onSave,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSave: (note: string | null) => void;
}) {
  const theme = useTheme();
  const [note, setNote] = useState("");

  const handleSave = () => {
    onSave(note.trim().length > 0 ? note.trim() : null);
    setNote("");
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <ThemedView style={styles.sheet}>
          <ThemedText type="subtitle">Bookmark this moment</ThemedText>
          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
            placeholder="Add a note (optional)"
            placeholderTextColor={theme.textSecondary}
            value={note}
            onChangeText={setNote}
            multiline
          />
          <Button label="Save bookmark" onPress={handleSave} />
        </ThemedView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  sheet: {
    padding: Spacing.four,
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    gap: Spacing.three,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    minHeight: 80,
    textAlignVertical: "top",
  },
});
```

- [ ] **Step 4: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/hooks/queries/use-bookmarks.ts apps/mobile/src/hooks/queries/use-create-bookmark.ts apps/mobile/src/components/bookmark-sheet.tsx
git commit -m "Prompt 8: add bookmark hooks and BookmarkSheet"
```

---

### Task 12: Stub Unlock Sheet + playback toast

**Files:**

- Create: `apps/mobile/src/components/unlock-sheet-stub.tsx`
- Create: `apps/mobile/src/components/playback-toast.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: `usePlayerStore`'s `lockedEpisode`, `dismissLockedEpisode`, `toastMessage`, `dismissToast`.
- Produces: `<UnlockSheetStub />` and `<PlaybackToast />` — both mounted once in `(app)/_layout.tsx`. Prompt 9 replaces `UnlockSheetStub`'s internals (real coin balance, real purchase flow) without changing where it's triggered from (`lockedEpisode` state in the store). `PlaybackToast` is the display surface for the "couldn't load the next episode" toast Task 7's `loadTrackAtIndex` sets on a 400/500 `resolveEpisodeSource` result.

- [ ] **Step 1: Implement the stub**

```tsx
// apps/mobile/src/components/unlock-sheet-stub.tsx
import { Modal, Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { usePlayerStore } from "@/stores/player-store";

// A minimal stub so the locked-episode auto-advance flow doesn't
// dead-end. Prompt 9 replaces the disabled button with a real coin
// balance + purchase flow; it does not change where this sheet is
// triggered from (the store's `lockedEpisode` state).
export function UnlockSheetStub() {
  const lockedEpisode = usePlayerStore((state) => state.lockedEpisode);
  const dismissLockedEpisode = usePlayerStore((state) => state.dismissLockedEpisode);

  return (
    <Modal
      visible={lockedEpisode !== null}
      transparent
      animationType="slide"
      onRequestClose={dismissLockedEpisode}
    >
      <Pressable style={styles.backdrop} onPress={dismissLockedEpisode}>
        <ThemedView style={styles.sheet}>
          <ThemedText type="subtitle">{lockedEpisode?.title}</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            {lockedEpisode?.accessTier === "premium"
              ? "Premium episode"
              : `${lockedEpisode?.coinPrice ?? 0} coins`}
          </ThemedText>
          <Pressable style={styles.disabledButton} disabled>
            <ThemedText type="default" themeColor="background">
              Unlock
            </ThemedText>
          </Pressable>
        </ThemedView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  sheet: {
    padding: Spacing.four,
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    gap: Spacing.three,
  },
  disabledButton: {
    backgroundColor: "#1F3B2C",
    opacity: 0.5,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
  },
});
```

- [ ] **Step 2: Implement the playback toast**

```tsx
// apps/mobile/src/components/playback-toast.tsx
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { Spacing } from "@/constants/theme";
import { usePlayerStore } from "@/stores/player-store";

// Displays player-store.ts's `toastMessage` (currently only set by
// loadTrackAtIndex on a 400/500 resolveEpisodeSource result) and
// auto-dismisses it after a few seconds.
export function PlaybackToast() {
  const toastMessage = usePlayerStore((state) => state.toastMessage);
  const dismissToast = usePlayerStore((state) => state.dismissToast);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timeout = setTimeout(dismissToast, 4000);
    return () => clearTimeout(timeout);
  }, [toastMessage, dismissToast]);

  if (!toastMessage) {
    return null;
  }

  return (
    <Card style={[styles.card, { top: insets.top + Spacing.two }]}>
      <ThemedText type="small">{toastMessage}</ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: Spacing.three,
    right: Spacing.three,
  },
});
```

- [ ] **Step 3: Mount both in the app layout**

In `apps/mobile/src/app/(app)/_layout.tsx`, add the imports:

```ts
import { PlaybackToast } from "@/components/playback-toast";
import { UnlockSheetStub } from "@/components/unlock-sheet-stub";
```

And render them alongside the other persistent components:

```tsx
      <MiniPlayer />
      <AudioStatusDriver />
      <UnlockSheetStub />
      <PlaybackToast />
```

- [ ] **Step 4: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/components/unlock-sheet-stub.tsx apps/mobile/src/components/playback-toast.tsx "apps/mobile/src/app/(app)/_layout.tsx"
git commit -m "Prompt 8: add stub Unlock Sheet and playback toast"
```

---

### Task 13: Now Playing overlay screen

**Files:**

- Create: `apps/mobile/src/components/now-playing-overlay.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: `useAudioPlayerStatus` from `expo-audio`; `audioPlayer` from `@/lib/audio-player`; `usePlayerStore`'s `currentEpisode`, `expanded`, `collapse`, `playPause`, `seekBy`, `seekTo`, `next`, `previous`, `setPlaybackRate`, `startSleepTimer`, `sleepTimer`; `SourceBadge` from `@/components/ui/source-badge`; `Chip` from `@/components/ui/chip`; `useEpisodeContributor` from Task 10; `useRequireAuth` from `@/hooks/use-require-auth`; `useCreateBookmark`, `BookmarkSheet` from Task 11; `SignInPromptSheet` from `@/components/sign-in-prompt-sheet`.
- Produces: `<NowPlayingOverlay />` — mounted once in `(app)/_layout.tsx`.

- [ ] **Step 1: Implement the overlay**

```tsx
// apps/mobile/src/components/now-playing-overlay.tsx
import { Image } from "expo-image";
import { useAudioPlayerStatus } from "expo-audio";
import { useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { BookmarkSheet } from "@/components/bookmark-sheet";
import { SignInPromptSheet } from "@/components/sign-in-prompt-sheet";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Chip } from "@/components/ui/chip";
import { SourceBadge } from "@/components/ui/source-badge";
import { Spacing } from "@/constants/theme";
import { useEpisodeContributor } from "@/hooks/queries/use-episode-contributor";
import { useCreateBookmark } from "@/hooks/queries/use-create-bookmark";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useTheme } from "@/hooks/use-theme";
import { audioPlayer } from "@/lib/audio-player";
import { formatDuration } from "@/lib/format-duration";
import { usePlayerStore } from "@/stores/player-store";

const PLAYBACK_RATES = [0.8, 1, 1.25, 1.5, 2] as const;
const SLEEP_OPTIONS = [10, 20, 30, 45, "end-of-episode", "off"] as const;

export function NowPlayingOverlay() {
  const theme = useTheme();
  const router = useRouter();
  const expanded = usePlayerStore((state) => state.expanded);
  const collapse = usePlayerStore((state) => state.collapse);
  const currentEpisode = usePlayerStore((state) => state.currentEpisode);
  const playPause = usePlayerStore((state) => state.playPause);
  const seekBy = usePlayerStore((state) => state.seekBy);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const setPlaybackRate = usePlayerStore((state) => state.setPlaybackRate);
  const startSleepTimer = usePlayerStore((state) => state.startSleepTimer);
  const cancelSleepTimer = usePlayerStore((state) => state.cancelSleepTimer);
  const sleepTimer = usePlayerStore((state) => state.sleepTimer);

  const status = useAudioPlayerStatus(audioPlayer);
  const { requireAuth, promptVisible, dismissPrompt } = useRequireAuth();
  const { createBookmark } = useCreateBookmark();
  const contributorQuery = useEpisodeContributor(currentEpisode?.id ?? null);

  const [bookmarkSheetVisible, setBookmarkSheetVisible] = useState(false);
  const [sleepPickerVisible, setSleepPickerVisible] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const trackWidthRef = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_event, gesture) => {
        if (trackWidthRef.current <= 0) {
          return;
        }
        const fraction = Math.min(1, Math.max(0, gesture.moveX / trackWidthRef.current));
        setDragFraction(fraction);
      },
      onPanResponderRelease: (_event, gesture) => {
        if (trackWidthRef.current > 0 && status.duration > 0) {
          const fraction = Math.min(1, Math.max(0, gesture.moveX / trackWidthRef.current));
          seekTo(fraction * status.duration);
        }
        setDragFraction(null);
      },
    }),
  ).current;

  if (!currentEpisode) {
    return null;
  }

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    trackWidthRef.current = event.nativeEvent.layout.width;
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const progress = dragFraction ?? (status.duration > 0 ? status.currentTime / status.duration : 0);
  const displaySeconds =
    dragFraction !== null ? dragFraction * status.duration : status.currentTime;

  const handleBookmarkPress = () => {
    requireAuth(() => setBookmarkSheetVisible(true));
  };

  const handleBookmarkSave = (note: string | null) => {
    setBookmarkSheetVisible(false);
    void createBookmark({
      episodeId: currentEpisode.id,
      positionSeconds: status.currentTime,
      note,
    }).catch(() => {});
  };

  return (
    <Modal visible={expanded} animationType="slide" onRequestClose={collapse}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <Pressable onPress={collapse} style={styles.collapseButton}>
          <ThemedText type="default">▼</ThemedText>
        </Pressable>
        <ScrollView contentContainerStyle={styles.content}>
          {currentEpisode.coverImageUrl ? (
            <Image
              source={{ uri: currentEpisode.coverImageUrl }}
              style={styles.artwork}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.artwork, { backgroundColor: theme.accentSoft }]} />
          )}

          <ThemedText type="small" themeColor="textSecondary">
            {currentEpisode.seriesTitle}
          </ThemedText>
          <ThemedText type="title">{currentEpisode.title}</ThemedText>
          <SourceBadge source={currentEpisode.contentSource} />
          {contributorQuery.data ? (
            <ThemedText type="small" themeColor="textSecondary">
              Told by {contributorQuery.data}
            </ThemedText>
          ) : null}

          <View style={styles.scrubberSection} {...panResponder.panHandlers}>
            <View style={styles.track} onLayout={handleTrackLayout}>
              <View style={[styles.trackBackground, { backgroundColor: theme.border }]} />
              <View
                style={[
                  styles.trackFill,
                  { backgroundColor: theme.accent, width: `${Math.round(progress * 100)}%` },
                ]}
              />
            </View>
            <View style={styles.timeRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDuration(Math.floor(displaySeconds))}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDuration(status.duration > 0 ? Math.floor(status.duration) : null)}
              </ThemedText>
            </View>
          </View>

          <View style={styles.controlsRow}>
            <Pressable onPress={() => void previous()}>
              <ThemedText type="title" style={styles.controlIcon}>
                ⏮
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => seekBy(-15)}>
              <ThemedText type="subtitle" style={styles.controlIcon}>
                ⏪15
              </ThemedText>
            </Pressable>
            <Pressable onPress={playPause}>
              <ThemedText type="title" style={styles.controlIcon}>
                {status.playing ? "⏸" : "▶"}
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => seekBy(15)}>
              <ThemedText type="subtitle" style={styles.controlIcon}>
                15⏩
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => void next()}>
              <ThemedText type="title" style={styles.controlIcon}>
                ⏭
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.chipRow}>
            {PLAYBACK_RATES.map((rate) => (
              <Chip
                key={rate}
                label={`${rate}×`}
                selected={status.playbackRate === rate}
                onPress={() => setPlaybackRate(rate)}
              />
            ))}
          </View>

          <View style={styles.actionsRow}>
            <Pressable onPress={handleBookmarkPress}>
              <ThemedText type="default" themeColor="accent">
                🔖 Bookmark
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => setSleepPickerVisible((visible) => !visible)}>
              <ThemedText type="default" themeColor="accent">
                ⏰{" "}
                {sleepTimer.mode === "timer"
                  ? `${sleepTimer.minutes}m`
                  : sleepTimer.mode === "end-of-episode"
                    ? "End of episode"
                    : "Sleep timer"}
              </ThemedText>
            </Pressable>
          </View>

          {sleepPickerVisible ? (
            <ThemedView style={styles.sleepPicker}>
              {SLEEP_OPTIONS.map((option) => (
                <Chip
                  key={option}
                  label={
                    option === "off"
                      ? "Off"
                      : option === "end-of-episode"
                        ? "End of episode"
                        : `${option} min`
                  }
                  selected={
                    option === "off"
                      ? sleepTimer.mode === "off"
                      : option === "end-of-episode"
                        ? sleepTimer.mode === "end-of-episode"
                        : sleepTimer.mode === "timer" && sleepTimer.minutes === option
                  }
                  onPress={() => {
                    if (option === "off") {
                      cancelSleepTimer();
                    } else {
                      startSleepTimer(option);
                    }
                    setSleepPickerVisible(false);
                  }}
                />
              ))}
            </ThemedView>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <BookmarkSheet
        visible={bookmarkSheetVisible}
        onDismiss={() => setBookmarkSheetVisible(false)}
        onSave={handleBookmarkSave}
      />
      <SignInPromptSheet
        visible={promptVisible}
        onDismiss={dismissPrompt}
        onSignIn={() => {
          dismissPrompt();
          router.push("/sign-in");
        }}
        onSignUp={() => {
          dismissPrompt();
          router.push("/sign-up");
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  collapseButton: {
    alignItems: "center",
    paddingVertical: Spacing.two,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    alignItems: "center",
  },
  artwork: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: Spacing.three,
  },
  scrubberSection: {
    width: "100%",
    gap: Spacing.one,
  },
  track: {
    height: 8,
    justifyContent: "center",
  },
  trackBackground: {
    height: 4,
    borderRadius: 2,
  },
  trackFill: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: Spacing.two,
  },
  controlIcon: {
    textAlign: "center",
  },
  chipRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
  sleepPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
});
```

- [ ] **Step 2: Mount it in the app layout**

In `apps/mobile/src/app/(app)/_layout.tsx`, add the import:

```ts
import { NowPlayingOverlay } from "@/components/now-playing-overlay";
```

And render it alongside the other persistent components:

```tsx
      <MiniPlayer />
      <AudioStatusDriver />
      <UnlockSheetStub />
      <PlaybackToast />
      <NowPlayingOverlay />
```

- [ ] **Step 3: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/components/now-playing-overlay.tsx "apps/mobile/src/app/(app)/_layout.tsx"
git commit -m "Prompt 8: add Now Playing overlay screen"
```

---

### Task 14: Wire the series detail screen to the new queue-based player

**Files:**

- Modify: `apps/mobile/src/app/(app)/series/[id].tsx`

**Interfaces:**

- Consumes: `usePlayerStore`'s `playQueue`; `QueueEpisode` type from `@/stores/player-store`.

- [ ] **Step 1: Update the play call sites**

Replace the `usePlayerStore` import and the `play` selector:

```ts
import { usePlayerStore, type QueueEpisode } from "@/stores/player-store";
```

```ts
const playQueue = usePlayerStore((state) => state.playQueue);
```

Replace `playAll` with a queue-building version:

```ts
const buildQueue = (): QueueEpisode[] =>
  series.episodes.map((episode) => ({
    ...episode,
    seriesId: series.id,
    seriesTitle: series.title,
    coverImageUrl: series.coverImageUrl,
  }));

const playAll = () => {
  const target = resumable ?? firstFreeEpisode ?? series.episodes[0];
  if (!target) {
    return;
  }
  const startIndex = series.episodes.findIndex((episode) => episode.id === target.id);
  playQueue(buildQueue(), startIndex).catch(() => {});
};
```

Replace the per-row `onPress`:

```tsx
              onPress={
                episode.accessTier === "free"
                  ? () => {
                      const startIndex = series.episodes.findIndex((item) => item.id === episode.id);
                      playQueue(buildQueue(), startIndex).catch(() => {});
                    }
                  : undefined
              }
```

- [ ] **Step 2: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add "apps/mobile/src/app/(app)/series/[id].tsx"
git commit -m "Prompt 8: wire series detail screen to the queue-based player"
```

---

### Task 15: Library tab Bookmarks section

**Files:**

- Modify: `apps/mobile/src/app/(app)/(tabs)/library.tsx`

**Interfaces:**

- Consumes: `useBookmarks` from Task 11; `usePlayerStore`'s `playQueue`, `expand`.

- [ ] **Step 1: Implement the section**

```tsx
// apps/mobile/src/app/(app)/(tabs)/library.tsx
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { useBookmarks } from "@/hooks/queries/use-bookmarks";
import { formatDuration } from "@/lib/format-duration";
import { usePlayerStore } from "@/stores/player-store";

export default function LibraryScreen() {
  const bookmarksQuery = useBookmarks();
  const playQueue = usePlayerStore((state) => state.playQueue);
  const expand = usePlayerStore((state) => state.expand);
  const bookmarks = bookmarksQuery.data ?? [];

  const openBookmark = (bookmark: NonNullable<typeof bookmarksQuery.data>[number]) => {
    playQueue([bookmark.episode], 0, bookmark.positionSeconds)
      .then(expand)
      .catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader title="Library" />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="default" themeColor="textSecondary">
          Your favorites, downloads, and listening history will show up here.
        </ThemedText>

        <SectionHeader title="Bookmarks" />
        {bookmarks.length === 0 ? (
          <EmptyState
            title="No bookmarks yet"
            body="Bookmark a moment while listening to an episode and it'll show up here."
          />
        ) : (
          bookmarks.map((bookmark) => (
            <Pressable key={bookmark.id} style={styles.row} onPress={() => openBookmark(bookmark)}>
              <ThemedText type="default">{bookmark.episode.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {bookmark.episode.seriesTitle} · {formatDuration(bookmark.positionSeconds)}
              </ThemedText>
              {bookmark.note ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {bookmark.note}
                </ThemedText>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  row: {
    gap: Spacing.half,
    paddingVertical: Spacing.two,
  },
});
```

- [ ] **Step 2: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add "apps/mobile/src/app/(app)/(tabs)/library.tsx"
git commit -m "Prompt 8: add Bookmarks section to Library tab"
```

---

### Task 16: Whole-repo verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck, lint, and test run**

```bash
pnpm typecheck
pnpm lint
cd apps/mobile && npx jest
```

Expected: all green — every workspace package typechecks and lints clean, and every test file (including this feature's `resolve-episode-source.test.ts`, `local-listening-progress.test.ts`, `sleep-timer.test.ts`, plus every pre-existing test) passes.

- [ ] **Step 2: Confirm no stray references to the old API remain**

```bash
grep -rn "AudioPlaylist\|react-native-track-player\|expo-file-system/legacy\|FileSystem.documentDirectory" apps/mobile/src apps/mobile/package.json apps/mobile/app.json
```

Expected: no matches.

- [ ] **Step 3: Final commit if anything was fixed during verification**

Only if Step 1 or Step 2 required a fix:

```bash
git add -A
git commit -m "Prompt 8: verification fixes"
```
