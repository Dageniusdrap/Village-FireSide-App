import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Lora_600SemiBold } from "@expo-google-fonts/lora";
import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Slot, ThemeProvider, useRouter } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { AudioStatusDriver } from "@/components/audio-status-driver";
import { ThemedView } from "@/components/themed-view";
import { useAuthListener } from "@/hooks/use-auth-listener";
import { useConfigureAudioMode } from "@/hooks/use-configure-audio-mode";
import { useConfigurePurchases } from "@/hooks/use-configure-purchases";
import { useRecoveryLinkHandler } from "@/hooks/use-recovery-link-handler";
import { useRouteSegments } from "@/hooks/use-route-segments";
import { useSyncPurchasesIdentity } from "@/hooks/use-sync-purchases-identity";
import { resolveAuthRedirect } from "@/lib/auth-redirect";
import { queryClient } from "@/lib/query-client";
import { useAuthStore } from "@/stores/auth-store";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useRouteSegments();
  useAuthListener();
  useRecoveryLinkHandler();
  useConfigureAudioMode();
  useConfigurePurchases();
  useSyncPurchasesIdentity();

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Lora_600SemiBold,
  });

  const loading = useAuthStore((state) => state.loading);
  const session = useAuthStore((state) => state.session);
  const guestMode = useAuthStore((state) => state.guestMode);
  const passwordRecovery = useAuthStore((state) => state.passwordRecovery);

  useEffect(() => {
    if (!loading && fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [loading, fontsLoaded]);

  // Route-guard as an effect gated on `segments`, not an unconditionally
  // rendered <Redirect>: a bare <Redirect href="/"> re-fires on every
  // re-render of this layout (expo-router's Redirect wraps a fresh
  // useFocusEffect callback each render, so its dependency array never
  // settles) — including re-renders this layout receives for reasons
  // unrelated to auth (a token-refresh replacing the `session` object, a
  // colorScheme change). With the Slot-only layout that was invisible; once
  // (app) got a <Stack> with real drill-down screens, it meant a signed-in
  // user reading a Series/Contributor/Cultural-Group screen could get
  // silently bounced back to Home. `resolveAuthRedirect` (tested in
  // isolation) makes the navigation a no-op whenever the user is already
  // somewhere valid — including a guest who deliberately navigated to
  // /sign-in from a SignInPromptSheet.
  useEffect(() => {
    if (loading || !fontsLoaded) {
      return;
    }
    const href = resolveAuthRedirect({
      session: session !== null,
      guestMode,
      passwordRecovery,
      segments,
    });
    if (href) {
      router.replace(href);
    }
  }, [loading, fontsLoaded, session, guestMode, passwordRecovery, segments, router]);

  const theme = colorScheme === "dark" ? DarkTheme : DefaultTheme;

  if (loading || !fontsLoaded) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={theme}>
          <ThemedView style={styles.loadingContainer}>
            <ActivityIndicator />
          </ThemedView>
          <AudioStatusDriver />
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={theme}>
        <AnimatedSplashOverlay />
        <Slot />
        <AudioStatusDriver />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
