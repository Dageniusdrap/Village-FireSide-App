import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { Spacing } from "@/constants/theme";
import { usePlayerStore } from "@/stores/player-store";

// Displays player-store.ts's `toastMessage` (currently only set by
// loadTrackAtIndex on a 400/500 resolveEpisodeSource result) and
// auto-dismisses it after a few seconds.
export function PlaybackToast() {
  const toastMessage = usePlayerStore((state) => state.toastMessage);
  const dismissToast = usePlayerStore((state) => state.dismissToast);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timeout = setTimeout(dismissToast, 4000);
    return () => clearTimeout(timeout);
  }, [toastMessage, dismissToast]);

  if (!toastMessage) {
    return null;
  }

  return (
    <Card style={[styles.card, { top: insets.top + Spacing.two }]}>
      <ThemedText type="small">{toastMessage}</ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: Spacing.three,
    right: Spacing.three,
  },
});
