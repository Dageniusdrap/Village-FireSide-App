// apps/mobile/src/hooks/queries/use-contributor-detail.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { ContributorType } from "@/types/content";

export type ContributorDetailEpisode = {
  id: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  role: string;
};

export type ContributorDetail = {
  id: string;
  displayName: string;
  contributorType: ContributorType;
  bio: string | null;
  photoUrl: string | null;
  district: string | null;
  country: string | null;
  episodes: ContributorDetailEpisode[];
};

type ContributorRow = {
  id: string;
  display_name: string;
  contributor_type: ContributorType;
  bio: string | null;
  photo_url: string | null;
  district: string | null;
  country: string | null;
};

type EpisodeContributorRow = {
  role: string;
  episodes: {
    id: string;
    title: string;
    series_id: string;
    series: { title: string };
  };
};

export function useContributorDetail(id: string) {
  return useQuery({
    queryKey: ["contributor-detail", id],
    queryFn: async (): Promise<ContributorDetail> => {
      const { data: contributor, error: contributorError } = await supabase
        .from("public_contributors")
        .select("id, display_name, contributor_type, bio, photo_url, district, country")
        .eq("id", id)
        .single()
        .returns<ContributorRow>();
      if (contributorError) {
        throw contributorError;
      }

      const { data: episodeLinks, error: episodesError } = await supabase
        .from("episode_contributors")
        .select("role, episodes(id, title, series_id, series(title))")
        .eq("contributor_id", id)
        .returns<EpisodeContributorRow[]>();
      if (episodesError) {
        throw episodesError;
      }

      return {
        id: contributor.id,
        displayName: contributor.display_name,
        contributorType: contributor.contributor_type,
        bio: contributor.bio,
        photoUrl: contributor.photo_url,
        district: contributor.district,
        country: contributor.country,
        episodes: episodeLinks.map((link) => ({
          id: link.episodes.id,
          title: link.episodes.title,
          seriesId: link.episodes.series_id,
          seriesTitle: link.episodes.series.title,
          role: link.role,
        })),
      };
    },
  });
}
