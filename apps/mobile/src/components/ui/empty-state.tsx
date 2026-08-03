import { Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

export function EmptyState({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {body}
      </ThemedText>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          hitSlop={Spacing.two}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <ThemedText type="default" themeColor="accent">
            Try again
          </ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.one,
    alignItems: "center",
  },
});
