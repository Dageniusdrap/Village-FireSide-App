import { useQuery } from "@tanstack/react-query";

import {
  favoriteQueryKey,
  resolveFavoriteTarget,
  type FavoriteTarget,
} from "@/lib/favorite-target";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export function useIsFavorited(target: FavoriteTarget) {
  const session = useAuthStore((state) => state.session);
  const row = resolveFavoriteTarget(target);
  const [column, value] =
    row.episode_id !== null
      ? (["episode_id", row.episode_id] as const)
      : row.series_id !== null
        ? (["series_id", row.series_id] as const)
        : (["destination_id", row.destination_id as string] as const);

  return useQuery({
    queryKey: favoriteQueryKey(target),
    enabled: session !== null,
    queryFn: async () => {
      if (!session) {
        return false;
      }
      const { data, error } = await supabase
        .from("favorites")
        .select("id")
        .eq("user_id", session.user.id)
        .eq(column, value)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data !== null;
    },
  });
}
