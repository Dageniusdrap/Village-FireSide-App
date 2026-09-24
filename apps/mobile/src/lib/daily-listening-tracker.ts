import { File, Paths } from "expo-file-system";

import { getLocalDateString } from "@/lib/local-date";

const THRESHOLD_SECONDS = 300;

export type TrackerState = {
  date: string;
  accumulatedSeconds: number;
  recordedForDate: boolean;
};

const trackerFile = new File(Paths.document, "daily-listening-tracker.json");

// Pure decision logic, kept separate from the file I/O below so it can
// be unit tested directly — see this file's Interfaces note on why the
// I/O functions themselves stay untested.
export function applyListeningTick(
  state: TrackerState,
  today: string,
  seconds: number,
): { nextState: TrackerState; crossedThreshold: boolean } {
  const current =
    state.date === today ? state : { date: today, accumulatedSeconds: 0, recordedForDate: false };
  if (current.recordedForDate) {
    return { nextState: current, crossedThreshold: false };
  }
  const accumulatedSeconds = current.accumulatedSeconds + seconds;
  const crossedThreshold = accumulatedSeconds >= THRESHOLD_SECONDS;
  return {
    nextState: { date: today, accumulatedSeconds, recordedForDate: crossedThreshold },
    crossedThreshold,
  };
}

function readState(): TrackerState {
  const today = getLocalDateString();
  if (!trackerFile.exists) {
    return { date: today, accumulatedSeconds: 0, recordedForDate: false };
  }
  try {
    const parsed = JSON.parse(trackerFile.textSync()) as Partial<TrackerState>;
    if (
      typeof parsed.date === "string" &&
      typeof parsed.accumulatedSeconds === "number" &&
      typeof parsed.recordedForDate === "boolean"
    ) {
      return {
        date: parsed.date,
        accumulatedSeconds: parsed.accumulatedSeconds,
        recordedForDate: parsed.recordedForDate,
      };
    }
    return { date: today, accumulatedSeconds: 0, recordedForDate: false };
  } catch {
    return { date: today, accumulatedSeconds: 0, recordedForDate: false };
  }
}

function writeState(state: TrackerState): void {
  if (!trackerFile.exists) {
    trackerFile.create();
  }
  trackerFile.write(JSON.stringify(state));
}

/**
 * Call once per playback tick while audio is actually playing (the
 * caller is responsible for only calling this while status.playing is
 * true). Returns true exactly once per local date — the moment
 * accumulated listening first crosses the 5-minute threshold — so the
 * caller knows to fire record_listening_day() exactly once.
 */
export function recordListeningTick(seconds: number): boolean {
  const { nextState, crossedThreshold } = applyListeningTick(
    readState(),
    getLocalDateString(),
    seconds,
  );
  writeState(nextState);
  return crossedThreshold;
}

/**
 * Call when the caller's own record-keeping RPC (e.g. record_listening_day)
 * fails after recordListeningTick returned true. Resets today's
 * recordedForDate flag so the next 15s tick retries, instead of
 * silently losing the day — recordListeningTick's own logic already
 * treats a false recordedForDate with an already-past-threshold
 * accumulatedSeconds as "crossed again," so this is safe and the RPC
 * itself is idempotent for same-day repeat calls.
 */
export function resetRecordedFlagForRetry(): void {
  const today = getLocalDateString();
  const state = readState();
  if (state.date === today && state.recordedForDate) {
    writeState({ ...state, recordedForDate: false });
  }
}
