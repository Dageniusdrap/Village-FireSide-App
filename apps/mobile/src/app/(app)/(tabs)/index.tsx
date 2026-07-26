// apps/mobile/src/app/(app)/(tabs)/index.tsx
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DestinationCard } from "@/components/ui/destination-card";
import { EmptyState } from "@/components/ui/empty-state";
import { EpisodeRow } from "@/components/ui/episode-row";
import { SectionHeader } from "@/components/ui/section-header";
import { SeriesCard } from "@/components/ui/series-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import {
  useCategoryRail,
  useContinueListening,
  useCulturalGroups,
  useElderVoicesSeries,
  useFeaturedSeries,
  useStorytellers,
} from "@/hooks/queries/use-home-sections";

const CATEGORY_RAILS = [
  { key: "lakes", title: "Lakes" },
  { key: "forests", title: "Forests" },
  { key: "wildlife", title: "Wildlife" },
  { key: "hidden_africa", title: "Hidden Africa" },
  { key: "children", title: "Children" },
];

function SeriesRail({
  query,
  onPressSeries,
}: {
  query: {
    data?: {
      id: string;
      title: string;
      coverImageUrl: string | null;
      category: string | null;
      episodeCount: number;
    }[];
    isLoading: boolean;
  };
  onPressSeries: (id: string) => void;
}) {
  if (query.isLoading) {
    return <Skeleton width="100%" height={140} />;
  }
  if (!query.data || query.data.length === 0) {
    return <EmptyState title="Nothing here yet" body="Check back soon for new stories." />;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {query.data.map((series) => (
        <SeriesCard
          key={series.id}
          title={series.title}
          coverImageUrl={series.coverImageUrl}
          category={series.category}
          episodeCount={series.episodeCount}
          onPress={() => onPressSeries(series.id)}
        />
      ))}
    </ScrollView>
  );
}

function CategoryRailSection({
  category,
  title,
  onPressSeries,
}: {
  category: string;
  title: string;
  onPressSeries: (id: string) => void;
}) {
  const query = useCategoryRail(category);
  return (
    <View>
      <SectionHeader title={title} />
      <SeriesRail query={query} onPressSeries={onPressSeries} />
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const featuredSeries = useFeaturedSeries();
  const elderVoicesSeries = useElderVoicesSeries();
  const continueListening = useContinueListening();
  const culturalGroups = useCulturalGroups();
  const storytellers = useStorytellers();

  const goToSeries = (id: string) => router.push(`/series/${id}`);
  const goToCulturalGroup = (id: string) => router.push(`/cultural-group/${id}`);
  const goToContributor = (id: string) => router.push(`/contributor/${id}`);

  const isRefreshing =
    featuredSeries.isRefetching ||
    elderVoicesSeries.isRefetching ||
    continueListening.isRefetching ||
    culturalGroups.isRefetching ||
    storytellers.isRefetching;

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["home"] });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <SectionHeader title="Featured" />
        <SeriesRail query={featuredSeries} onPressSeries={goToSeries} />

        <SectionHeader title="Voices of Our Elders" />
        <SeriesRail query={elderVoicesSeries} onPressSeries={goToSeries} />

        <SectionHeader title="Continue Listening" />
        {continueListening.isLoading ? (
          <Skeleton width="100%" height={80} />
        ) : !continueListening.data || continueListening.data.length === 0 ? (
          <EmptyState
            title="Nothing in progress"
            body="Episodes you start will show up here so you can pick up where you left off."
          />
        ) : (
          continueListening.data.map((episode) => (
            <EpisodeRow
              key={episode.id}
              title={episode.title}
              durationSeconds={episode.durationSeconds}
              accessTier={episode.accessTier}
              contentSource={episode.contentSource}
            />
          ))
        )}

        {CATEGORY_RAILS.map((rail) => (
          <CategoryRailSection
            key={rail.key}
            category={rail.key}
            title={rail.title}
            onPressSeries={goToSeries}
          />
        ))}

        <SectionHeader title="Peoples & Kingdoms" />
        {culturalGroups.isLoading ? (
          <Skeleton width="100%" height={140} />
        ) : !culturalGroups.data || culturalGroups.data.length === 0 ? (
          <EmptyState title="Nothing here yet" body="Check back soon for new cultures." />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {culturalGroups.data.map((group) => (
              <DestinationCard
                key={group.id}
                name={group.name}
                region={group.region}
                coverImageUrl={group.coverImageUrl}
                onPress={() => goToCulturalGroup(group.id)}
              />
            ))}
          </ScrollView>
        )}

        <SectionHeader title="Meet the Storytellers" />
        {storytellers.isLoading ? (
          <Skeleton width="100%" height={140} />
        ) : !storytellers.data || storytellers.data.length === 0 ? (
          <EmptyState title="Nothing here yet" body="Storyteller profiles will appear here soon." />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {storytellers.data.map((contributor) => (
              <DestinationCard
                key={contributor.id}
                name={contributor.displayName}
                region={contributor.district}
                coverImageUrl={contributor.photoUrl}
                onPress={() => goToContributor(contributor.id)}
              />
            ))}
          </ScrollView>
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
    gap: Spacing.four,
  },
  row: {
    gap: Spacing.three,
  },
});
