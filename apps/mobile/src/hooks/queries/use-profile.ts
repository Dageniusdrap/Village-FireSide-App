import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export type ProfileSummary = {
  displayName: string;
  coinBalance: number;
  isPremium: boolean;
  premiumExpiresAt: string | null;
};

export function profileQueryKey(userId: string | null) {
  return ["profile", userId] as const;
}

export function useProfile() {
  const session = useAuthStore((state) => state.session);

  return useQuery({
    queryKey: profileQueryKey(session?.user.id ?? null),
    enabled: session !== null,
    queryFn: async (): Promise<ProfileSummary> => {
      if (!session) {
        throw new Error("Cannot fetch profile without a signed-in session");
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, coin_balance, is_premium, premium_expires_at")
        .eq("id", session.user.id)
        .single();
      if (error) {
        throw error;
      }
      return {
        displayName: data.display_name,
        coinBalance: data.coin_balance,
        isPremium: data.is_premium,
        premiumExpiresAt: data.premium_expires_at,
      };
    },
  });
}
