// apps/mobile/src/stores/daily-engagement-store.ts
import { create } from "zustand";

type PendingQuizEpisode = { id: string; title: string };

type DailyEngagementState = {
  streakMilestone: number | null;
  pendingQuizEpisode: PendingQuizEpisode | null;
  dismissStreakMilestone: () => void;
  dismissPendingQuizEpisode: () => void;
};

// Two small, finish-triggered pieces of UI state that both originate
// from AudioStatusDriver's didJustFinish/15s-tick handling — kept in
// one small store rather than two, mirroring player-store's own
// toastMessage/dismissToast shape but separate from it since neither
// field is playback state.
export const useDailyEngagementStore = create<DailyEngagementState>((set) => ({
  streakMilestone: null,
  pendingQuizEpisode: null,
  dismissStreakMilestone: () => set({ streakMilestone: null }),
  dismissPendingQuizEpisode: () => set({ pendingQuizEpisode: null }),
}));
