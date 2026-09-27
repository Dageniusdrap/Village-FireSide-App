// apps/admin/src/app/(dashboard)/episodes/[id]/edit/page.tsx
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { EpisodeForm } from "../../episode-form";
import { loadEpisodeFormOptions } from "../../load-episode-form-options";
import { PublishGuardPanel } from "../../publish-guard-panel";

export default async function EditEpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [episodeResult, options, linksResult] = await Promise.all([
    supabase
      .from("episodes")
      .select(
        "id, series_id, episode_number, title, description, language, access_tier, coin_price, content_source, subject_area, grade_level, syllabus_topic, source_material_id, audio_url, duration_seconds, status",
      )
      .eq("id", id)
      .single(),
    loadEpisodeFormOptions(),
    supabase.from("episode_contributors").select("contributor_id, role").eq("episode_id", id),
  ]);

  if (episodeResult.error || !episodeResult.data) {
    notFound();
  }

  const existingLinks = (linksResult.data ?? []).map((link) => ({
    contributorId: link.contributor_id,
    role: link.role,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Edit Episode</h1>
      <EpisodeForm
        episode={episodeResult.data}
        seriesOptions={options.seriesOptions}
        sourceMaterialOptions={options.sourceMaterialOptions}
        contributorOptions={options.contributorOptions}
        existingLinks={existingLinks}
      />
      <PublishGuardPanel episodeId={episodeResult.data.id} status={episodeResult.data.status} />
    </div>
  );
}
