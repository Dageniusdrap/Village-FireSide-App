// apps/mobile/src/components/ui/episode-row.tsx
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { SourceBadge } from "@/components/ui/source-badge";
import { Spacing } from "@/constants/theme";
import { formatDuration } from "@/lib/format-duration";
import type { AccessTier, ContentSource } from "@/types/content";

function lockLabel(accessTier: AccessTier, coinPrice: number | undefined): string {
  if (accessTier === "premium") {
    return "★ Premium";
  }
  if (accessTier === "coins" && coinPrice !== undefined) {
    return `🪙 ${coinPrice}`;
  }
  return "🔒";
}

export function EpisodeRow({
  title,
  durationSeconds,
  accessTier,
  contentSource,
  coinPrice,
  resumePositionSeconds,
  onPress,
}: {
  title: string;
  durationSeconds: number | null;
  accessTier: AccessTier;
  contentSource: ContentSource;
  coinPrice?: number;
  resumePositionSeconds?: number | null;
  onPress?: () => void;
}) {
  const isLocked = accessTier !== "free";

  return (
    <Pressable style={styles.row} onPress={onPress} disabled={!onPress}>
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
          {resumePositionSeconds ? (
            <ThemedText type="small" themeColor="accent">
              Resume at {formatDuration(resumePositionSeconds)}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <ThemedText type="small" themeColor={isLocked ? "textSecondary" : "primary"}>
        {isLocked ? lockLabel(accessTier, coinPrice) : "Free"}
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
