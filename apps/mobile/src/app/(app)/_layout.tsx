import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";

import { NowPlayingOverlay } from "@/components/now-playing-overlay";
import { PlaybackToast } from "@/components/playback-toast";
import { UnlockSheetStub } from "@/components/unlock-sheet-stub";
import { MiniPlayer } from "@/components/ui/mini-player";

// AudioStatusDriver is deliberately NOT rendered here — it lives in the
// root layout (apps/mobile/src/app/_layout.tsx) instead, because it needs
// to stay mounted across navigation into the (auth) route group too (e.g.
// a guest tapping Sign In from the Now Playing overlay's bookmark prompt
// unmounts this entire (app) subtree). MiniPlayer/UnlockSheetStub/
// PlaybackToast/NowPlayingOverlay are legitimately (app)-only UI and stay
// here.
export default function AppLayout() {
  return (
    <View style={styles.container}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="series/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="contributor/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="cultural-group/[id]" options={{ headerShown: false }} />
      </Stack>
      <MiniPlayer />
      <UnlockSheetStub />
      <PlaybackToast />
      <NowPlayingOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
