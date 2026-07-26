import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Lora_600SemiBold } from "@expo-google-fonts/lora";
import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { ThemedView } from "@/components/themed-view";
import { useAuthListener } from "@/hooks/use-auth-listener";
import { useRecoveryLinkHandler } from "@/hooks/use-recovery-link-handler";
import { useAuthStore } from "@/stores/auth-store";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useAuthListener();
  useRecoveryLinkHandler();

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

  const theme = colorScheme === "dark" ? DarkTheme : DefaultTheme;

  if (loading || !fontsLoaded) {
    return (
      <ThemeProvider value={theme}>
        <ThemedView style={styles.loadingContainer}>
          <ActivityIndicator />
        </ThemedView>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={theme}>
      <AnimatedSplashOverlay />
      {!session && !guestMode && <Redirect href="/welcome" />}
      {session && passwordRecovery && <Redirect href="/reset-password" />}
      {session && !passwordRecovery && <Redirect href="/" />}
      {!session && guestMode && <Redirect href="/" />}
      <Slot />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
