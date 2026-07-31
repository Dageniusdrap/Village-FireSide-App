import { StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useNetworkStatus } from "@/hooks/use-network-status";

export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();

  if (isConnected !== false) {
    return null;
  }

  return (
    <ThemedView style={styles.banner}>
      <ThemedText type="small" style={styles.text}>
        You&apos;re offline — playing downloaded episodes only.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
  },
  text: {
    color: "#FFFFFF",
  },
});
