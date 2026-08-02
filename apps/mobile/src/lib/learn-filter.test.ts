import { matchesLearnFilters } from "./learn-filter";
import type { LearnFilterable } from "./learn-filter";

const item: LearnFilterable = {
  gradeLevel: "primary",
  syllabusTopic: "Great Lakes Kingdoms",
  culturalGroupIds: ["cg-1", "cg-2"],
};

describe("matchesLearnFilters", () => {
  it("matches everything when no filters are selected", () => {
    expect(matchesLearnFilters(item, [], [], [])).toBe(true);
  });

  it("matches when the grade level is selected", () => {
    expect(matchesLearnFilters(item, ["primary"], [], [])).toBe(true);
  });

  it("does not match when a different grade level is selected", () => {
    expect(matchesLearnFilters(item, ["tertiary"], [], [])).toBe(false);
  });

  it("matches when the syllabus topic is selected", () => {
    expect(matchesLearnFilters(item, [], ["Great Lakes Kingdoms"], [])).toBe(true);
  });

  it("does not match when a different syllabus topic is selected", () => {
    expect(matchesLearnFilters(item, [], ["Colonial Era"], [])).toBe(false);
  });

  it("matches when at least one selected cultural group overlaps", () => {
    expect(matchesLearnFilters(item, [], [], ["cg-2", "cg-9"])).toBe(true);
  });

  it("does not match when no selected cultural group overlaps", () => {
    expect(matchesLearnFilters(item, [], [], ["cg-9"])).toBe(false);
  });

  it("ANDs all three dimensions together", () => {
    expect(matchesLearnFilters(item, ["primary"], ["Colonial Era"], [])).toBe(false);
    expect(matchesLearnFilters(item, ["primary"], ["Great Lakes Kingdoms"], ["cg-1"])).toBe(true);
  });

  it("treats a null gradeLevel/syllabusTopic as never matching an active filter", () => {
    const unset: LearnFilterable = { gradeLevel: null, syllabusTopic: null, culturalGroupIds: [] };
    expect(matchesLearnFilters(unset, ["primary"], [], [])).toBe(false);
    expect(matchesLearnFilters(unset, [], ["Colonial Era"], [])).toBe(false);
  });
});
