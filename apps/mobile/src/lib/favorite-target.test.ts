import { favoriteQueryKey, resolveFavoriteTarget } from "./favorite-target";

describe("resolveFavoriteTarget", () => {
  it("sets only episode_id for an episode target", () => {
    expect(resolveFavoriteTarget({ episodeId: "ep-1" })).toEqual({
      episode_id: "ep-1",
      series_id: null,
      destination_id: null,
    });
  });

  it("sets only series_id for a series target", () => {
    expect(resolveFavoriteTarget({ seriesId: "series-1" })).toEqual({
      episode_id: null,
      series_id: "series-1",
      destination_id: null,
    });
  });

  it("sets only destination_id for a destination target", () => {
    expect(resolveFavoriteTarget({ destinationId: "dest-1" })).toEqual({
      episode_id: null,
      series_id: null,
      destination_id: "dest-1",
    });
  });
});

describe("favoriteQueryKey", () => {
  it("builds an episode key", () => {
    expect(favoriteQueryKey({ episodeId: "ep-1" })).toEqual(["favorites", "episode_id", "ep-1"]);
  });

  it("builds a series key", () => {
    expect(favoriteQueryKey({ seriesId: "series-1" })).toEqual([
      "favorites",
      "series_id",
      "series-1",
    ]);
  });

  it("builds a destination key", () => {
    expect(favoriteQueryKey({ destinationId: "dest-1" })).toEqual([
      "favorites",
      "destination_id",
      "dest-1",
    ]);
  });

  it("gives different targets of the same type different keys", () => {
    expect(favoriteQueryKey({ seriesId: "series-1" })).not.toEqual(
      favoriteQueryKey({ seriesId: "series-2" }),
    );
  });
});
