// apps/mobile/src/hooks/queries/use-bookmarks.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import type { QueueEpisode } from "@/stores/player-store";
import type { AccessTier, ContentSource } from "@/types/content";

export type BookmarkListItem = {
  id: string;
  positionSeconds: number;
  note: string | null;
  episode: QueueEpisode;
};

type BookmarkRow = {
  id: string;
  position_seconds: number;
  note: string | null;
  // Null when the linked episode (or its series) is currently hidden
  // from this user by its own RLS policy — mirrors use-series-detail.ts's
  // and use-contributor-detail.ts's nested-embed nullability pattern.
  episodes: {
    id: string;
    title: string;
    episode_number: number;
    duration_seconds: number | null;
    access_tier: AccessTier;
    coin_price: number;
    content_source: ContentSource;
    series_id: string;
    series: { title: string; cover_image_url: string | null } | null;
  } | null;
};

export function useBookmarks() {
  const session = useAuthStore((state) => state.session);

  return useQuery({
    queryKey: ["bookmarks", session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async (): Promise<BookmarkListItem[]> => {
      if (!session) {
        return [];
      }
      const { data, error } = await supabase
        .from("episode_bookmarks")
        .select(
          "id, position_seconds, note, episodes(id, title, episode_number, duration_seconds, access_tier, coin_price, content_source, series_id, series(title, cover_image_url))",
        )
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .returns<BookmarkRow[]>();
      if (error) {
        throw error;
      }
      return data
        .filter(
          (
            row,
          ): row is BookmarkRow & {
            episodes: NonNullable<BookmarkRow["episodes"]> & {
              series: NonNullable<NonNullable<BookmarkRow["episodes"]>["series"]>;
            };
          } => row.episodes !== null && row.episodes.series !== null,
        )
        .map((row) => ({
          id: row.id,
          positionSeconds: row.position_seconds,
          note: row.note,
          episode: {
            id: row.episodes.id,
            title: row.episodes.title,
            episodeNumber: row.episodes.episode_number,
            durationSeconds: row.episodes.duration_seconds,
            accessTier: row.episodes.access_tier,
            coinPrice: row.episodes.coin_price,
            contentSource: row.episodes.content_source,
            resumePositionSeconds: null,
            seriesId: row.episodes.series_id,
            seriesTitle: row.episodes.series.title,
            coverImageUrl: row.episodes.series.cover_image_url,
          },
        }));
    },
  });
}
