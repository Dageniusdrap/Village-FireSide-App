// apps/mobile/src/hooks/queries/use-create-bookmark.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

type CreateBookmarkVariables = { episodeId: string; positionSeconds: number; note: string | null };

export function useCreateBookmark() {
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);

  const mutation = useMutation<void, Error, CreateBookmarkVariables>({
    mutationFn: async ({ episodeId, positionSeconds, note }) => {
      if (!session) {
        // Every call site wraps this in useRequireAuth's requireAuth(...),
        // so this should be unreachable in practice.
        throw new Error("Cannot bookmark an episode without a signed-in session");
      }
      const { error } = await supabase.from("episode_bookmarks").insert({
        user_id: session.user.id,
        episode_id: episodeId,
        position_seconds: Math.floor(positionSeconds),
        note,
      });
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookmarks", session?.user.id ?? null] });
    },
  });

  return { createBookmark: mutation.mutateAsync };
}
