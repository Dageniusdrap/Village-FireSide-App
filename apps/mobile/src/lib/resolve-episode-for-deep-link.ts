import { supabase } from "@/lib/supabase";
import type { QueueEpisode } from "@/stores/player-store";

type EpisodeRow = {
  id: string;
  title: string;
  episode_number: number;
  duration_seconds: number | null;
  access_tier: QueueEpisode["accessTier"];
  coin_price: number;
  content_source: QueueEpisode["contentSource"];
  series_id: string;
  series: { title: string; cover_image_url: string | null };
};

export async function resolveEpisodeForDeepLink(episodeId: string): Promise<QueueEpisode | null> {
  const { data, error } = await supabase
    .from("episodes")
    .select(
      "id, title, episode_number, duration_seconds, access_tier, coin_price, content_source, series_id, series(title, cover_image_url)",
    )
    .eq("id", episodeId)
    .single()
    .returns<EpisodeRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    title: data.title,
    episodeNumber: data.episode_number,
    durationSeconds: data.duration_seconds,
    accessTier: data.access_tier,
    coinPrice: data.coin_price,
    contentSource: data.content_source,
    resumePositionSeconds: null,
    seriesId: data.series_id,
    seriesTitle: data.series.title,
    coverImageUrl: data.series.cover_image_url,
  };
}
