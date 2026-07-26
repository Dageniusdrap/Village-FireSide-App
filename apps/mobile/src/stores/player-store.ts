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
  let loadGeneration = 0;

  async function loadTrackAtIndex(
    index: number,
    startPositionOverrideSeconds?: number,
  ): Promise<void> {
    const { queue } = get();
    if (index < 0 || index >= queue.length) {
      // Queue exhausted — nothing left to play. Clear the lock-screen
      // controls too, not just pause, so the OS lock screen doesn't keep
      // showing a paused episode with no way to progress. Also reset
      // currentIndex/currentEpisode to -1/null so a stale index/episode
      // pair is never left around for a subsequent playQueue() call's new
      // `queue` array to be misread against.
      audioPlayer.pause();
      audioPlayer.clearLockScreenControls();
      set({ currentIndex: -1, currentEpisode: null });
      return;
    }
    // Only capture the generation token once we know this call will
    // actually attempt a load — an out-of-range call (e.g. next() at the
    // end of the queue) shouldn't invalidate a different, legitimately
    // in-flight load.
    const generation = ++loadGeneration;
    const episode = queue[index]!;

    try {
      const result = await resolveEpisodeSource(episode.id);
      if (generation !== loadGeneration) {
        return; // a newer load call superseded this one while we awaited
      }

      if (result.type === "locked") {
        set({ lockedEpisode: episode, currentIndex: -1, currentEpisode: null });
        audioPlayer.pause();
        audioPlayer.clearLockScreenControls();
        return;
      }
      if (result.type === "not_found") {
        await loadTrackAtIndex(index + 1);
        return;
      }
      if (result.type === "error") {
        // Current track keeps playing per the spec's queue-building
        // behavior table. `queue` was already committed by playQueue
        // before this function ran, so currentIndex/currentEpisode must be
        // reset here too — otherwise they'd keep pointing at whatever was
        // playing from a *previous* queue, desynced from the new `queue`
        // array.
        set({
          toastMessage: "Couldn't load this episode.",
          currentIndex: -1,
          currentEpisode: null,
        });
        return;
      }

      const source =
        result.type === "local" ? { uri: `file://${result.path}` } : { uri: result.url };
      audioPlayer.replace(source);
      audioPlayer.setActiveForLockScreen(true, {
        title: episode.title,
        artist: episode.seriesTitle,
        artworkUrl: episode.coverImageUrl ?? undefined,
      });

      const session = useAuthStore.getState().session;
      const localProgress = readLocalProgress(episode.id);
      const serverProgress = session
        ? await fetchServerProgress(episode.id, session.user.id)
        : null;
      if (generation !== loadGeneration) {
        return; // superseded again while awaiting the server progress fetch
      }

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
    } catch (error) {
      if (generation === loadGeneration) {
        set({
          toastMessage: "Couldn't load this episode.",
          currentIndex: -1,
          currentEpisode: null,
        });
      }
      console.error("loadTrackAtIndex error:", error);
    }
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
