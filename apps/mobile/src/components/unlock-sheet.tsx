import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
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
  const queryClient = useQueryClient();
  const lockedEpisode = usePlayerStore((state) => state.lockedEpisode);
  const dismissLockedEpisode = usePlayerStore((state) => state.dismissLockedEpisode);
  const playQueue = usePlayerStore((state) => state.playQueue);
  const { requireAuth, promptVisible, dismissPrompt } = useRequireAuth();
  const [unlocking, setUnlocking] = useState(false);

  const handleUnlock = () => {
    // In-flight guard: without it a double-tap fires a second
    // unlockEpisode while the first is still running. The second call
    // sees the episode already unlocked but the balance already spent,
    // and (below) would bounce the user to /coins even though the
    // unlock succeeded.
    if (!lockedEpisode || unlocking) {
      return;
    }
    const episode = lockedEpisode;
    requireAuth(() => {
      setUnlocking(true);
      unlockEpisode(episode.id)
        .then((result) => {
          if (result.type === "unlocked") {
            // The balance just changed server-side; refetch it so the
            // Profile/Coins screens don't show a stale number.
            void queryClient.invalidateQueries({ queryKey: ["profile"] });
            dismissLockedEpisode();
            // Start playing what the user just paid for. If the episode
            // is still in the queue (a next()/previous() lock) resume
            // there so the rest of the series stays queued; otherwise
            // playQueue reverted the queue when the load hit the lock,
            // so play it as a single-item queue.
            const queue = usePlayerStore.getState().queue;
            const index = queue.findIndex((item) => item.id === episode.id);
            void (index >= 0 ? playQueue(queue, index) : playQueue([episode], 0));
          } else if (result.type === "insufficient_coins") {
            dismissLockedEpisode();
            router.push("/coins");
          }
          // not_coin_gated/not_found/unauthorized/error: leave the sheet
          // open — these shouldn't happen for a row the UI already
          // gated on access_tier === "coins".
        })
        .catch(() => {})
        .finally(() => setUnlocking(false));
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
                  loading={unlocking}
                  disabled={unlocking}
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
