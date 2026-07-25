import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { getSourceBadgeContent } from "@/lib/source-badge";
import type { ContentSource } from "@/types/content";

export function SourceBadge({ source }: { source: ContentSource }) {
  const theme = useTheme();
  const { label, variant } = getSourceBadgeContent(source);
  const backgroundColor = variant === "gold" ? theme.gold : theme.accentSoft;
  const textColor = variant === "gold" ? "#3A2A1E" : theme.textSecondary;

  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <ThemedText type="small" style={{ color: textColor }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});
