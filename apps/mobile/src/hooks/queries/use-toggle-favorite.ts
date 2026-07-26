import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";

import {
  favoriteQueryKey,
  resolveFavoriteTarget,
  type FavoriteTarget,
} from "@/lib/favorite-target";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

type ToggleVariables = { target: FavoriteTarget; isFavorited: boolean };
type ToggleContext = { key: QueryKey; previous: boolean | undefined };

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);

  const mutation = useMutation<void, Error, ToggleVariables, ToggleContext>({
    mutationFn: async ({ target, isFavorited }) => {
      if (!session) {
        // Every current call site wraps `toggle(...)` in `useRequireAuth`'s
        // `requireAuth(...)`, so this should be unreachable in practice —
        // but it must throw, not return, so `onMutate`'s optimistic flip
        // gets rolled back by `onError` instead of being left stuck.
        throw new Error("Cannot toggle a favorite without a signed-in session");
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
    onMutate: async ({ target, isFavorited }) => {
      const key = favoriteQueryKey(target, session?.user.id ?? null);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<boolean>(key);
      queryClient.setQueryData<boolean>(key, !isFavorited);
      return { key, previous };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: (_data, _error, { target }) => {
      void queryClient.invalidateQueries({
        queryKey: favoriteQueryKey(target, session?.user.id ?? null),
      });
    },
  });

  return {
    toggle: (target: FavoriteTarget, isFavorited: boolean) =>
      mutation.mutateAsync({ target, isFavorited }),
  };
}
