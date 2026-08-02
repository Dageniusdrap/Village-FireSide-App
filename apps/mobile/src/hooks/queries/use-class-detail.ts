// apps/mobile/src/hooks/queries/use-class-detail.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

export type AssignedEpisode = {
  episodeId: string;
  title: string;
  listenerCount: number;
};

type ClassRow = { id: string; name: string; join_code: string };
type AssignmentRow = { episode_id: string; episodes: { title: string } | null };
type ListenCountRow = { episode_id: string; listener_count: number };

export function useClassDetail(classId: string) {
  return useQuery({
    queryKey: ["class-detail", classId],
    enabled: Boolean(classId),
    queryFn: async (): Promise<{
      id: string;
      name: string;
      joinCode: string;
      assignedEpisodes: AssignedEpisode[];
    }> => {
      const { data: classRow, error: classError } = await supabase
        .from("classes")
        .select("id, name, join_code")
        .eq("id", classId)
        .single()
        .returns<ClassRow>();
      if (classError) {
        throw classError;
      }

      const { data: assignmentRows, error: assignmentError } = await supabase
        .from("class_assignments")
        .select("episode_id, episodes(title)")
        .eq("class_id", classId)
        .returns<AssignmentRow[]>();
      if (assignmentError) {
        throw assignmentError;
      }

      const { data: countRows, error: countError } = await supabase.rpc(
        "class_episode_listen_counts",
        { p_class_id: classId },
      );
      if (countError) {
        throw countError;
      }
      const countsByEpisode = new Map(
        ((countRows ?? []) as ListenCountRow[]).map((row) => [row.episode_id, row.listener_count]),
      );

      return {
        id: classRow.id,
        name: classRow.name,
        joinCode: classRow.join_code,
        assignedEpisodes: assignmentRows
          .filter(
            (row): row is AssignmentRow & { episodes: { title: string } } => row.episodes !== null,
          )
          .map((row) => ({
            episodeId: row.episode_id,
            title: row.episodes.title,
            listenerCount: countsByEpisode.get(row.episode_id) ?? 0,
          })),
      };
    },
  });
}

export function useAssignEpisode(classId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation<void, Error, { episodeId: string }>({
    mutationFn: async ({ episodeId }) => {
      const { error } = await supabase
        .from("class_assignments")
        .insert({ class_id: classId, episode_id: episodeId });
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["class-detail", classId] });
    },
  });

  return { assignEpisode: mutation.mutateAsync };
}
