// apps/admin/src/app/(dashboard)/episodes/load-episode-form-options.ts
import { createClient } from "@/lib/supabase/server";

export async function loadEpisodeFormOptions() {
  const supabase = await createClient();
  const [seriesResult, sourceMaterialsResult, contributorsResult] = await Promise.all([
    supabase.from("series").select("id, title").order("title"),
    supabase.from("source_materials").select("id, title, public_domain_verified").order("title"),
    supabase
      .from("contributors")
      .select("id, display_name, contributor_type")
      .order("display_name"),
  ]);

  return {
    seriesOptions: seriesResult.data ?? [],
    sourceMaterialOptions: sourceMaterialsResult.data ?? [],
    contributorOptions: contributorsResult.data ?? [],
  };
}
