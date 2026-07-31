import NetInfo from "@react-native-community/netinfo";

import { resolveRemoteEpisodeSource } from "@/lib/resolve-episode-source";
import { cancelEpisodeDownload, downloadEpisodeFile } from "@/lib/download-file";
import { getAllDownloads, getDownload, insertDownload, deleteDownload } from "@/lib/downloads-db";
import { useSettingsStore } from "@/stores/settings-store";
import { usePlayerStore, type QueueEpisode } from "@/stores/player-store";

import { useDownloadQueueStore } from "./download-queue-store";

// player-store.ts (imported below, unmocked, for its real toastMessage
// state) transitively imports audio-player.ts, which calls
// expo-audio's createAudioPlayer() at module-evaluation time. jest-expo's
// built-in native-module mocks don't cover the new expo-audio
// AudioPlayer class, so without this the whole test file fails to load
// with "Cannot read properties of undefined (reading 'prototype')" —
// nothing here changes player-store's behavior, since none of this
// suite's tests ever call its playback actions.
jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => ({})),
}));
// Same reasoning as the expo-audio mock above: player-store.ts's other
// transitive dependency, local-listening-progress.ts, imports the real
// "@/lib/supabase" client, which throws at module-eval time unless
// EXPO_PUBLIC_SUPABASE_URL/ANON_KEY env vars are set. None of this
// suite's tests exercise supabase-backed code paths (no auth session is
// ever set), so an inert stub is sufficient — mirrors the same pattern
// already used in auth-store.test.ts.
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: {}, from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: jest.fn(), addEventListener: jest.fn(() => () => {}) },
}));
jest.mock("@/lib/resolve-episode-source", () => ({ resolveRemoteEpisodeSource: jest.fn() }));
jest.mock("@/lib/download-file", () => ({
  downloadEpisodeFile: jest.fn(),
  deleteEpisodeFile: jest.fn(),
  cleanupOrphanedDownloads: jest.fn(),
  cancelEpisodeDownload: jest.fn(),
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
const mockCancelEpisodeDownload = cancelEpisodeDownload as jest.Mock;
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
  mockCancelEpisodeDownload.mockReset();
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

  it("cancel aborts an in-flight download, and its rejection never persists a row", async () => {
    mockResolveRemote.mockResolvedValue({ type: "remote", url: "https://example.com/ep-1.m4a" });
    let rejectDownload!: (error: Error) => void;
    mockDownloadFile.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectDownload = reject;
      }),
    );

    await useDownloadQueueStore.getState().enqueue(episode);
    await flush();
    expect(useDownloadQueueStore.getState().entries["ep-1"]?.status).toBe("downloading");

    useDownloadQueueStore.getState().cancel("ep-1");

    // cancel() removes the entry and aborts the in-flight task immediately —
    // it does not wait for downloadEpisodeFile's promise to settle.
    expect(mockCancelEpisodeDownload).toHaveBeenCalledWith("ep-1");
    expect(useDownloadQueueStore.getState().entries["ep-1"]).toBeUndefined();

    // DownloadTask.cancel() rejects the pending downloadAsync() promise
    // (per expo-file-system's own documented contract) — simulate that
    // rejection arriving after cancel() already ran.
    rejectDownload(new Error("cancelled"));
    await flush();

    expect(insertDownload).not.toHaveBeenCalled();
    expect(useDownloadQueueStore.getState().entries["ep-1"]).toBeUndefined();
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

  it("resumes paused_wifi entries as soon as the wifi-only setting is turned off", async () => {
    useSettingsStore.setState({ wifiOnlyDownloads: true });
    mockFetch.mockResolvedValue({ type: "cellular" });
    mockResolveRemote.mockResolvedValue({ type: "remote", url: "https://example.com/ep-1.m4a" });
    mockDownloadFile.mockResolvedValue({ localPath: "/docs/downloads/ep-1.m4a", fileSize: 500 });

    await useDownloadQueueStore.getState().enqueue(episode);
    await flush();
    expect(useDownloadQueueStore.getState().entries["ep-1"]?.status).toBe("paused_wifi");
    expect(mockDownloadFile).not.toHaveBeenCalled();

    // Turning the setting off directly (via setState, not the real
    // setWifiOnlyDownloads action) — same convention the rest of this
    // suite uses to avoid touching the real settings.json file write.
    // No NetInfo event fires here at all; only the settings store changes.
    useSettingsStore.setState({ wifiOnlyDownloads: false });
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
