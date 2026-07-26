// apps/mobile/src/app/(auth)/welcome.tsx
import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useAuthStore } from "@/stores/auth-store";

export default function WelcomeScreen() {
  const router = useRouter();
  const continueAsGuest = useAuthStore((state) => state.continueAsGuest);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Village Fireside</ThemedText>
        <ThemedText type="default">Stories, told by the people who lived them.</ThemedText>

        <Pressable style={styles.primaryButton} onPress={() => router.push("/sign-in")}>
          <ThemedText type="default" themeColor="background">
            Sign In
          </ThemedText>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={() => router.push("/sign-up")}>
          <ThemedText type="linkPrimary">Create Account</ThemedText>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            continueAsGuest();
            router.replace("/");
          }}
        >
          <ThemedText type="link">Continue as Guest</ThemedText>
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
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  primaryButton: {
    alignSelf: "stretch",
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    marginTop: Spacing.four,
  },
  secondaryButton: {
    paddingVertical: Spacing.two,
  },
});
