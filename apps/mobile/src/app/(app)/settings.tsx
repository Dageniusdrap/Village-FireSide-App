import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BackButton } from "@/components/ui/back-button";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { profileQueryKey, useProfile } from "@/hooks/queries/use-profile";
import { COUNTRY_CODES } from "@/lib/phone";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";

export default function SettingsScreen() {
  const wifiOnlyDownloads = useSettingsStore((state) => state.wifiOnlyDownloads);
  const setWifiOnlyDownloads = useSettingsStore((state) => state.setWifiOnlyDownloads);
  const session = useAuthStore((state) => state.session);
  const queryClient = useQueryClient();
  const profile = useProfile();
  const [isSavingCountry, setIsSavingCountry] = useState(false);

  const onSelectCountry = async (name: string) => {
    if (!session || isSavingCountry) {
      return;
    }
    setIsSavingCountry(true);
    try {
      await supabase.from("profiles").update({ country: name }).eq("id", session.user.id);
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(session.user.id) });
    } finally {
      setIsSavingCountry(false);
    }
  };

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

      {session ? (
        <ThemedView style={styles.rowText}>
          <ThemedText type="default">Country</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Used to show region-appropriate cultural-group browsing.
          </ThemedText>
          <ThemedView style={styles.countryList}>
            {COUNTRY_CODES.map((country) => (
              <Pressable
                key={country.name}
                style={[
                  styles.countryOption,
                  profile.data?.country === country.name && styles.countryOptionSelected,
                ]}
                disabled={isSavingCountry}
                onPress={() => onSelectCountry(country.name)}
                accessibilityRole="button"
                accessibilityLabel={`Select ${country.name}`}
                hitSlop={Spacing.two}
              >
                <ThemedText type="small">{country.name}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        </ThemedView>
      ) : null}
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
  countryList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  countryOption: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  countryOptionSelected: {
    borderColor: "#1F3B2C",
    borderWidth: 2,
  },
});
