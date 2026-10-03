// apps/mobile/src/hooks/queries/use-todays-featured-episode.ts
import { useQuery } from "@tanstack/react-query";

import { getLocalDateString } from "@/lib/local-date";
import { supabase } from "@/lib/supabase";
import type { QueueEpisode } from "@/stores/player-store";
import type { AccessTier, ContentSource } from "@/types/content";

export type FeaturedEpisode = {
  id: string;
  title: string;
  durationSeconds: number | null;
  queueEpisode: QueueEpisode;
};

type EpisodeCandidateRow = {
  id: string;
  title: string;
  episode_number: number;
  duration_seconds: number | null;
  access_tier: AccessTier;
  coin_price: number;
  content_source: ContentSource;
  series_id: string;
  series: { title: string; cover_image_url: string | null } | null;
};

type OverrideRow = { episode_id: string };

// Deterministic, pure, and intentionally simple — this only needs to
// pick the same episode all day for a given local date, not cryptographic
// distribution quality.
function hashStringToIndex(seed: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

function toFeaturedEpisode(
  row: EpisodeCandidateRow & { series: NonNullable<EpisodeCandidateRow["series"]> },
): FeaturedEpisode {
  return {
    id: row.id,
    title: row.title,
    durationSeconds: row.duration_seconds,
    queueEpisode: {
      id: row.id,
      title: row.title,
      episodeNumber: row.episode_number,
      durationSeconds: row.duration_seconds,
      accessTier: row.access_tier,
      coinPrice: row.coin_price,
      contentSource: row.content_source,
      resumePositionSeconds: null,
      seriesId: row.series_id,
      seriesTitle: row.series.title,
      coverImageUrl: row.series.cover_image_url,
    },
  };
}

export function useTodaysFeaturedEpisode() {
  const localDate = getLocalDateString();

  return useQuery({
    queryKey: ["home", "todays-featured-episode", localDate],
    queryFn: async (): Promise<FeaturedEpisode | null> => {
      const { data: overrideRow, error: overrideError } = await supabase
        .from("daily_featured_episodes")
        .select("episode_id")
        .eq("feature_date", localDate)
        .maybeSingle()
        .returns<OverrideRow | null>();
      if (overrideError) {
        throw overrideError;
      }

      // Fetch every published, free episode — this project's content
      // tables are small at current scale (same reasoning already
      // applied to Prompt 13's global search), so one unfiltered fetch
      // is simpler than a second targeted query, and it naturally
      // handles an override row that points at a non-free/unpublished
      // episode: that id just won't appear in this list, and the code
      // below falls back to auto-rotation.
      const { data: candidates, error: candidatesError } = await supabase
        .from("episodes")
        .select(
          "id, title, episode_number, duration_seconds, access_tier, coin_price, content_source, series_id, series(title, cover_image_url)",
        )
        .eq("status", "published")
        .eq("access_tier", "free")
        .order("id", { ascending: true })
        .returns<EpisodeCandidateRow[]>();
      if (candidatesError) {
        throw candidatesError;
      }

      const playable = candidates.filter(
        (
          row,
        ): row is EpisodeCandidateRow & { series: NonNullable<EpisodeCandidateRow["series"]> } =>
          row.series !== null,
      );
      if (playable.length === 0) {
        return null;
      }

      const overridden = overrideRow
        ? playable.find((row) => row.id === overrideRow.episode_id)
        : undefined;
      const picked = overridden ?? playable[hashStringToIndex(localDate, playable.length)]!;

      return toFeaturedEpisode(picked);
    },
  });
}
