import { Modal, Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { usePlayerStore } from "@/stores/player-store";

// A minimal stub so the locked-episode auto-advance flow doesn't
// dead-end. Prompt 9 replaces the disabled button with a real coin
// balance + purchase flow; it does not change where this sheet is
// triggered from (the store's `lockedEpisode` state).
export function UnlockSheetStub() {
  const lockedEpisode = usePlayerStore((state) => state.lockedEpisode);
  const dismissLockedEpisode = usePlayerStore((state) => state.dismissLockedEpisode);

  return (
    <Modal
      visible={lockedEpisode !== null}
      transparent
      animationType="slide"
      onRequestClose={dismissLockedEpisode}
    >
      <Pressable style={styles.backdrop} onPress={dismissLockedEpisode}>
        <ThemedView style={styles.sheet}>
          <ThemedText type="subtitle">{lockedEpisode?.title}</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            {lockedEpisode?.accessTier === "premium"
              ? "Premium episode"
              : `${lockedEpisode?.coinPrice ?? 0} coins`}
          </ThemedText>
          <Pressable style={styles.disabledButton} disabled>
            <ThemedText type="default" themeColor="background">
              Unlock
            </ThemedText>
          </Pressable>
        </ThemedView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  sheet: {
    padding: Spacing.four,
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    gap: Spacing.three,
  },
  disabledButton: {
    backgroundColor: "#1F3B2C",
    opacity: 0.5,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
  },
});
