// apps/mobile/src/components/ui/mini-player.tsx
import { useSegments } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { BottomTabInset, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { usePlayerStore } from "@/stores/player-store";

export function MiniPlayer() {
  const theme = useTheme();
  // Cast away expo-router's typed-routes tuple union — this only needs a
  // plain membership check against the current route's segments.
  const segments = useSegments() as readonly string[];
  const insets = useSafeAreaInsets();
  const currentEpisode = usePlayerStore((state) => state.currentEpisode);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const play = usePlayerStore((state) => state.play);
  const pause = usePlayerStore((state) => state.pause);
  const expand = usePlayerStore((state) => state.expand);

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

  return (
    <Pressable style={[styles.container, { bottom: bottomOffset }]} onPress={expand}>
      <Card style={styles.card}>
        <View style={[styles.artworkPlaceholder, { backgroundColor: theme.accentSoft }]} />
        <ThemedText type="small" style={styles.title} numberOfLines={1}>
          {currentEpisode.title}
        </ThemedText>
        <Pressable
          onPress={() => (isPlaying ? pause() : play(currentEpisode))}
          hitSlop={Spacing.two}
        >
          <ThemedText type="default" themeColor="primary">
            {isPlaying ? "⏸" : "▶"}
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
  title: {
    flex: 1,
  },
});
