// apps/mobile/src/app/(app)/learn/[subject].tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BackButton } from "@/components/ui/back-button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { EpisodeRow } from "@/components/ui/episode-row";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { GRADE_LEVELS, SUBJECT_AREAS } from "@/constants/learn";
import { Spacing } from "@/constants/theme";
import { useAppSetting, useCulturalGroupsEnabled } from "@/hooks/queries/use-app-settings";
import { useCulturalGroups } from "@/hooks/queries/use-home-sections";
import { useSubjectEpisodes } from "@/hooks/queries/use-subject-episodes";
import { matchesLearnFilters } from "@/lib/learn-filter";
import type { SubjectArea } from "@/types/content";

export default function SubjectScreen() {
  const { subject } = useLocalSearchParams<{ subject: SubjectArea }>();
  const router = useRouter();
  const query = useSubjectEpisodes(subject);
  const culturalGroupsEnabled = useCulturalGroupsEnabled();
  const culturalGroupsQuery = useCulturalGroups();

  const [selectedGradeLevels, setSelectedGradeLevels] = useState<string[]>([]);
  const [selectedSyllabusTopics, setSelectedSyllabusTopics] = useState<string[]>([]);
  const [selectedCulturalGroupIds, setSelectedCulturalGroupIds] = useState<string[]>([]);

  const episodes = query.data ?? [];
  const subjectLabel = SUBJECT_AREAS.find((s) => s.value === subject)?.label ?? subject;

  const syllabusTopics = useMemo(
    () => [...new Set(episodes.map((e) => e.syllabusTopic).filter((t): t is string => t !== null))],
    [episodes],
  );

  const toggleSelection = (value: string, list: string[], setList: (next: string[]) => void) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const filtered = episodes.filter((e) =>
    matchesLearnFilters(e, selectedGradeLevels, selectedSyllabusTopics, selectedCulturalGroupIds),
  );

  const elderTestimonyFirst =
    subject === "history" ? filtered.filter((e) => e.contentSource === "elder_testimony") : [];
  const rest =
    subject === "history"
      ? filtered.filter((e) => e.contentSource !== "elder_testimony")
      : filtered;

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title={subjectLabel} />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {GRADE_LEVELS.map((grade) => (
            <Chip
              key={grade.value}
              label={grade.label}
              selected={selectedGradeLevels.includes(grade.value)}
              onPress={() =>
                toggleSelection(grade.value, selectedGradeLevels, setSelectedGradeLevels)
              }
            />
          ))}
        </ScrollView>

        {syllabusTopics.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {syllabusTopics.map((topic) => (
              <Chip
                key={topic}
                label={topic}
                selected={selectedSyllabusTopics.includes(topic)}
                onPress={() =>
                  toggleSelection(topic, selectedSyllabusTopics, setSelectedSyllabusTopics)
                }
              />
            ))}
          </ScrollView>
        ) : null}

        {culturalGroupsEnabled &&
        culturalGroupsQuery.data &&
        culturalGroupsQuery.data.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {culturalGroupsQuery.data.map((group) => (
              <Chip
                key={group.id}
                label={group.name}
                selected={selectedCulturalGroupIds.includes(group.id)}
                onPress={() =>
                  toggleSelection(group.id, selectedCulturalGroupIds, setSelectedCulturalGroupIds)
                }
              />
            ))}
          </ScrollView>
        ) : null}

        {query.isLoading ? (
          <Skeleton width="100%" height={200} />
        ) : (
          <>
            {subject === "history" && elderTestimonyFirst.length > 0 ? (
              <>
                <SectionHeader title="True African History" />
                {elderTestimonyFirst.map((episode) => (
                  <EpisodeRow
                    key={episode.id}
                    title={episode.title}
                    durationSeconds={episode.durationSeconds}
                    accessTier={episode.accessTier}
                    contentSource={episode.contentSource}
                    onPress={() => router.push(`/episode/${episode.id}`)}
                  />
                ))}
              </>
            ) : null}

            {rest.length === 0 && elderTestimonyFirst.length === 0 ? (
              <EmptyState title="No stories yet" body="Try adjusting your filters." />
            ) : (
              rest.map((episode) => (
                <EpisodeRow
                  key={episode.id}
                  title={episode.title}
                  durationSeconds={episode.durationSeconds}
                  accessTier={episode.accessTier}
                  contentSource={episode.contentSource}
                  onPress={() => router.push(`/episode/${episode.id}`)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>
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
  chipRow: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
});
