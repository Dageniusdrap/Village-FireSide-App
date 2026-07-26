import { useMutation, useQueryClient } from "@tanstack/react-query";

import { resolveFavoriteTarget, type FavoriteTarget } from "@/lib/favorite-target";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);

  const mutation = useMutation({
    mutationFn: async ({
      target,
      isFavorited,
    }: {
      target: FavoriteTarget;
      isFavorited: boolean;
    }) => {
      if (!session) {
        return;
      }
      const row = resolveFavoriteTarget(target);
      if (isFavorited) {
        // Only the one non-null FK column identifies the favorite row.
        // Supabase's `.match()` turns every key (including the two null
        // FK columns) into an `eq` filter, and PostgREST requires `is.null`
        // rather than `eq.null` for null comparisons — so passing the null
        // columns through would match zero rows. Filter them out first.
        const nonNullRow = Object.fromEntries(
          Object.entries(row).filter(([, value]) => value !== null),
        ) as Record<string, string>;
        const { error } = await supabase
          .from("favorites")
          .delete()
          .match({ user_id: session.user.id, ...nonNullRow });
        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({ user_id: session.user.id, ...row });
        // The favorites table enforces uniqueness per (user_id, target) via
        // partial unique indexes (one per nullable FK column). PostgREST's
        // upsert `on_conflict` inference does not work against partial
        // indexes (it can't express the index's WHERE predicate), so we
        // can't use `.upsert()` here. Instead, treat a duplicate-favorite
        // unique violation (23505) as a harmless no-op rather than an error.
        if (error && error.code !== "23505") {
          throw error;
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  return {
    toggle: (target: FavoriteTarget, isFavorited: boolean) =>
      mutation.mutateAsync({ target, isFavorited }),
  };
}
