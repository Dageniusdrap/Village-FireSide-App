// apps/mobile/src/hooks/queries/use-destination-detail.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { Destination, PublicContributor } from "@/types/content";

export type DestinationMedia = {
  id: string;
  url: string;
  type: "image" | "video";
  caption: string | null;
};

export type DestinationDetail = Destination & {
  description: string | null;
  bestTimeToVisit: string | null;
  entryFeeNotes: string | null;
  safetyNotes: string | null;
  conservationNotes: string | null;
  media: DestinationMedia[];
  series: { id: string; title: string; coverImageUrl: string | null; episodeCount: number }[];
  contributors: PublicContributor[];
};

type DestinationRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  region: string | null;
  district: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  cover_image_url: string | null;
  best_time_to_visit: string | null;
  entry_fee_notes: string | null;
  safety_notes: string | null;
  conservation_notes: string | null;
};

type MediaRow = {
  id: string;
  media_url: string;
  media_type: string;
  caption: string | null;
};

type SeriesLinkRow = {
  id: string;
  title: string;
  cover_image_url: string | null;
  episodes: { count: number }[];
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

export function useDestinationDetail(slug: string) {
  return useQuery({
    queryKey: ["destination-detail", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<DestinationDetail> => {
      const { data: destination, error: destinationError } = await supabase
        .from("destinations")
        .select(
          "id, name, slug, description, region, district, country, latitude, longitude, cover_image_url, best_time_to_visit, entry_fee_notes, safety_notes, conservation_notes",
        )
        .eq("slug", slug)
        .eq("is_published", true)
        .single()
        .returns<DestinationRow>();
      if (destinationError) {
        throw destinationError;
      }

      const { data: mediaRows, error: mediaError } = await supabase
        .from("destination_media")
        .select("id, media_url, media_type, caption")
        .eq("destination_id", destination.id)
        .order("sort_order", { ascending: true })
        .returns<MediaRow[]>();
      if (mediaError) {
        throw mediaError;
      }

      const { data: seriesRows, error: seriesError } = await supabase
        .from("series")
        .select("id, title, cover_image_url, episodes(count)")
        .eq("destination_id", destination.id)
        .eq("is_published", true)
        .returns<SeriesLinkRow[]>();
      if (seriesError) {
        throw seriesError;
      }

      // A destination's district is free text and often blank — matching
      // contributors against a null district would incorrectly match
      // every contributor with a null district too, so this is skipped
      // entirely rather than run with a loose filter.
      let contributors: PublicContributor[] = [];
      if (destination.district) {
        const { data: contributorRows, error: contributorsError } = await supabase
          .from("public_contributors")
          .select("id, display_name, contributor_type, bio, photo_url, district, country")
          .eq("district", destination.district)
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
        id: destination.id,
        name: destination.name,
        slug: destination.slug,
        description: destination.description,
        region: destination.region,
        district: destination.district,
        country: destination.country,
        latitude: destination.latitude,
        longitude: destination.longitude,
        coverImageUrl: destination.cover_image_url,
        bestTimeToVisit: destination.best_time_to_visit,
        entryFeeNotes: destination.entry_fee_notes,
        safetyNotes: destination.safety_notes,
        conservationNotes: destination.conservation_notes,
        categories: [],
        media: mediaRows.map((row) => ({
          id: row.id,
          url: row.media_url,
          type: row.media_type === "video" ? "video" : "image",
          caption: row.caption,
        })),
        series: seriesRows.map((row) => ({
          id: row.id,
          title: row.title,
          coverImageUrl: row.cover_image_url,
          episodeCount: row.episodes[0]?.count ?? 0,
        })),
        contributors,
      };
    },
  });
}
