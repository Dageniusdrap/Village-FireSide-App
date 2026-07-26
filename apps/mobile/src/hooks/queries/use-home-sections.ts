import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import type { CulturalGroup, Episode, PublicContributor, Series } from "@/types/content";

type SeriesRow = {
  id: string;
  title: string;
  cover_image_url: string | null;
  category: string | null;
  episodes: { count: number }[];
};

function mapSeriesRow(row: SeriesRow): Series {
  return {
    id: row.id,
    title: row.title,
    coverImageUrl: row.cover_image_url,
    category: row.category,
    episodeCount: row.episodes[0]?.count ?? 0,
  };
}

export function useFeaturedSeries() {
  return useQuery({
    queryKey: ["home", "featured-series"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("series")
        .select("id, title, cover_image_url, category, episodes(count)")
        .eq("is_featured", true)
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .returns<SeriesRow[]>();
      if (error) {
        throw error;
      }
      return data.map(mapSeriesRow);
    },
  });
}

export function useElderVoicesSeries() {
  return useQuery({
    queryKey: ["home", "elder-voices-series"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("series")
        .select("id, title, cover_image_url, category, episodes(count)")
        .eq("category", "elder_history")
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .returns<SeriesRow[]>();
      if (error) {
        throw error;
      }
      return data.map(mapSeriesRow);
    },
  });
}

type ContinueListeningRow = {
  position_seconds: number;
  episodes: {
    id: string;
    title: string;
    duration_seconds: number | null;
    access_tier: Episode["accessTier"];
    content_source: Episode["contentSource"];
  };
};

export function useContinueListening() {
  const session = useAuthStore((state) => state.session);

  return useQuery({
    queryKey: ["home", "continue-listening", session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async () => {
      if (!session) {
        return [];
      }
      const { data, error } = await supabase
        .from("listening_progress")
        .select(
          "position_seconds, episodes(id, title, duration_seconds, access_tier, content_source)",
        )
        .eq("user_id", session.user.id)
        .eq("completed", false)
        .order("updated_at", { ascending: false })
        .limit(10)
        .returns<ContinueListeningRow[]>();
      if (error) {
        throw error;
      }
      return data.map((row): Episode => ({
        id: row.episodes.id,
        title: row.episodes.title,
        durationSeconds: row.episodes.duration_seconds,
        accessTier: row.episodes.access_tier,
        contentSource: row.episodes.content_source,
      }));
    },
  });
}

export function useCategoryRail(category: string) {
  return useQuery({
    queryKey: ["home", "category-rail", category],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("series")
        .select("id, title, cover_image_url, category, episodes(count)")
        .eq("category", category)
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .returns<SeriesRow[]>();
      if (error) {
        throw error;
      }
      return data.map(mapSeriesRow);
    },
  });
}

type CulturalGroupRow = {
  id: string;
  name: string;
  description: string | null;
  country: string | null;
  region: string | null;
  cover_image_url: string | null;
};

export function useCulturalGroups() {
  return useQuery({
    queryKey: ["home", "cultural-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cultural_groups")
        .select("id, name, description, country, region, cover_image_url")
        .eq("is_published", true)
        .returns<CulturalGroupRow[]>();
      if (error) {
        throw error;
      }
      return data.map((row): CulturalGroup => ({
        id: row.id,
        name: row.name,
        description: row.description,
        country: row.country,
        region: row.region,
        coverImageUrl: row.cover_image_url,
      }));
    },
  });
}

type PublicContributorRow = {
  id: string;
  display_name: string;
  contributor_type: PublicContributor["contributorType"];
  bio: string | null;
  photo_url: string | null;
  district: string | null;
  country: string | null;
};

export function useStorytellers() {
  return useQuery({
    queryKey: ["home", "storytellers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_contributors")
        .select("id, display_name, contributor_type, bio, photo_url, district, country")
        .returns<PublicContributorRow[]>();
      if (error) {
        throw error;
      }
      return data.map((row): PublicContributor => ({
        id: row.id,
        displayName: row.display_name,
        contributorType: row.contributor_type,
        bio: row.bio,
        photoUrl: row.photo_url,
        district: row.district,
        country: row.country,
      }));
    },
  });
}
