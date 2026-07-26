// apps/mobile/src/hooks/queries/use-cultural-group-detail.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { CulturalGroup, PublicContributor } from "@/types/content";

export type CulturalGroupDetail = CulturalGroup & {
  series: { id: string; title: string; coverImageUrl: string | null; episodeCount: number }[];
  contributors: PublicContributor[];
};

type CulturalGroupRow = {
  id: string;
  name: string;
  description: string | null;
  country: string | null;
  region: string | null;
  cover_image_url: string | null;
};

type SeriesLinkRow = {
  // PostgREST returns `null` here when the linked series is currently
  // hidden from this user by its own RLS policy (e.g. unpublished),
  // even though the parent `series_cultural_groups` row is visible.
  series: {
    id: string;
    title: string;
    cover_image_url: string | null;
    episodes: { count: number }[];
  } | null;
};

type ContributorLinkRow = {
  contributor_id: string;
};

type PublicContributorRow = {
  id: string;
  display_name: string;
  contributor_type: PublicContributor["contributorType"];
  bio: string | null;
  photo_url: string | null;
  district: string | null;
  country: string | null;
};

export function useCulturalGroupDetail(id: string) {
  return useQuery({
    queryKey: ["cultural-group-detail", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<CulturalGroupDetail> => {
      const { data: group, error: groupError } = await supabase
        .from("cultural_groups")
        .select("id, name, description, country, region, cover_image_url")
        .eq("id", id)
        .eq("is_published", true)
        .single()
        .returns<CulturalGroupRow>();
      if (groupError) {
        throw groupError;
      }

      const { data: seriesLinks, error: seriesError } = await supabase
        .from("series_cultural_groups")
        .select("series(id, title, cover_image_url, episodes(count))")
        .eq("cultural_group_id", id)
        .returns<SeriesLinkRow[]>();
      if (seriesError) {
        throw seriesError;
      }

      const { data: contributorLinks, error: linksError } = await supabase
        .from("contributor_cultural_groups")
        .select("contributor_id")
        .eq("cultural_group_id", id)
        .returns<ContributorLinkRow[]>();
      if (linksError) {
        throw linksError;
      }

      const contributorIds = contributorLinks.map((link) => link.contributor_id);
      let contributors: PublicContributor[] = [];
      if (contributorIds.length > 0) {
        const { data: contributorRows, error: contributorsError } = await supabase
          .from("public_contributors")
          .select("id, display_name, contributor_type, bio, photo_url, district, country")
          .in("id", contributorIds)
          .returns<PublicContributorRow[]>();
        if (contributorsError) {
          throw contributorsError;
        }
        contributors = contributorRows.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          contributorType: row.contributor_type,
          bio: row.bio,
          photoUrl: row.photo_url,
          district: row.district,
          country: row.country,
        }));
      }

      return {
        id: group.id,
        name: group.name,
        description: group.description,
        country: group.country,
        region: group.region,
        coverImageUrl: group.cover_image_url,
        series: seriesLinks
          .filter(
            (link): link is SeriesLinkRow & { series: NonNullable<SeriesLinkRow["series"]> } =>
              link.series !== null,
          )
          .map((link) => ({
            id: link.series.id,
            title: link.series.title,
            coverImageUrl: link.series.cover_image_url,
            episodeCount: link.series.episodes[0]?.count ?? 0,
          })),
        contributors,
      };
    },
  });
}
