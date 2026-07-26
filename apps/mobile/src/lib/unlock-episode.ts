import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export type UnlockEpisodeResult =
  | { type: "unlocked" }
  | { type: "insufficient_coins"; balance: number; price: number }
  | { type: "not_coin_gated" }
  | { type: "not_found" }
  | { type: "unauthorized" }
  | { type: "error" };

export async function unlockEpisode(episodeId: string): Promise<UnlockEpisodeResult> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean }>("unlock-episode", {
    body: { episode_id: episodeId },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context.status;
      if (status === 402) {
        const body = await error.context.json().catch(() => null);
        return {
          type: "insufficient_coins",
          balance: typeof body?.balance === "number" ? body.balance : 0,
          price: typeof body?.price === "number" ? body.price : 0,
        };
      }
      if (status === 400) {
        return { type: "not_coin_gated" };
      }
      if (status === 404) {
        return { type: "not_found" };
      }
      if (status === 401) {
        return { type: "unauthorized" };
      }
    }
    return { type: "error" };
  }

  if (!data?.ok) {
    return { type: "error" };
  }

  return { type: "unlocked" };
}
