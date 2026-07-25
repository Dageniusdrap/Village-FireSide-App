import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { ThemedView } from "@/components/themed-view";
import { useAuthListener } from "@/hooks/use-auth-listener";
import { useAuthStore } from "@/stores/auth-store";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useAuthListener();

  const loading = useAuthStore((state) => state.loading);
  const session = useAuthStore((state) => state.session);
  const guestMode = useAuthStore((state) => state.guestMode);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  const theme = colorScheme === "dark" ? DarkTheme : DefaultTheme;

  if (loading) {
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
      {(session || guestMode) && <Redirect href="/" />}
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
