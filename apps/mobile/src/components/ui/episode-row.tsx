// apps/mobile/src/components/ui/episode-row.tsx
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { SourceBadge } from "@/components/ui/source-badge";
import { Spacing } from "@/constants/theme";
import type { AccessTier, ContentSource } from "@/types/content";

function formatDuration(durationSeconds: number | null): string {
  if (durationSeconds === null) {
    return "—";
  }
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function EpisodeRow({
  title,
  durationSeconds,
  accessTier,
  contentSource,
  onPress,
}: {
  title: string;
  durationSeconds: number | null;
  accessTier: AccessTier;
  contentSource: ContentSource;
  onPress?: () => void;
}) {
  const isLocked = accessTier !== "free";

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <ThemedText type="default" themeColor="primary" style={styles.playIcon}>
        ▶
      </ThemedText>
      <View style={styles.info}>
        <ThemedText type="default">{title}</ThemedText>
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDuration(durationSeconds)}
          </ThemedText>
          <SourceBadge source={contentSource} />
        </View>
      </View>
      <ThemedText type="small" themeColor={isLocked ? "textSecondary" : "primary"}>
        {isLocked ? "🔒" : "Free"}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  playIcon: {
    width: Spacing.four,
    textAlign: "center",
  },
  info: {
    flex: 1,
    gap: Spacing.one,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
});
