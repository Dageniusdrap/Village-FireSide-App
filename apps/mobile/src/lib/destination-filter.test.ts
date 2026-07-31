import { matchesDestinationFilters } from "./destination-filter";
import type { Destination } from "@/types/content";

const destination: Destination = {
  id: "d1",
  name: "Lake Bunyonyi",
  slug: "lake-bunyonyi",
  region: "Kigezi",
  district: "Kabale",
  country: "Uganda",
  coverImageUrl: null,
  latitude: -1.27,
  longitude: 29.9,
  categories: ["lakes", "hidden_africa"],
};

describe("matchesDestinationFilters", () => {
  it("matches everything when no filters are selected", () => {
    expect(matchesDestinationFilters(destination, [], [])).toBe(true);
  });

  it("matches when the destination's country is selected", () => {
    expect(matchesDestinationFilters(destination, ["Uganda"], [])).toBe(true);
  });

  it("does not match when a different country is selected", () => {
    expect(matchesDestinationFilters(destination, ["Rwanda"], [])).toBe(false);
  });

  it("matches when at least one selected category overlaps", () => {
    expect(matchesDestinationFilters(destination, [], ["forests", "lakes"])).toBe(true);
  });

  it("does not match when no selected category overlaps", () => {
    expect(matchesDestinationFilters(destination, [], ["forests"])).toBe(false);
  });

  it("ANDs country and category — both must pass", () => {
    expect(matchesDestinationFilters(destination, ["Uganda"], ["forests"])).toBe(false);
    expect(matchesDestinationFilters(destination, ["Uganda"], ["lakes"])).toBe(true);
  });
});
