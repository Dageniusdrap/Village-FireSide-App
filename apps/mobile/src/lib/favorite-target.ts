export type FavoriteTarget =
  { episodeId: string } | { seriesId: string } | { destinationId: string };

export type FavoriteRow = {
  episode_id: string | null;
  series_id: string | null;
  destination_id: string | null;
};

export function resolveFavoriteTarget(target: FavoriteTarget): FavoriteRow {
  if ("episodeId" in target) {
    return { episode_id: target.episodeId, series_id: null, destination_id: null };
  }
  if ("seriesId" in target) {
    return { episode_id: null, series_id: target.seriesId, destination_id: null };
  }
  return { episode_id: null, series_id: null, destination_id: target.destinationId };
}

/**
 * Shared TanStack Query key for a single favorite target, so the read hook
 * (`useIsFavorited`) and the mutation's optimistic cache update
 * (`useToggleFavorite`) always agree on the same key for the same target.
 */
export function favoriteQueryKey(target: FavoriteTarget): readonly [string, string, string] {
  if ("episodeId" in target) {
    return ["favorites", "episode_id", target.episodeId] as const;
  }
  if ("seriesId" in target) {
    return ["favorites", "series_id", target.seriesId] as const;
  }
  return ["favorites", "destination_id", target.destinationId] as const;
}
