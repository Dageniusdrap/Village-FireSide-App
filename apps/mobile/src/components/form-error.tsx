import { StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

export function FormError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <ThemedText type="small" themeColor="text" style={styles.error}>
      {message}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  error: {
    color: "#C0392B",
    marginTop: Spacing.one,
  },
});
