import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

type EpisodeContributorLinkRow = { contributor_id: string };
type PublicContributorRow = { display_name: string };

/**
 * An episode can have several contributors; only the first linked row is
 * shown, matching the prompt pack's single-name "Told by Jajja Nakato of
 * Masaka" example. No linked row (or a row hidden by public_contributors'
 * own visibility rules) resolves to `null` — the caller omits the line
 * entirely rather than rendering it empty.
 */
export function useEpisodeContributor(episodeId: string | null) {
  return useQuery({
    queryKey: ["episode-contributor", episodeId],
    enabled: Boolean(episodeId),
    queryFn: async (): Promise<string | null> => {
      const { data: links, error: linksError } = await supabase
        .from("episode_contributors")
        .select("contributor_id")
        .eq("episode_id", episodeId as string)
        .limit(1)
        .returns<EpisodeContributorLinkRow[]>();
      if (linksError) {
        throw linksError;
      }
      const firstLink = links[0];
      if (!firstLink) {
        return null;
      }

      const { data: contributor, error: contributorError } = await supabase
        .from("public_contributors")
        .select("display_name")
        .eq("id", firstLink.contributor_id)
        .maybeSingle()
        .returns<PublicContributorRow | null>();
      if (contributorError) {
        throw contributorError;
      }
      return contributor?.display_name ?? null;
    },
  });
}
