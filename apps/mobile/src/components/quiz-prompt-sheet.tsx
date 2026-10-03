import { useRouter } from "expo-router";
import { Modal, Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { Spacing } from "@/constants/theme";
import { useDailyEngagementStore } from "@/stores/daily-engagement-store";

export function QuizPromptSheet() {
  const router = useRouter();
  const pendingQuizEpisode = useDailyEngagementStore((state) => state.pendingQuizEpisode);
  const dismissPendingQuizEpisode = useDailyEngagementStore(
    (state) => state.dismissPendingQuizEpisode,
  );

  const handleTakeQuiz = () => {
    if (!pendingQuizEpisode) {
      return;
    }
    const episodeId = pendingQuizEpisode.id;
    dismissPendingQuizEpisode();
    router.push(`/quiz/${episodeId}`);
  };

  return (
    <Modal
      visible={pendingQuizEpisode !== null}
      transparent
      animationType="slide"
      onRequestClose={dismissPendingQuizEpisode}
    >
      <Pressable
        style={styles.backdrop}
        onPress={dismissPendingQuizEpisode}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={Spacing.two}
      >
        <ThemedView style={styles.sheet}>
          <ThemedText type="subtitle">Test yourself?</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            A few quick questions about {pendingQuizEpisode?.title}.
          </ThemedText>
          <Button label="Take the quiz" onPress={handleTakeQuiz} />
          <Button label="Skip" variant="ghost" onPress={dismissPendingQuizEpisode} />
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
});
