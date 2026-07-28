import { FunctionsHttpError } from "@supabase/supabase-js";

import { getLocalDownloadPath } from "@/lib/local-downloads";
import { supabase } from "@/lib/supabase";

export type EpisodeSourceResult =
  | { type: "local"; path: string }
  | { type: "remote"; url: string }
  | { type: "locked" }
  | { type: "not_found" }
  | { type: "error" };

export async function resolveEpisodeSource(episodeId: string): Promise<EpisodeSourceResult> {
  const localPath = await getLocalDownloadPath(episodeId);
  if (localPath) {
    return { type: "local", path: localPath };
  }
  return resolveRemoteEpisodeSource(episodeId);
}

export async function resolveRemoteEpisodeSource(episodeId: string): Promise<EpisodeSourceResult> {
  const { data, error } = await supabase.functions.invoke<{ signedUrl: string; expiresIn: number }>(
    "get-episode-audio",
    { body: { episode_id: episodeId } },
  );

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context.status;
      if (status === 403) {
        return { type: "locked" };
      }
      if (status === 404) {
        return { type: "not_found" };
      }
    }
    return { type: "error" };
  }

  if (!data?.signedUrl) {
    return { type: "error" };
  }

  return { type: "remote", url: data.signedUrl };
}
