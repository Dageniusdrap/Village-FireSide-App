import { useEffect, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export default function AppHomeScreen() {
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
        <ThemedText type="title">
          {guestMode ? "Browsing as Guest" : `Signed in as ${displayName ?? "…"}`}
        </ThemedText>
        <Pressable style={styles.button} onPress={() => void signOut()}>
          <ThemedText type="linkPrimary">{guestMode ? "Sign In" : "Sign Out"}</ThemedText>
        </Pressable>
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
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.four,
  },
  button: {
    padding: Spacing.three,
  },
});
