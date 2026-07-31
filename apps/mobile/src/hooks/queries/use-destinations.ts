import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { Destination } from "@/types/content";

type DestinationRow = {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  district: string | null;
  country: string | null;
  cover_image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  series: { category: string | null }[];
};

export function useDestinations() {
  return useQuery({
    queryKey: ["destinations"],
    queryFn: async (): Promise<Destination[]> => {
      const { data, error } = await supabase
        .from("destinations")
        .select(
          "id, name, slug, region, district, country, cover_image_url, latitude, longitude, series(category)",
        )
        .eq("is_published", true)
        .order("name", { ascending: true })
        .returns<DestinationRow[]>();
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        region: row.region,
        district: row.district,
        country: row.country,
        coverImageUrl: row.cover_image_url,
        latitude: row.latitude,
        longitude: row.longitude,
        categories: [
          ...new Set(row.series.map((s) => s.category).filter((c): c is string => c !== null)),
        ],
      }));
    },
  });
}
