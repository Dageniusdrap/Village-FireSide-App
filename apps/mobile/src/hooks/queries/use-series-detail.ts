// apps/mobile/src/hooks/queries/use-series-detail.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { AccessTier, ContentSource } from "@/types/content";

export type SeriesDetailEpisode = {
  id: string;
  title: string;
  episodeNumber: number;
  durationSeconds: number | null;
  accessTier: AccessTier;
  coinPrice: number;
  contentSource: ContentSource;
  resumePositionSeconds: number | null;
};

export type SeriesDetail = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  destinationId: string | null;
  coverImageUrl: string | null;
  episodes: SeriesDetailEpisode[];
};

type SeriesDetailRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  destination_id: string | null;
  cover_image_url: string | null;
  episodes: {
    id: string;
    title: string;
    episode_number: number;
    duration_seconds: number | null;
    access_tier: AccessTier;
    coin_price: number;
    content_source: ContentSource;
    listening_progress: { position_seconds: number }[];
  }[];
};

export function useSeriesDetail(id: string) {
  return useQuery({
    queryKey: ["series-detail", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<SeriesDetail> => {
      const { data, error } = await supabase
        .from("series")
        .select(
          "id, title, description, category, destination_id, cover_image_url, episodes(id, title, episode_number, duration_seconds, access_tier, coin_price, content_source, listening_progress(position_seconds))",
        )
        .eq("id", id)
        .eq("is_published", true)
        .order("episode_number", { referencedTable: "episodes", ascending: true })
        .single()
        .returns<SeriesDetailRow>();
      if (error) {
        throw error;
      }
      return {
        id: data.id,
        title: data.title,
        description: data.description,
        category: data.category,
        destinationId: data.destination_id,
        coverImageUrl: data.cover_image_url,
        episodes: data.episodes.map((episode) => ({
          id: episode.id,
          title: episode.title,
          episodeNumber: episode.episode_number,
          durationSeconds: episode.duration_seconds,
          accessTier: episode.access_tier,
          coinPrice: episode.coin_price,
          contentSource: episode.content_source,
          resumePositionSeconds: episode.listening_progress[0]?.position_seconds ?? null,
        })),
      };
    },
  });
}
