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
    // Bounds already checked above, so `queue[index]` is guaranteed to
    // exist; noUncheckedIndexedAccess just can't see that.
    const episode = queue[index]!;
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
