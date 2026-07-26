import { startSleepTimer } from "./sleep-timer";

describe("startSleepTimer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("calls onFire after the given number of minutes", () => {
    const onFire = jest.fn();
    startSleepTimer(10, onFire);

    jest.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(onFire).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("supports each documented option", () => {
    for (const minutes of [10, 20, 30, 45] as const) {
      const onFire = jest.fn();
      startSleepTimer(minutes, onFire);
      jest.advanceTimersByTime(minutes * 60 * 1000);
      expect(onFire).toHaveBeenCalledTimes(1);
    }
  });

  it("returns a cancel function that stops onFire from firing", () => {
    const onFire = jest.fn();
    const cancel = startSleepTimer(10, onFire);

    cancel();
    jest.advanceTimersByTime(10 * 60 * 1000);

    expect(onFire).not.toHaveBeenCalled();
  });
});
