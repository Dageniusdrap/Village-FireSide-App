import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

const RESULT_LIMIT = 5;

export type SearchSeriesResult = { id: string; title: string; coverImageUrl: string | null };
export type SearchEpisodeResult = {
  id: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
};
export type SearchDestinationResult = { id: string; slug: string; name: string };
export type SearchContributorResult = { id: string; displayName: string };

export type GlobalSearchResults = {
  series: SearchSeriesResult[];
  episodes: SearchEpisodeResult[];
  destinations: SearchDestinationResult[];
  contributors: SearchContributorResult[];
};

type SeriesRow = { id: string; title: string; cover_image_url: string | null };
type EpisodeRow = {
  id: string;
  title: string;
  series_id: string;
  series: { title: string } | null;
};
type DestinationRow = { id: string; slug: string; name: string };
type ContributorRow = { id: string; display_name: string };

export function useGlobalSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", trimmed],
    enabled: trimmed.length > 0,
    queryFn: async (): Promise<GlobalSearchResults> => {
      const tsQuery = trimmed.split(/\s+/).join(" | ");

      const [seriesRes, episodesRes, destinationsRes, contributorsRes] = await Promise.all([
        supabase
          .from("series")
          .select("id, title, cover_image_url")
          .textSearch("search_vector", tsQuery)
          .limit(RESULT_LIMIT)
          .returns<SeriesRow[]>(),
        supabase
          .from("episodes")
          .select("id, title, series_id, series(title)")
          .textSearch("search_vector", tsQuery)
          .limit(RESULT_LIMIT)
          .returns<EpisodeRow[]>(),
        supabase
          .from("destinations")
          .select("id, slug, name")
          .textSearch("search_vector", tsQuery)
          .limit(RESULT_LIMIT)
          .returns<DestinationRow[]>(),
        supabase
          .from("public_contributors")
          .select("id, display_name")
          .textSearch("search_vector", tsQuery)
          .limit(RESULT_LIMIT)
          .returns<ContributorRow[]>(),
      ]);

      if (seriesRes.error) throw seriesRes.error;
      if (episodesRes.error) throw episodesRes.error;
      if (destinationsRes.error) throw destinationsRes.error;
      if (contributorsRes.error) throw contributorsRes.error;

      return {
        series: (seriesRes.data ?? []).map((row) => ({
          id: row.id,
          title: row.title,
          coverImageUrl: row.cover_image_url,
        })),
        episodes: (episodesRes.data ?? [])
          .filter((row): row is EpisodeRow & { series: { title: string } } => row.series !== null)
          .map((row) => ({
            id: row.id,
            title: row.title,
            seriesId: row.series_id,
            seriesTitle: row.series.title,
          })),
        destinations: (destinationsRes.data ?? []).map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
        })),
        contributors: (contributorsRes.data ?? []).map((row) => ({
          id: row.id,
          displayName: row.display_name,
        })),
      };
    },
  });
}
