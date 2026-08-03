import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";

import { ErrorBoundary } from "@/components/error-boundary";
import { NowPlayingOverlay } from "@/components/now-playing-overlay";
import { PlaybackToast } from "@/components/playback-toast";
import { UnlockSheet } from "@/components/unlock-sheet";
import { MiniPlayer } from "@/components/ui/mini-player";

// AudioStatusDriver is deliberately NOT rendered here — it lives in the
// root layout (apps/mobile/src/app/_layout.tsx) instead, because it needs
// to stay mounted across navigation into the (auth) route group too (e.g.
// a guest tapping Sign In from the Now Playing overlay's bookmark prompt
// unmounts this entire (app) subtree). MiniPlayer/UnlockSheet/
// PlaybackToast/NowPlayingOverlay are legitimately (app)-only UI and stay
// here.
export default function AppLayout() {
  return (
    <ErrorBoundary>
      <View style={styles.container}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="search" options={{ headerShown: false }} />
          <Stack.Screen name="series/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="contributor/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="cultural-group/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="destination/[slug]" options={{ headerShown: false }} />
          <Stack.Screen name="destination/[slug]/inquire" options={{ headerShown: false }} />
          <Stack.Screen name="episode/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="learn/[subject]" options={{ headerShown: false }} />
          <Stack.Screen name="learn/teacher-request" options={{ headerShown: false }} />
          <Stack.Screen name="learn/teacher" options={{ headerShown: false }} />
          <Stack.Screen name="learn/teacher/class/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="learn/join-class" options={{ headerShown: false }} />
          <Stack.Screen name="coins" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
        </Stack>
        <MiniPlayer />
        <UnlockSheet />
        <PlaybackToast />
        <NowPlayingOverlay />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
