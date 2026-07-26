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
