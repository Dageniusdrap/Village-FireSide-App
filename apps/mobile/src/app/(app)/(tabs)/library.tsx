import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";

export default function LibraryScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader title="Library" />
      <ThemedText type="default" themeColor="textSecondary" style={styles.empty}>
        Your favorites, downloads, and listening history will show up here.
      </ThemedText>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    padding: Spacing.four,
  },
  empty: {
    marginTop: Spacing.three,
  },
});
