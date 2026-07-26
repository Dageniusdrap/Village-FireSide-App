# Audio Player (Prompt 8) — Design Spec

## Scope

Full audio playback for the mobile app, per `docs/PROMPT_PACK.md`'s
Prompt 8:

- Playback: play, pause, seek, skip ±15s, next/previous episode in a
  series, playback speed (0.8×–2×)
- Background playback + lock-screen/notification controls
- Audio URLs from the `get-episode-audio` edge function (Prompt 4),
  resolved just-in-time, never eagerly for a whole series
- Full-screen Now Playing overlay: artwork, series/episode title,
  `SourceBadge`, "Told by {contributor}", scrubber, ±15s/next/prev
  controls, speed selector, bookmark button, sleep-timer entry point
- `listening_progress` sync (signed-in users only), local-first
  persistence surviving an app kill, `max(local, server)` resume
- Auto-play next episode in a series; a locked next episode stops
  auto-advance and shows a stub Unlock Sheet
- `MiniPlayer` fully wired (real play/pause, real progress)
- Interruption handling (phone calls), background audio focus
- Sleep timer: 10/20/30/45 min and "end of episode"
- Bookmarks: `episode_bookmarks` table + a Bookmarks section in the
  Library tab
- A hook point for Prompt 10's offline downloads to plug into, without
  Prompt 8 building the download mechanism itself

**Non-goals (explicitly out of scope for this prompt):**

- The real Unlock Sheet (coin balance, purchase flow) — Prompt 9's job.
  Prompt 8 builds a minimal stub sheet (episode title + price + a
  disabled "Unlock" button) so the locked-episode flow doesn't dead-end;
  Prompt 9 replaces the stub's internals without changing where it's
  triggered from.
- Actually downloading/caching audio files for offline playback —
  Prompt 10's job. Prompt 8 builds the seam (see "Audio source
  resolution" below) that Prompt 10 plugs a real implementation into.
- Android Auto / CarPlay, casting (Google Cast/AirPlay) — not requested
  by the prompt pack, not attempted.
- Any change to the Explore/Learn/Library tabs beyond adding a Bookmarks
  section to Library — those tabs' own real-data wiring is Prompts 11/12.

## Dependency change: expo-audio, not react-native-track-player

See `docs/architecture.md`'s new "Mobile audio: expo-audio, not
react-native-track-player" section for the full reasoning (short
version: RN 0.86 mandates the New Architecture with no opt-out;
`react-native-track-player` only supports it from v5, which has no
stable release; `expo-audio`, Expo's first-party module, does not have
this problem and already covers this prompt's requirements).

`package.json` changes: remove `react-native-track-player`, add
`expo-audio` (via `npx expo install expo-audio`, so the SDK-57-compatible
version is picked automatically). `app.json` gains the `expo-audio`
config plugin:

```json
[
  "expo-audio",
  {
    "enableBackgroundPlayback": true,
    "enableBackgroundRecording": false
  }
]
```

A Dev Client build is required from this prompt onward — Expo Go cannot
run a project with a native config plugin change, regardless of which
audio library is involved. This is unrelated to the SDK-version fix
already applied to the project; it's a separate, permanent consequence
of adding any native audio module.

## State architecture

**Correction (2026-07-26, before implementation started):** this
section originally specified `expo-audio`'s `AudioPlaylist` as the
playback engine. Pulling the actual versioned SDK 57 API reference
(per `apps/mobile/AGENTS.md`'s "Expo has changed" rule) before writing
any code found that `AudioPlaylist` has **no lock-screen/Now-Playing
metadata support at all** — `setActiveForLockScreen()` is documented
only on the single-track `AudioPlayer` class, and there is no way to
retrieve an underlying `AudioPlayer` from an `AudioPlaylist`. Since
lock-screen controls are an explicit, non-negotiable requirement of
this prompt, building on `AudioPlaylist` would have shipped a feature
that silently can't meet its own spec. The corrected design below uses
a single `AudioPlayer` with a manually-managed queue instead.
`docs/architecture.md`'s "Mobile audio" section's mention of
`AudioPlaylist` predates this correction and refers only to why
`expo-audio` as a _package_ was chosen over
`react-native-track-player` — not to which of its two playback
primitives this feature ends up using.

A single `AudioPlayer` instance (`Audio.createAudioPlayer()` — a
non-auto-releasing player, appropriate for a module-scoped singleton;
this is distinct from the auto-releasing player the `useAudioPlayer()`
hook returns) is the source of truth for the _currently loaded track's_
playback state (position, playing/paused, rate). Everything about the
_queue_ — which episodes, in what order, which index is current — is
state `expo-audio` has no concept of, so it lives in the Zustand store
alongside the UI-only state:
`apps/mobile/src/stores/player-store.ts` is rewritten from its current
stub (which owns `currentEpisode`/`isPlaying` itself) into a store that
owns the queue and every playback action, calling into the singleton
`AudioPlayer` internally — mirroring `auth-store.ts`'s existing pattern
of a store owning side-effecting actions (`signOut()` calling
`supabase.auth.signOut()`), rather than introducing a second
"stores own side effects vs. don't" convention:

```ts
type QueueEpisode = SeriesDetailEpisode & {
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
  currentEpisode: QueueEpisode | null; // queue[currentIndex], kept denormalized for cheap selector reads
  expanded: boolean; // Now Playing overlay visibility
  sleepTimer: SleepTimerState;
  lockedEpisode: QueueEpisode | null; // drives the stub Unlock Sheet
  toastMessage: string | null; // "couldn't load the next episode" etc.

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
```

`MiniPlayer` and the Now Playing overlay both read live playback state
via `useAudioPlayerStatus(audioPlayer)` directly (real-time `playing`,
`currentTime`, `duration`) — not through the store. This keeps "what's
actually playing" from drifting out of sync with lock-screen-triggered
changes, which is the standard failure mode of mirroring native player
state into a separate app-owned store instead of subscribing to it.
Queue/episode metadata (title, artwork, which index) has no native
equivalent to subscribe to, so components read that from the store as
normal reactive Zustand state.

The `AudioPlayer` instance itself lives in a singleton module
(`apps/mobile/src/lib/audio-player.ts`, mirroring `query-client.ts`'s
existing singleton pattern), not inside a component — playback must
survive screen navigation and app backgrounding, so it can't be
component-scoped state. The module is intentionally minimal — it only
constructs and exports the player; all queue logic lives in the store
so there is exactly one place that owns "what plays next."

Because no native event fires when a track finishes or a periodic tick
elapses, one always-mounted, render-nothing component
(`apps/mobile/src/components/audio-status-driver.tsx`, mounted
alongside `<MiniPlayer />` in `(app)/_layout.tsx`) subscribes to
`useAudioPlayerStatus(audioPlayer)` and is the sole place driving:
the 15-second position-save tick, saving on a playing→paused
transition, saving on `AppState` leaving `"active"`, and calling the
store's `next()` (or pausing, for the "end of episode" sleep option)
when `status.didJustFinish` edges from `false` to `true`.

## Audio source resolution (the Prompt 10 hook point)

A single function is the seam every playback path goes through — the
current episode, the next episode on auto-advance, and (later) Prompt
10's offline files all resolve through here, so none of the
queue-building logic downstream needs to change when Prompt 10 lands:

```ts
// apps/mobile/src/lib/resolve-episode-source.ts
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
  return resolveRemoteEpisodeSource(episodeId); // calls get-episode-audio
}
```

```ts
// apps/mobile/src/lib/local-downloads.ts
// Prompt 10 replaces this function's body with a real lookup against
// downloaded files (expo-file-system). Prompt 8 stubs it so the seam
// exists without building the download mechanism itself.
export async function getLocalDownloadPath(_episodeId: string): Promise<string | null> {
  return null;
}
```

`resolveRemoteEpisodeSource` calls `get-episode-audio` and maps its
5-response contract:

| Response | `EpisodeSourceResult`     | Queue-building behavior                                                                   |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| 200      | `{ type: "remote", url }` | Load into the player (`audioPlayer.replace(...)`), play                                   |
| 403      | `{ type: "locked" }`      | Stop auto-advance; `showLockedEpisode(episode)` opens the stub Unlock Sheet               |
| 404      | `{ type: "not_found" }`   | Skip silently — call `resolveEpisodeSource` on the episode after it                       |
| 400/500  | `{ type: "error" }`       | Surface a dismissable "couldn't load the next episode" toast; current track keeps playing |

Playing an episode (tapping "Play All"/"Resume"/a free row) and
auto-advancing to the next episode both call `resolveEpisodeSource` —
there is exactly one code path for "get this episode's audio," whether
the source turns out to be a local file, a signed URL, a lock, a miss,
or an error.

## Position persistence

`useAudioPlayerStatus(audioPlayer)` drives both the Now Playing scrubber
and a 15-second save tick, implemented in the `AudioStatusDriver`
component described above (`useEffect` + `setInterval`, reading the
latest status off a ref rather than depending on `status.currentTime`
directly, so the interval isn't torn down and rebuilt on every ~500ms
status update — matching this prompt's own "every 15 seconds"
requirement; `expo-audio` has no built-in interval-based progress-save
hook the way this needs).

Every tick, pause, and app background/kill writes to a local JSON file
via `expo-file-system`'s SDK-57 class-based API (`File`/`Paths` —
**not** the deprecated `expo-file-system/legacy` string-URI API the
first draft of this spec assumed) **immediately and unconditionally**
— guest or signed-in:

```ts
// apps/mobile/src/lib/local-listening-progress.ts
import { File, Paths } from "expo-file-system";

type LocalProgress = { positionSeconds: number; updatedAt: string };

const progressFile = new File(Paths.document, "listening-progress.json");

export function writeLocalProgress(episodeId: string, positionSeconds: number): void;
export function readLocalProgress(episodeId: string): LocalProgress | null;
// resolveResumePosition is a pure function (unit-testable, no file I/O)
// used by both playQueue() and the Library bookmark tap-to-open flow.
export function resolveResumePosition(
  local: LocalProgress | null,
  server: { positionSeconds: number; updatedAt: string } | null,
): number;
```

Backed by one file (`new File(Paths.document, "listening-progress.json")`,
content `{ [episodeId]: LocalProgress }`), read via `progressFile.exists`

- `progressFile.textSync()` (empty object if the file doesn't exist
  yet) and written via `progressFile.create()` (only if `!exists`) +
  `progressFile.write(JSON.stringify(data))` — both synchronous in the
  new API, so no `async`/`await` needed for the local half of a save.
  Only signed-in users additionally upsert to `listening_progress`
  (`.upsert({ user_id, episode_id, position_seconds, completed }, { onConflict: "user_id,episode_id" })`
  — a real composite-PK upsert, unlike `favorites`' partial-index
  workaround from Prompt 7, since `listening_progress`'s primary key is
  the plain `(user_id, episode_id)` pair).

On opening an episode, resume position = whichever of local/server is
newer by `updated_at` — a stale server row (e.g. progress made on
another device, then this device played further before losing
connectivity) never regresses a fresher local one, and vice versa.
`completed = true` at ≥95% of duration.

## Interruption handling — no auto-resume assumption

`setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: "doNotMix" })`
is set once at app startup. `doNotMix` requests exclusive audio focus:
other apps' audio pauses while an episode plays, and this is required
for lock-screen media controls to function at all.

**What `doNotMix` does not reliably do: resume playback automatically
once the interruption ends** (e.g. when a phone call is hung up). This
was verified, not assumed — `expo-audio`'s docs describe interruption
handling only in terms of the exclusive-focus request while active, not
the end-of-interruption recovery path, and a currently-open upstream
issue on a closely related interruption-recovery code path
(`expo/expo#42709`) plus a historical, same-class bug in `expo-av`
(`expo/expo#31964`, missing `AVAudioSessionInterruptionType.Ended`
handling with the `shouldResume` hint) both point at this being fragile
rather than guaranteed.

The design does not depend on auto-resume working. `useAudioPlayerStatus`
is the only source of truth for `playing`/`paused`, and the UI (MiniPlayer,
Now Playing, lock screen) always reflects whatever that status actually
is. If the interruption ends and playback silently resumes on its own,
the UI simply reflects "playing" a moment later — correct. If it doesn't
resume, the UI already shows "paused" with a working play button — also
correct, no separate interruption-specific state or recovery logic
needed. This is a deliberately defensive design choice given the
uncertainty, not a claim that auto-resume works.

## Now Playing screen + MiniPlayer

Continues the existing `expanded`/`collapse` store pattern from Prompt 6
— no new Expo Router modal group. Tapping `MiniPlayer` sets
`expanded: true`; a full-screen overlay renders:

- Artwork (episode/series cover image, falling back to a placeholder)
- Series title, episode title
- `SourceBadge` (existing component)
- "Told by {contributor}" — a new lightweight query,
  `useEpisodeContributor(episodeId)`, joining `episode_contributors` →
  `public_contributors` and taking the first result (an episode can
  have several contributors; only the first is shown, matching the
  prompt pack's single-name example). No contributor row → the line is
  omitted, not shown empty.
- Scrubber bound to `useAudioPlayerStatus(audioPlayer)`'s
  `currentTime`/`duration`, calling the store's `seekTo(seconds)` on
  drag-end (which calls `audioPlayer.seekTo(seconds)`)
- ±15s (store's `seekBy(±15)`), next/previous (store's `next()`/
  `previous()`), play/pause (store's `playPause()`)
- Speed selector: 0.8×/1×/1.25×/1.5×/2× via the store's
  `setPlaybackRate(rate)` (sets `audioPlayer.playbackRate`)
- Bookmark button, gated behind `useRequireAuth`'s `requireAuth(...)`
  (same pattern as Prompt 7's favoriting) — captures
  `{ episodeId, positionSeconds: status.currentTime }` plus an optional
  note, via a small `BookmarkSheet` modal (mirrors
  `SignInPromptSheet`'s structure) with an optional-note text input
- Sleep-timer entry point (opens a small picker: 10/20/30/45 min, "end
  of episode", "off")

`MiniPlayer` itself becomes fully wired: real `playing` state from
`useAudioPlayerStatus(audioPlayer)`, a real tappable progress bar,
instead of the current visual-only stub.

## Sleep timer

A standalone module (no `expo-audio` built-in equivalent exists):

```ts
// apps/mobile/src/lib/sleep-timer.ts
export type SleepTimerOption = 10 | 20 | 30 | 45 | "end-of-episode";

export function startSleepTimer(option: SleepTimerOption, onFire: () => void): () => void; // returns a cancel function
```

A numeric option sets a single `setTimeout` calling `onFire` (which the
store wires to `audioPlayer.pause()`). `"end-of-episode"` is not a timer
at all — it's a one-shot `sleepTimer.mode === "end-of-episode"` check
inside `AudioStatusDriver`'s `didJustFinish`-edge handler (see "State
architecture" above), pausing instead of calling the store's `next()`
when the current track ends. Because `expo-audio`'s background playback
keeps the app process alive while audio is actively playing, a plain
`setTimeout` fires reliably whether the screen is on or off.

## Bookmarks

New migration, mirroring `listening_progress`'s owner-only RLS pattern:

```sql
create table episode_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  episode_id uuid not null references episodes(id) on delete cascade,
  position_seconds int not null,
  note text,
  created_at timestamptz not null default now()
);

alter table episode_bookmarks enable row level security;

create policy episode_bookmarks_owner_all on episode_bookmarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

No unique constraint — a user can bookmark multiple moments in the same
episode. `docs/schema.md` gets a new `episode_bookmarks` section;
`docs/rls-policies.md` gets the corresponding entry.

The Library tab's current static placeholder gets a real Bookmarks
section (list of `{ episode title, series title, mm:ss, note }`, tap to
open the episode at that position) — just that section. Library's other
future sections (Downloads from Prompt 10, an Owned/Unlocked list from
Prompt 9) are out of scope here.

## Testing approach

Same convention as every prior prompt: `pnpm typecheck`/`pnpm lint`/`pnpm test`
are the verification bar. Real unit tests cover the pure logic:
`resolveEpisodeSource`'s branch mapping (200/403/404/400/500 →
`EpisodeSourceResult`), the local/server position-reconciliation
`max(local, server)` comparison, and `sleep-timer.ts`'s scheduling
(using Jest fake timers). Actual native audio playback, lock-screen
controls, background behavior, and interruption recovery are manual/
device verification, out of this environment's scope — same as every
prior prompt, and explicitly true of the interruption-handling design
above, which cannot be verified without a real device and a real phone
call.
