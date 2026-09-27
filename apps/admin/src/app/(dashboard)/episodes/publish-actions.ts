"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

import {
  type ContributorConsentInfo,
  checkPublishRequirements,
  type PublishCheck,
} from "./check-publish-requirements";

export type ActionResult = { ok: true } | { ok: false; message: string };

type EpisodeContributorRow = {
  contributors: { contributor_type: string } | null;
};

type ConsentRow = { contributor_id: string; consent_status: string; created_at: string };

async function loadPublishCheckInputs(
  supabase: ReturnType<typeof createServiceRoleClient>,
  episodeId: string,
): Promise<
  | {
      ok: true;
      episode: {
        audioUrl: string | null;
        title: string;
        description: string | null;
        contentSource: string;
      };
      linkedContributors: ContributorConsentInfo[];
    }
  | { ok: false; message: string }
> {
  const { data: episode, error: episodeError } = await supabase
    .from("episodes")
    .select("audio_url, title, description, content_source")
    .eq("id", episodeId)
    .single();
  if (episodeError || !episode) {
    return { ok: false, message: episodeError?.message ?? "Episode not found." };
  }

  const { data: links, error: linksError } = await supabase
    .from("episode_contributors")
    .select("contributor_id, contributors(contributor_type)")
    .eq("episode_id", episodeId)
    .returns<(EpisodeContributorRow & { contributor_id: string })[]>();
  if (linksError) {
    return { ok: false, message: linksError.message };
  }

  const contributorIds = links.map((link) => link.contributor_id);
  let consentsByContributor = new Map<string, string[]>();
  if (contributorIds.length > 0) {
    // `consents` has no unique constraint on (contributor_id, consent_type)
    // and no updated_at — a "revoke" can land as a brand-new row rather
    // than an in-place status change, so multiple rows can genuinely
    // exist for the same contributor+type over time. Ordering by
    // created_at desc and keeping only the FIRST (most recent) row per
    // contributor is load-bearing: without it, a contributor whose
    // consent was later revoked would still show a historical "granted"
    // entry, and checkPublishRequirements' `.includes("granted")` check
    // (Task 12) would incorrectly treat them as currently consented.
    const { data: consents, error: consentsError } = await supabase
      .from("consents")
      .select("contributor_id, consent_status, created_at")
      .eq("consent_type", "story_recording")
      .in("contributor_id", contributorIds)
      .order("created_at", { ascending: false })
      .returns<ConsentRow[]>();
    if (consentsError) {
      return { ok: false, message: consentsError.message };
    }
    for (const row of consents) {
      if (!consentsByContributor.has(row.contributor_id)) {
        consentsByContributor.set(row.contributor_id, [row.consent_status]);
      }
    }
  }

  const linkedContributors: ContributorConsentInfo[] = links.map((link) => ({
    contributorType: link.contributors?.contributor_type ?? "",
    consentStatuses: consentsByContributor.get(link.contributor_id) ?? [],
  }));

  return {
    ok: true,
    episode: {
      audioUrl: episode.audio_url,
      title: episode.title,
      description: episode.description,
      contentSource: episode.content_source,
    },
    linkedContributors,
  };
}

export async function validateEpisodeForPublish(episodeId: string): Promise<PublishCheck[]> {
  const supabase = createServiceRoleClient();
  const inputs = await loadPublishCheckInputs(supabase, episodeId);
  if (!inputs.ok) {
    return [{ label: "Load episode data", passed: false, reason: inputs.message }];
  }
  return checkPublishRequirements(inputs.episode, inputs.linkedContributors);
}

export async function publishEpisode(episodeId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const inputs = await loadPublishCheckInputs(supabase, episodeId);
  if (!inputs.ok) {
    return { ok: false, message: inputs.message };
  }
  const checks = checkPublishRequirements(inputs.episode, inputs.linkedContributors);
  const failedCheck = checks.find((check) => !check.passed);
  if (failedCheck) {
    return { ok: false, message: failedCheck.reason ?? `Failed check: ${failedCheck.label}` };
  }

  const { error } = await supabase
    .from("episodes")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", episodeId);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "publish", "episode", episodeId);
  revalidatePath("/episodes");
  return { ok: true };
}

export async function unpublishEpisode(episodeId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("episodes").update({ status: "draft" }).eq("id", episodeId);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "unpublish", "episode", episodeId);
  revalidatePath("/episodes");
  return { ok: true };
}
