// apps/mobile/src/app/(app)/(tabs)/index.tsx
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EpisodeRow } from "@/components/ui/episode-row";
import { SectionHeader } from "@/components/ui/section-header";
import { SeriesCard } from "@/components/ui/series-card";
import { Spacing } from "@/constants/theme";
import { mockEpisodes, mockSeries } from "@/mocks/content";

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Continue Listening" />
        {mockEpisodes.map((episode) => (
          <EpisodeRow
            key={episode.id}
            title={episode.title}
            durationSeconds={episode.durationSeconds}
            accessTier={episode.accessTier}
            contentSource={episode.contentSource}
          />
        ))}

        <SectionHeader title="Popular Series" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {mockSeries.map((series) => (
            <SeriesCard
              key={series.id}
              title={series.title}
              coverImageUrl={series.coverImageUrl}
              category={series.category}
              episodeCount={series.episodeCount}
            />
          ))}
        </ScrollView>
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
    gap: Spacing.four,
  },
  row: {
    gap: Spacing.three,
  },
});
