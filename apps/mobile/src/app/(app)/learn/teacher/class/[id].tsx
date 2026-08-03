// apps/mobile/src/app/(app)/learn/teacher/class/[id].tsx
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useAssignEpisode, useClassDetail } from "@/hooks/queries/use-class-detail";

export default function ClassDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useClassDetail(id);
  const { assignEpisode } = useAssignEpisode(id);
  const [episodeIdInput, setEpisodeIdInput] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | undefined>();

  const onAssign = async () => {
    if (!episodeIdInput.trim()) {
      return;
    }
    setIsAssigning(true);
    setAssignError(undefined);
    try {
      await assignEpisode({ episodeId: episodeIdInput.trim() });
      setEpisodeIdInput("");
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : "Could not assign that episode.");
    }
    setIsAssigning(false);
  };

  if (query.isError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <EmptyState title="Couldn't load this class" body="Please try again later." />
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

  const { name, joinCode, assignedEpisodes } = query.data;

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <View style={styles.content}>
        <SectionHeader title={name} />
        <ThemedText type="default" themeColor="textSecondary">
          Join code: {joinCode}
        </ThemedText>

        <View style={styles.assignRow}>
          <TextInput
            style={styles.input}
            placeholder="Episode ID to assign"
            value={episodeIdInput}
            onChangeText={setEpisodeIdInput}
            autoCapitalize="none"
          />
          <Button
            label={isAssigning ? "Assigning…" : "Assign"}
            onPress={onAssign}
            disabled={isAssigning || !episodeIdInput.trim()}
          />
        </View>
        <FormError message={assignError} />

        <SectionHeader title="Assigned Episodes" />
        {assignedEpisodes.length === 0 ? (
          <EmptyState title="No episodes assigned yet" body="Assign an episode above." />
        ) : (
          assignedEpisodes.map((episode) => (
            <View key={episode.episodeId} style={styles.episodeRow}>
              <ThemedText type="default">{episode.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {episode.listenerCount} listened
              </ThemedText>
            </View>
          ))
        )}
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
    gap: Spacing.two,
  },
  assignRow: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  episodeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: "#EEEEEE",
  },
});
