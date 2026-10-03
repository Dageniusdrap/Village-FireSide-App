import { useMutation, useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
};

export type QuizDetail = {
  id: string;
  questions: QuizQuestion[];
};

type QuizRow = { id: string };
type QuestionRow = {
  id: string;
  question: string;
  options: unknown;
  correct_index: number;
  explanation: string | null;
  sort_order: number;
};

function parseOptions(options: unknown): string[] {
  return Array.isArray(options)
    ? options.filter((item): item is string => typeof item === "string")
    : [];
}

export function useQuizDetail(episodeId: string) {
  return useQuery({
    queryKey: ["quiz-detail", episodeId],
    enabled: Boolean(episodeId),
    queryFn: async (): Promise<QuizDetail | null> => {
      const { data: quizRow, error: quizError } = await supabase
        .from("quizzes")
        .select("id")
        .eq("episode_id", episodeId)
        .eq("is_published", true)
        .maybeSingle()
        .returns<QuizRow | null>();
      if (quizError) {
        throw quizError;
      }
      if (!quizRow) {
        return null;
      }

      const { data: questionRows, error: questionsError } = await supabase
        .from("quiz_questions")
        .select("id, question, options, correct_index, explanation, sort_order")
        .eq("quiz_id", quizRow.id)
        .order("sort_order", { ascending: true })
        .returns<QuestionRow[]>();
      if (questionsError) {
        throw questionsError;
      }

      return {
        id: quizRow.id,
        questions: questionRows.map((row) => ({
          id: row.id,
          question: row.question,
          options: parseOptions(row.options),
          correctIndex: row.correct_index,
          explanation: row.explanation,
        })),
      };
    },
  });
}

export function useSubmitQuizAttempt(quizId: string) {
  const session = useAuthStore((state) => state.session);

  const mutation = useMutation<void, Error, { score: number; total: number }>({
    mutationFn: async ({ score, total }) => {
      if (!session) {
        throw new Error("Not signed in");
      }
      const { error } = await supabase.from("quiz_attempts").insert({
        user_id: session.user.id,
        quiz_id: quizId,
        score,
        total,
      });
      if (error) {
        throw error;
      }
    },
  });

  return { submitAttempt: mutation.mutateAsync };
}
