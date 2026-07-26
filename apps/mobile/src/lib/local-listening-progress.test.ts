import { resolveResumePosition } from "./local-listening-progress";

// The module under test imports `@/lib/supabase` at the top level for
// persistListeningProgress. Loading the real module throws in the test
// environment (no EXPO_PUBLIC_SUPABASE_* vars, no jest setup provides
// them), even though these tests only exercise the pure
// resolveResumePosition logic. Mocked per the same pattern used in
// resolve-episode-source.test.ts.
jest.mock("@/lib/supabase", () => ({
  supabase: { from: jest.fn() },
}));

describe("resolveResumePosition", () => {
  it("returns 0 when neither local nor server progress exists", () => {
    expect(resolveResumePosition(null, null)).toBe(0);
  });

  it("returns the local position when there is no server progress", () => {
    expect(
      resolveResumePosition({ positionSeconds: 42, updatedAt: "2026-07-01T00:00:00Z" }, null),
    ).toBe(42);
  });

  it("returns the server position when there is no local progress", () => {
    expect(
      resolveResumePosition(null, { positionSeconds: 99, updatedAt: "2026-07-01T00:00:00Z" }),
    ).toBe(99);
  });

  it("prefers the newer local progress over a stale server row", () => {
    const local = { positionSeconds: 120, updatedAt: "2026-07-02T00:00:00Z" };
    const server = { positionSeconds: 30, updatedAt: "2026-07-01T00:00:00Z" };
    expect(resolveResumePosition(local, server)).toBe(120);
  });

  it("prefers the newer server progress over a stale local row", () => {
    const local = { positionSeconds: 30, updatedAt: "2026-07-01T00:00:00Z" };
    const server = { positionSeconds: 200, updatedAt: "2026-07-02T00:00:00Z" };
    expect(resolveResumePosition(local, server)).toBe(200);
  });

  it("prefers local when both timestamps are exactly equal", () => {
    const local = { positionSeconds: 10, updatedAt: "2026-07-01T00:00:00Z" };
    const server = { positionSeconds: 20, updatedAt: "2026-07-01T00:00:00Z" };
    expect(resolveResumePosition(local, server)).toBe(10);
  });
});
