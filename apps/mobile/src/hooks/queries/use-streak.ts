import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export type Streak = { currentStreak: number; longestStreak: number };

type StreakRow = { current_streak: number; longest_streak: number };

export function useStreak() {
  const session = useAuthStore((state) => state.session);

  return useQuery({
    queryKey: ["streak", session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async (): Promise<Streak> => {
      if (!session) {
        return { currentStreak: 0, longestStreak: 0 };
      }
      const { data, error } = await supabase
        .from("listener_streaks")
        .select("current_streak, longest_streak")
        .eq("user_id", session.user.id)
        .maybeSingle()
        .returns<StreakRow | null>();
      if (error) {
        throw error;
      }
      if (!data) {
        return { currentStreak: 0, longestStreak: 0 };
      }
      return { currentStreak: data.current_streak, longestStreak: data.longest_streak };
    },
  });
}
