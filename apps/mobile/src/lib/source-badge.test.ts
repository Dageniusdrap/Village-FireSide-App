import { getSourceBadgeContent } from "./source-badge";

describe("getSourceBadgeContent", () => {
  it("labels elder testimony in gold", () => {
    expect(getSourceBadgeContent("elder_testimony")).toEqual({
      label: "Elder testimony",
      variant: "gold",
    });
  });

  it("labels narrated production as neutral", () => {
    expect(getSourceBadgeContent("narrated_production")).toEqual({
      label: "Narrated production",
      variant: "neutral",
    });
  });

  it("labels AI-assisted content as neutral 'Narrated production'", () => {
    expect(getSourceBadgeContent("ai_assisted")).toEqual({
      label: "Narrated production",
      variant: "neutral",
    });
  });

  it("labels tour-guide-original content as neutral 'Narrated production'", () => {
    expect(getSourceBadgeContent("tour_guide_original")).toEqual({
      label: "Narrated production",
      variant: "neutral",
    });
  });
});
