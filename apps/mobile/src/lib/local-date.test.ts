import { getLocalDateString } from "./local-date";

describe("getLocalDateString", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("uses the local calendar date, not UTC's — the exact bug this function exists to avoid", () => {
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14 — always ahead of UTC
    const date = new Date("2026-01-01T23:00:00.000Z"); // still Jan 1 in UTC...
    expect(date.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(getLocalDateString(date)).toBe("2026-01-02"); // ...but already Jan 2 locally
  });

  it("matches toISOString's date when local and UTC agree", () => {
    process.env.TZ = "UTC";
    const date = new Date("2026-06-15T12:00:00.000Z");
    expect(getLocalDateString(date)).toBe(date.toISOString().slice(0, 10));
  });

  it("pads single-digit months and days", () => {
    process.env.TZ = "UTC";
    const date = new Date("2026-03-05T00:00:00.000Z");
    expect(getLocalDateString(date)).toBe("2026-03-05");
  });

  it("defaults to the current date when called with no argument", () => {
    process.env.TZ = "UTC";
    expect(getLocalDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
