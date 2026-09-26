import { describe, expect, it } from "vitest";

import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Lake Bunyonyi Stories")).toBe("lake-bunyonyi-stories");
  });

  it("strips punctuation", () => {
    expect(slugify("Grandma's Tale: Part One!")).toBe("grandmas-tale-part-one");
  });

  it("collapses multiple spaces/hyphens into one", () => {
    expect(slugify("Two   Rivers -- One Story")).toBe("two-rivers-one-story");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  -Elder Voices-  ")).toBe("elder-voices");
  });

  it("returns an empty string for an empty input", () => {
    expect(slugify("")).toBe("");
  });
});
