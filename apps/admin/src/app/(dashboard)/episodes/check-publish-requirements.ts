export type PublishCheck = { label: string; passed: boolean; reason?: string };

export type EpisodeForPublishCheck = {
  audioUrl: string | null;
  title: string;
  description: string | null;
  contentSource: string;
};

export type ContributorConsentInfo = {
  contributorType: string;
  /** consent_status values for this contributor's story_recording consents only. */
  consentStatuses: string[];
};

// Pure decision logic, kept separate from the Supabase fetch that
// assembles `linkedContributors` so it can be unit tested directly —
// mirrors this codebase's applyListeningTick/resolveResumePosition
// precedent of extracting pure logic away from I/O.
export function checkPublishRequirements(
  episode: EpisodeForPublishCheck,
  linkedContributors: ContributorConsentInfo[],
): PublishCheck[] {
  const checks: PublishCheck[] = [];

  const hasAudio = episode.audioUrl !== null && episode.audioUrl.length > 0;
  checks.push({
    label: "Audio file uploaded",
    passed: hasAudio,
    reason: hasAudio ? undefined : "No audio file has been uploaded for this episode.",
  });

  const hasTitleAndDescription =
    episode.title.trim().length > 0 && (episode.description ?? "").trim().length > 0;
  checks.push({
    label: "Title and description present",
    passed: hasTitleAndDescription,
    reason: hasTitleAndDescription
      ? undefined
      : "Both a title and a description are required before publishing.",
  });

  if (episode.contentSource === "elder_testimony") {
    const hasGrantedElderConsent = linkedContributors.some(
      (contributor) =>
        contributor.contributorType === "elder" && contributor.consentStatuses.includes("granted"),
    );
    checks.push({
      label: "Elder testimony consent",
      passed: hasGrantedElderConsent,
      reason: hasGrantedElderConsent
        ? undefined
        : "This episode is marked as elder testimony but has no linked elder contributor with a granted story_recording consent. Link an elder contributor and record their consent before publishing.",
    });
  }

  return checks;
}
