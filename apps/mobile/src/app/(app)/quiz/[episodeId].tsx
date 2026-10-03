import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useQuizDetail, useSubmitQuizAttempt } from "@/hooks/queries/use-quiz-detail";

export default function QuizScreen() {
  const { episodeId } = useLocalSearchParams<{ episodeId: string }>();
  const router = useRouter();
  const query = useQuizDetail(episodeId);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const quizId = query.data?.id ?? "";
  const { submitAttempt } = useSubmitQuizAttempt(quizId);

  if (query.isError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <EmptyState
          title="Couldn't load the quiz"
          body="Please try again later."
          onRetry={() => query.refetch()}
        />
      </SafeAreaView>
    );
  }

  if (query.isLoading || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <Skeleton width="100%" height={200} />
      </SafeAreaView>
    );
  }

  const { questions } = query.data;
  const currentQuestion = questions[questionIndex];

  if (!currentQuestion) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <View style={styles.content}>
          <ThemedText type="title">
            {score} / {questions.length}
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            {submitted ? "Nice work!" : "Saving your score…"}
          </ThemedText>
          <Button label="Done" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const onSelect = (index: number) => {
    if (selectedIndex !== null) {
      return;
    }
    setSelectedIndex(index);
    if (index === currentQuestion.correctIndex) {
      setScore((current) => current + 1);
    }
  };

  const onNext = () => {
    const isLastQuestion = questionIndex === questions.length - 1;
    setSelectedIndex(null);
    if (isLastQuestion) {
      setSubmitted(true);
      void submitAttempt({ score, total: questions.length }).catch(() => {});
    }
    setQuestionIndex((current) => current + 1);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <View style={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          Question {questionIndex + 1} of {questions.length}
        </ThemedText>
        <ThemedText type="subtitle">{currentQuestion.question}</ThemedText>
        {currentQuestion.options.map((option, index) => {
          const isSelected = selectedIndex === index;
          const isCorrect = index === currentQuestion.correctIndex;
          const showFeedback = selectedIndex !== null;
          return (
            <Pressable
              key={option}
              onPress={() => onSelect(index)}
              disabled={selectedIndex !== null}
              style={styles.option}
              accessibilityRole="button"
              accessibilityLabel={option}
            >
              <ThemedText
                type="default"
                themeColor={
                  showFeedback && isCorrect
                    ? "success"
                    : showFeedback && isSelected && !isCorrect
                      ? "error"
                      : "primary"
                }
              >
                {option}
              </ThemedText>
            </Pressable>
          );
        })}
        {selectedIndex !== null ? (
          <>
            {currentQuestion.explanation ? (
              <ThemedText type="small" themeColor="textSecondary">
                {currentQuestion.explanation}
              </ThemedText>
            ) : null}
            <Button
              label={questionIndex === questions.length - 1 ? "See results" : "Next"}
              onPress={onNext}
            />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  option: {
    padding: Spacing.three,
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
  },
});
