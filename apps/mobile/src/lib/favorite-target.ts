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
 *
 * Scoped by `userId` (not just the target) so cached favorite state can't
 * leak from one signed-in account to the next on the same device — this
 * mirrors `use-home-sections.ts`'s `useContinueListening`, which keys on
 * `session?.user.id` for the same reason.
 */
export function favoriteQueryKey(
  target: FavoriteTarget,
  userId: string | null,
): readonly [string, string | null, string, string] {
  if ("episodeId" in target) {
    return ["favorites", userId, "episode_id", target.episodeId] as const;
  }
  if ("seriesId" in target) {
    return ["favorites", userId, "series_id", target.seriesId] as const;
  }
  return ["favorites", userId, "destination_id", target.destinationId] as const;
}
