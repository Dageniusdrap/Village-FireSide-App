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
