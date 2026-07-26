import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it("renders an em dash for null", () => {
    expect(formatDuration(null)).toBe("—");
  });

  it("pads single-digit seconds", () => {
    expect(formatDuration(65)).toBe("1:05");
  });

  it("renders zero seconds as 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
  });

  it("does not pad minutes past 59", () => {
    expect(formatDuration(3661)).toBe("61:01");
  });
});
