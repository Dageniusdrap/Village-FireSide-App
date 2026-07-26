import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export default function ProfileScreen() {
  const session = useAuthStore((state) => state.session);
  const guestMode = useAuthStore((state) => state.guestMode);
  const signOut = useAuthStore((state) => state.signOut);

  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      // Resetting local state to match the absence of a session, not a cascading render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayName(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) {
          setDisplayName(data?.display_name ?? null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader title="Profile" />
        <ThemedText type="default">
          {guestMode ? "Browsing as Guest" : `Signed in as ${displayName ?? "…"}`}
        </ThemedText>
        <Button
          label={guestMode ? "Sign In" : "Sign Out"}
          variant="ghost"
          onPress={() => void signOut()}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
