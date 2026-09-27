"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import type { EpisodeInput } from "@/lib/validation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionResult = { ok: true } | { ok: false; message: string };

export type ContributorLink = { contributorId: string; role: string };

function toRow(input: EpisodeInput) {
  return {
    series_id: input.seriesId,
    episode_number: input.episodeNumber,
    title: input.title,
    description: input.description || null,
    language: input.language,
    access_tier: input.accessTier,
    coin_price: input.coinPrice,
    content_source: input.contentSource,
    subject_area: input.subjectArea || null,
    grade_level: input.gradeLevel || null,
    syllabus_topic: input.syllabusTopic || null,
    source_material_id: input.sourceMaterialId || null,
    audio_url: input.audioUrl || null,
    duration_seconds: input.durationSeconds ?? null,
  };
}

async function replaceContributorLinks(
  supabase: ReturnType<typeof createServiceRoleClient>,
  episodeId: string,
  links: ContributorLink[],
): Promise<{ error: string | null }> {
  const { error: deleteError } = await supabase
    .from("episode_contributors")
    .delete()
    .eq("episode_id", episodeId);
  if (deleteError) {
    return { error: deleteError.message };
  }
  if (links.length === 0) {
    return { error: null };
  }
  const { error: insertError } = await supabase.from("episode_contributors").insert(
    links.map((link) => ({
      episode_id: episodeId,
      contributor_id: link.contributorId,
      role: link.role,
    })),
  );
  return { error: insertError?.message ?? null };
}

export async function createEpisode(
  input: EpisodeInput,
  contributorLinks: ContributorLink[],
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("episodes")
    .insert(toRow(input))
    .select("id")
    .single();
  if (error) {
    return { ok: false, message: error.message };
  }

  const linkResult = await replaceContributorLinks(supabase, data.id, contributorLinks);
  if (linkResult.error) {
    return { ok: false, message: linkResult.error };
  }

  await logAdminAction(admin.adminId, "create", "episode", data.id, { title: input.title });
  revalidatePath("/episodes");
  return { ok: true };
}

export async function updateEpisode(
  id: string,
  input: EpisodeInput,
  contributorLinks: ContributorLink[],
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("episodes").update(toRow(input)).eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  const linkResult = await replaceContributorLinks(supabase, id, contributorLinks);
  if (linkResult.error) {
    return { ok: false, message: linkResult.error };
  }

  await logAdminAction(admin.adminId, "update", "episode", id, { title: input.title });
  revalidatePath("/episodes");
  return { ok: true };
}

export async function deleteEpisode(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("episodes").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "delete", "episode", id);
  revalidatePath("/episodes");
  return { ok: true };
}
