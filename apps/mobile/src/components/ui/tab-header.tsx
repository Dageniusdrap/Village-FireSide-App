// apps/mobile/src/components/ui/tab-header.tsx
import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

export function TabHeader({ title }: { title: string }) {
  const router = useRouter();

  return (
    <ThemedView style={styles.row}>
      <ThemedText type="title">{title}</ThemedText>
      <Pressable
        onPress={() => router.push("/search")}
        hitSlop={Spacing.two}
        accessibilityRole="button"
        accessibilityLabel="Search"
      >
        <ThemedText type="title">🔍</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
});
