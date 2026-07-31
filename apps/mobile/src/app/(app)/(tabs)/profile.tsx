import { useRouter } from "expo-router";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { useProfile } from "@/hooks/queries/use-profile";
import { useAuthStore } from "@/stores/auth-store";

export default function ProfileScreen() {
  const router = useRouter();
  const guestMode = useAuthStore((state) => state.guestMode);
  const signOut = useAuthStore((state) => state.signOut);
  const profileQuery = useProfile();
  const profile = profileQuery.data;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader title="Profile" />
        <ThemedText type="default">
          {guestMode ? "Browsing as Guest" : `Signed in as ${profile?.displayName ?? "…"}`}
        </ThemedText>

        {!guestMode ? (
          <ThemedView style={styles.coinsSection}>
            <ThemedText type="smallBold">🪙 {profile?.coinBalance ?? 0} coins</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {profile?.isPremium
                ? profile.premiumExpiresAt
                  ? `Premium until ${new Date(profile.premiumExpiresAt).toLocaleDateString()}`
                  : "Premium"
                : "Not premium"}
            </ThemedText>
            <Button
              label={profile?.isPremium ? "Manage Premium" : "Buy Coins / Go Premium"}
              variant="secondary"
              onPress={() => router.push("/coins")}
            />
          </ThemedView>
        ) : null}

        <Button label="Settings" variant="ghost" onPress={() => router.push("/settings")} />
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
  coinsSection: {
    gap: Spacing.one,
  },
});
