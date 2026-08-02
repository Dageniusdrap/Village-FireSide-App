// apps/mobile/src/hooks/queries/use-join-class.ts
import { useMutation } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

type JoinClassResult = { className: string };
type JoinClassRow = { class_id: string; class_name: string };

export function useJoinClass() {
  const mutation = useMutation<JoinClassResult, Error, { joinCode: string }>({
    mutationFn: async ({ joinCode }) => {
      const { data, error } = await supabase.rpc("join_class", { p_join_code: joinCode });
      if (error) {
        throw error;
      }
      const [row] = (data ?? []) as JoinClassRow[];
      if (!row) {
        throw new Error("join_class: no class found for that code");
      }
      return { className: row.class_name };
    },
  });

  return { joinClass: mutation.mutateAsync };
}
