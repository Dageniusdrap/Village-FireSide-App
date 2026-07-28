import { useRouter } from "expo-router";
import { Modal, Pressable, StyleSheet } from "react-native";

import { SignInPromptSheet } from "@/components/sign-in-prompt-sheet";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { Spacing } from "@/constants/theme";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { unlockEpisode } from "@/lib/unlock-episode";
import { usePlayerStore } from "@/stores/player-store";

export function UnlockSheet() {
  const router = useRouter();
  const lockedEpisode = usePlayerStore((state) => state.lockedEpisode);
  const dismissLockedEpisode = usePlayerStore((state) => state.dismissLockedEpisode);
  const { requireAuth, promptVisible, dismissPrompt } = useRequireAuth();

  const handleUnlock = () => {
    if (!lockedEpisode) {
      return;
    }
    const episodeId = lockedEpisode.id;
    requireAuth(() => {
      unlockEpisode(episodeId)
        .then((result) => {
          if (result.type === "unlocked") {
            dismissLockedEpisode();
          } else if (result.type === "insufficient_coins") {
            dismissLockedEpisode();
            router.push("/coins");
          }
          // not_coin_gated/not_found/unauthorized/error: leave the sheet
          // open — these shouldn't happen for a row the UI already
          // gated on access_tier === "coins".
        })
        .catch(() => {});
    });
  };

  const handleGoPremium = () => {
    requireAuth(() => {
      dismissLockedEpisode();
      router.push("/coins");
    });
  };

  return (
    <>
      <Modal
        visible={lockedEpisode !== null}
        transparent
        animationType="slide"
        onRequestClose={dismissLockedEpisode}
      >
        <Pressable style={styles.backdrop} onPress={dismissLockedEpisode}>
          <ThemedView style={styles.sheet}>
            <ThemedText type="subtitle">{lockedEpisode?.title}</ThemedText>
            {lockedEpisode?.accessTier === "coins" ? (
              <>
                <ThemedText type="default" themeColor="textSecondary">
                  {lockedEpisode.coinPrice} coins
                </ThemedText>
                <Button
                  label={`Unlock for ${lockedEpisode.coinPrice} coins`}
                  onPress={handleUnlock}
                />
              </>
            ) : (
              <ThemedText type="default" themeColor="textSecondary">
                Premium episode
              </ThemedText>
            )}
            <Button label="Go Premium" variant="secondary" onPress={handleGoPremium} />
          </ThemedView>
        </Pressable>
      </Modal>
      <SignInPromptSheet
        visible={promptVisible}
        onDismiss={dismissPrompt}
        onSignIn={() => {
          dismissPrompt();
          router.push("/sign-in");
        }}
        onSignUp={() => {
          dismissPrompt();
          router.push("/sign-up");
        }}
      />
    </>
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
});
