import { applyListeningTick, type TrackerState } from "./daily-listening-tracker";

const emptyState: TrackerState = {
  date: "2026-09-01",
  accumulatedSeconds: 0,
  recordedForDate: false,
};

describe("applyListeningTick", () => {
  it("accumulates seconds without crossing the threshold", () => {
    const { nextState, crossedThreshold } = applyListeningTick(emptyState, "2026-09-01", 100);
    expect(nextState).toEqual({
      date: "2026-09-01",
      accumulatedSeconds: 100,
      recordedForDate: false,
    });
    expect(crossedThreshold).toBe(false);
  });

  it("crosses the threshold exactly at 300 accumulated seconds", () => {
    const state: TrackerState = {
      date: "2026-09-01",
      accumulatedSeconds: 285,
      recordedForDate: false,
    };
    const { nextState, crossedThreshold } = applyListeningTick(state, "2026-09-01", 15);
    expect(crossedThreshold).toBe(true);
    expect(nextState).toEqual({
      date: "2026-09-01",
      accumulatedSeconds: 300,
      recordedForDate: true,
    });
  });

  it("does not re-fire once already recorded for the date", () => {
    const state: TrackerState = {
      date: "2026-09-01",
      accumulatedSeconds: 300,
      recordedForDate: true,
    };
    const { nextState, crossedThreshold } = applyListeningTick(state, "2026-09-01", 15);
    expect(crossedThreshold).toBe(false);
    expect(nextState).toEqual(state);
  });

  it("resets the accumulator on a local-date rollover", () => {
    const state: TrackerState = {
      date: "2026-09-01",
      accumulatedSeconds: 290,
      recordedForDate: false,
    };
    const { nextState, crossedThreshold } = applyListeningTick(state, "2026-09-02", 10);
    expect(crossedThreshold).toBe(false);
    expect(nextState).toEqual({
      date: "2026-09-02",
      accumulatedSeconds: 10,
      recordedForDate: false,
    });
  });

  it("resets recordedForDate on rollover even if yesterday had already crossed the threshold", () => {
    const state: TrackerState = {
      date: "2026-09-01",
      accumulatedSeconds: 600,
      recordedForDate: true,
    };
    const { nextState, crossedThreshold } = applyListeningTick(state, "2026-09-02", 15);
    expect(crossedThreshold).toBe(false);
    expect(nextState).toEqual({
      date: "2026-09-02",
      accumulatedSeconds: 15,
      recordedForDate: false,
    });
  });
});
