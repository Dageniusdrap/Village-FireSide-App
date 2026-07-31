import { StyleSheet, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BackButton } from "@/components/ui/back-button";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { useSettingsStore } from "@/stores/settings-store";

export default function SettingsScreen() {
  const wifiOnlyDownloads = useSettingsStore((state) => state.wifiOnlyDownloads);
  const setWifiOnlyDownloads = useSettingsStore((state) => state.setWifiOnlyDownloads);

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <SectionHeader title="Settings" />
      <ThemedView style={styles.row}>
        <ThemedView style={styles.rowText}>
          <ThemedText type="default">Download over Wi-Fi only</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Protects your data bundle. Downloads wait for Wi-Fi when this is on.
          </ThemedText>
        </ThemedView>
        <Switch value={wifiOnlyDownloads} onValueChange={setWifiOnlyDownloads} />
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
