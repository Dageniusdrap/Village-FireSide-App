import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { DestinationCard } from "@/components/ui/destination-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { SeriesCard } from "@/components/ui/series-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useCulturalGroupDetail } from "@/hooks/queries/use-cultural-group-detail";

export default function CulturalGroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useCulturalGroupDetail(id);

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Skeleton width="100%" height={200} />
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <EmptyState title="Not found" body="This culture's page isn't available right now." />
      </SafeAreaView>
    );
  }

  const group = query.data;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">{group.name}</ThemedText>
        {group.country || group.region ? (
          <ThemedText type="small" themeColor="textSecondary">
            {[group.region, group.country].filter(Boolean).join(", ")}
          </ThemedText>
        ) : null}
        {group.description ? <ThemedText type="default">{group.description}</ThemedText> : null}

        <SectionHeader title="Series" />
        {group.series.length === 0 ? (
          <EmptyState title="No series yet" body="Series from this culture will appear here." />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {group.series.map((series) => (
              <SeriesCard
                key={series.id}
                title={series.title}
                coverImageUrl={series.coverImageUrl}
                category={null}
                episodeCount={series.episodeCount}
                onPress={() => router.push(`/series/${series.id}`)}
              />
            ))}
          </ScrollView>
        )}

        <SectionHeader title="Contributors" />
        {group.contributors.length === 0 ? (
          <EmptyState
            title="No contributors yet"
            body="Storytellers from this culture will appear here."
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {group.contributors.map((contributor) => (
              <DestinationCard
                key={contributor.id}
                name={contributor.displayName}
                region={contributor.district}
                coverImageUrl={contributor.photoUrl}
                onPress={() => router.push(`/contributor/${contributor.id}`)}
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
    gap: Spacing.three,
  },
  row: {
    gap: Spacing.three,
  },
});
