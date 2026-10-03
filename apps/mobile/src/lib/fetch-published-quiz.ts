import { supabase } from "@/lib/supabase";

export async function fetchPublishedQuiz(episodeId: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("quizzes")
    .select("id")
    .eq("episode_id", episodeId)
    .eq("is_published", true)
    .maybeSingle();
  if (error) {
    console.error("fetchPublishedQuiz error:", error);
    return null;
  }
  return data;
}
