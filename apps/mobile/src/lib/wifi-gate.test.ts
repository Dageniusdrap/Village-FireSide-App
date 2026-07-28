import { shouldPauseForWifi } from "./wifi-gate";

describe("shouldPauseForWifi", () => {
  it("does not pause on wifi when wifi-only is enabled", () => {
    expect(shouldPauseForWifi({ type: "wifi" }, true)).toBe(false);
  });

  it("pauses on cellular when wifi-only is enabled", () => {
    expect(shouldPauseForWifi({ type: "cellular" }, true)).toBe(true);
  });

  it("does not pause on cellular when wifi-only is disabled", () => {
    expect(shouldPauseForWifi({ type: "cellular" }, false)).toBe(false);
  });

  it("does not pause on wifi when wifi-only is disabled", () => {
    expect(shouldPauseForWifi({ type: "wifi" }, false)).toBe(false);
  });

  it("pauses when offline/unknown and wifi-only is enabled", () => {
    expect(shouldPauseForWifi({ type: "none" }, true)).toBe(true);
    expect(shouldPauseForWifi({ type: "unknown" }, true)).toBe(true);
  });
});
