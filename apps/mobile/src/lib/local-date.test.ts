import { getLocalDateString } from "./local-date";

// These tests are written to hold in whatever timezone the test process runs
// in. Assigning process.env.TZ inside a Jest test does not change the
// timezone Date uses (Jest sandboxes process.env per test file), so dates are
// built from local wall-clock components instead of switching zones.
describe("getLocalDateString", () => {
  it("uses the local calendar date just after local midnight", () => {
    // In any zone ahead of UTC, toISOString() still reports the previous day here.
    const date = new Date(2026, 0, 2, 0, 30);
    expect(getLocalDateString(date)).toBe("2026-01-02");
  });

  it("uses the local calendar date just before local midnight", () => {
    // In any zone behind UTC, toISOString() already reports the next day here.
    const date = new Date(2026, 0, 1, 23, 30);
    expect(getLocalDateString(date)).toBe("2026-01-01");
  });

  it("pads single-digit months and days", () => {
    const date = new Date(2026, 2, 5, 12, 0);
    expect(getLocalDateString(date)).toBe("2026-03-05");
  });

  it("defaults to the current date when called with no argument", () => {
    expect(getLocalDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
