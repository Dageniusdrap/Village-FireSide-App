import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { Spacing } from "@/constants/theme";
import { useDailyEngagementStore } from "@/stores/daily-engagement-store";

export function StreakMilestoneToast() {
  const streakMilestone = useDailyEngagementStore((state) => state.streakMilestone);
  const dismissStreakMilestone = useDailyEngagementStore((state) => state.dismissStreakMilestone);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (streakMilestone === null) {
      return;
    }
    const timeout = setTimeout(dismissStreakMilestone, 4000);
    return () => clearTimeout(timeout);
  }, [streakMilestone, dismissStreakMilestone]);

  if (streakMilestone === null) {
    return null;
  }

  return (
    <Card style={[styles.card, { top: insets.top + Spacing.two }]}>
      <ThemedText type="small">🔥 {streakMilestone}-day streak! Keep showing up.</ThemedText>
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
