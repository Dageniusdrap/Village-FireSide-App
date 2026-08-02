import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/queries/use-profile";

export function useAppSetting<T>(key: string) {
  return useQuery({
    queryKey: ["app-settings", key],
    queryFn: async (): Promise<T> => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", key)
        .single();
      if (error) {
        throw error;
      }
      return data.value as T;
    },
  });
}

// A guest, or a signed-in user with no known country, fails CLOSED —
// cultural-group browsing stays hidden rather than guessing from device
// locale. This matters given Prompt 3B's own stated rationale: ethnic
// categorization is legally sensitive per-country (e.g. Rwanda), so
// showing it by default anywhere the country is unknown is the wrong
// direction to guess in.
export function useCulturalGroupsEnabled(): boolean {
  const profile = useProfile();
  const setting = useAppSetting<string[]>("cultural_groups_enabled_countries");

  if (!profile.data?.country || !setting.data) {
    return false;
  }
  return setting.data.includes(profile.data.country);
}
