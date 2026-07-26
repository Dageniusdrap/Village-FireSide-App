import { create } from "zustand";

import type { Episode } from "@/types/content";

type PlayerState = {
  currentEpisode: Episode | null;
  isPlaying: boolean;
  expanded: boolean;
  play: (episode: Episode) => void;
  pause: () => void;
  expand: () => void;
  collapse: () => void;
};

export const usePlayerStore = create<PlayerState>((set) => ({
  currentEpisode: null,
  isPlaying: false,
  expanded: false,
  play: (episode) => set({ currentEpisode: episode, isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  expand: () => set({ expanded: true }),
  collapse: () => set({ expanded: false }),
}));
