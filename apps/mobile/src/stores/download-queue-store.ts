import NetInfo from "@react-native-community/netinfo";
import { create } from "zustand";

import {
  cleanupOrphanedDownloads,
  deleteEpisodeFile,
  downloadEpisodeFile,
} from "@/lib/download-file";
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

  // Shared by both resume triggers below (a connectivity change back to
  // wifi, or the wifi-only setting being turned off) — moves every
  // paused_wifi entry back to queued and kicks the queue. Each caller is
  // responsible for having already confirmed resuming is appropriate
  // (the wifi gate passing, or the setting no longer requiring it).
  function resumePausedDownloads(): void {
    const entries = get().entries;
    const paused = Object.entries(entries).filter(([, e]) => e.status === "paused_wifi");
    if (paused.length === 0) {
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
  }

  NetInfo.addEventListener((state) => {
    const wifiOnly = useSettingsStore.getState().wifiOnlyDownloads;
    if (shouldPauseForWifi(state, wifiOnly)) {
      return;
    }
    resumePausedDownloads();
  });

  // Turning "Wi-Fi only" off should resume any paused_wifi downloads
  // immediately, not wait for the next NetInfo event (which may never
  // come if connectivity itself hasn't changed). Only fire on the
  // true -> false transition of this one field, not every settings
  // change (shouldPauseForWifi always returns false once the setting is
  // off, regardless of current connectivity, so no netState is needed).
  useSettingsStore.subscribe((state, prevState) => {
    if (prevState.wifiOnlyDownloads && !state.wifiOnlyDownloads) {
      resumePausedDownloads();
    }
  });

  // Foreground-only downloads mean any ".tmp" file on disk at store-init
  // time is necessarily a leftover from a session killed mid-download
  // (see download-file.ts) — safe to sweep before seeding the in-memory
  // entries from the manifest below.
  cleanupOrphanedDownloads();

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
