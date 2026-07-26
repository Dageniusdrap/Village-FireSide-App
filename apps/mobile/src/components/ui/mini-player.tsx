// apps/mobile/src/components/ui/mini-player.tsx
import { useAudioPlayerStatus } from "expo-audio";
import { useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { BottomTabInset, Spacing } from "@/constants/theme";
import { useRouteSegments } from "@/hooks/use-route-segments";
import { useTheme } from "@/hooks/use-theme";
import { audioPlayer } from "@/lib/audio-player";
import { usePlayerStore } from "@/stores/player-store";

export function MiniPlayer() {
  const theme = useTheme();
  const segments = useRouteSegments();
  const insets = useSafeAreaInsets();
  const currentEpisode = usePlayerStore((state) => state.currentEpisode);
  const playPause = usePlayerStore((state) => state.playPause);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const expand = usePlayerStore((state) => state.expand);
  const status = useAudioPlayerStatus(audioPlayer);
  const [trackWidth, setTrackWidth] = useState(0);

  if (!currentEpisode) {
    return null;
  }

  // MiniPlayer is rendered once, as a sibling of the (app) Stack, so it
  // persists across every screen the stack navigates to — including the
  // Series/Contributor/Cultural-Group detail routes, which have no tab bar
  // beneath them. `BottomTabInset` only makes sense above an actual tab
  // bar; elsewhere, rest just above the safe-area edge instead of leaving a
  // dead gap where the (nonexistent) tab bar would have been.
  const isInTabs = segments.includes("(tabs)");
  const bottomOffset = isInTabs ? BottomTabInset : insets.bottom + Spacing.two;
  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const handleTrackPress = (event: { nativeEvent: { locationX: number } }) => {
    if (trackWidth <= 0 || status.duration <= 0) {
      return;
    }
    const fraction = Math.min(1, Math.max(0, event.nativeEvent.locationX / trackWidth));
    seekTo(fraction * status.duration);
  };

  return (
    <Pressable style={[styles.container, { bottom: bottomOffset }]} onPress={expand}>
      <Card style={styles.card}>
        <View style={[styles.artworkPlaceholder, { backgroundColor: theme.accentSoft }]} />
        <View style={styles.body}>
          <ThemedText type="small" style={styles.title} numberOfLines={1}>
            {currentEpisode.title}
          </ThemedText>
          <Pressable style={styles.track} onLayout={handleTrackLayout} onPress={handleTrackPress}>
            <View style={[styles.trackBackground, { backgroundColor: theme.border }]} />
            <View
              style={[
                styles.trackFill,
                { backgroundColor: theme.accent, width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </Pressable>
        </View>
        <Pressable onPress={playPause} hitSlop={Spacing.two}>
          <ThemedText type="default" themeColor="primary">
            {status.playing ? "⏸" : "▶"}
          </ThemedText>
        </Pressable>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginHorizontal: Spacing.two,
    padding: Spacing.two,
  },
  artworkPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: Spacing.one,
  },
  body: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    flex: 1,
  },
  track: {
    height: 4,
    justifyContent: "center",
  },
  trackBackground: {
    height: 2,
    borderRadius: 1,
  },
  trackFill: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
  },
});
