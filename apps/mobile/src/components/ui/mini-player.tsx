// apps/mobile/src/components/ui/mini-player.tsx
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { BottomTabInset, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { usePlayerStore } from "@/stores/player-store";

export function MiniPlayer() {
  const theme = useTheme();
  const currentEpisode = usePlayerStore((state) => state.currentEpisode);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const play = usePlayerStore((state) => state.play);
  const pause = usePlayerStore((state) => state.pause);
  const expand = usePlayerStore((state) => state.expand);

  if (!currentEpisode) {
    return null;
  }

  return (
    <Pressable style={[styles.container, { bottom: BottomTabInset }]} onPress={expand}>
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
