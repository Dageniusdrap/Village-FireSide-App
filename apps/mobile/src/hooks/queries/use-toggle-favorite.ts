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
        const { error } = await supabase
          .from("favorites")
          .delete()
          .match({ user_id: session.user.id, ...row });
        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({ user_id: session.user.id, ...row });
        if (error) {
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
