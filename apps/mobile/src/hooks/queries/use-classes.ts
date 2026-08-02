// apps/mobile/src/hooks/queries/use-classes.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export type TeacherClass = {
  id: string;
  name: string;
  joinCode: string;
  createdAt: string;
};

type ClassRow = {
  id: string;
  name: string;
  join_code: string;
  created_at: string;
};

function classesQueryKey(teacherId: string | null) {
  return ["classes", teacherId] as const;
}

export function useClasses() {
  const session = useAuthStore((state) => state.session);

  return useQuery({
    queryKey: classesQueryKey(session?.user.id ?? null),
    enabled: session !== null,
    queryFn: async (): Promise<TeacherClass[]> => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, join_code, created_at")
        .order("created_at", { ascending: false })
        .returns<ClassRow[]>();
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        id: row.id,
        name: row.name,
        joinCode: row.join_code,
        createdAt: row.created_at,
      }));
    },
  });
}

export function useCreateClass() {
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);

  const mutation = useMutation<void, Error, { name: string }>({
    mutationFn: async ({ name }) => {
      if (!session) {
        throw new Error("Cannot create a class without a signed-in session");
      }
      // join_code has a `default` expression (supabase/migrations/
      // 20260802100000_teacher_requests_and_classes_tables.sql) — never
      // supplied here. A collision (23505 on the unique constraint) is
      // astronomically unlikely at pilot scale, but retried once anyway,
      // same discipline use-toggle-favorite.ts already applies to its
      // own unique-violation case.
      const attemptInsert = () =>
        supabase.from("classes").insert({ teacher_id: session.user.id, name });

      const first = await attemptInsert();
      if (first.error && first.error.code === "23505") {
        const retry = await attemptInsert();
        if (retry.error) {
          throw retry.error;
        }
        return;
      }
      if (first.error) {
        throw first.error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classesQueryKey(session?.user.id ?? null) });
    },
  });

  return { createClass: mutation.mutateAsync };
}
