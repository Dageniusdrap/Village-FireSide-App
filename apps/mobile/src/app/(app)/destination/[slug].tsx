import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { VideoModal } from "@/components/video-modal";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { DestinationCard } from "@/components/ui/destination-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { SeriesCard } from "@/components/ui/series-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useDestinationDetail } from "@/hooks/queries/use-destination-detail";

export default function DestinationDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const query = useDestinationDetail(slug);

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <Skeleton width="100%" height={200} />
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <EmptyState title="Not found" body="This destination isn't available right now." />
      </SafeAreaView>
    );
  }

  const destination = query.data;
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <ScrollView contentContainerStyle={styles.content}>
        {destination.coverImageUrl ? (
          <Image
            source={{ uri: destination.coverImageUrl }}
            style={styles.cover}
            contentFit="cover"
          />
        ) : null}
        {destination.media.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {destination.media.map((item) =>
              item.type === "image" ? (
                <Image
                  key={item.id}
                  source={{ uri: item.url }}
                  style={styles.galleryImage}
                  contentFit="cover"
                />
              ) : (
                <Pressable key={item.id} onPress={() => setActiveVideoUrl(item.url)}>
                  <View style={[styles.galleryImage, styles.videoThumbnail]}>
                    <ThemedText type="default" themeColor="background">
                      ▶ Play
                    </ThemedText>
                  </View>
                </Pressable>
              ),
            )}
          </ScrollView>
        ) : null}
        <ThemedText type="title">{destination.name}</ThemedText>
        {destination.region || destination.country ? (
          <ThemedText type="small" themeColor="textSecondary">
            {[destination.region, destination.country].filter(Boolean).join(", ")}
          </ThemedText>
        ) : null}
        {destination.description ? (
          <ThemedText type="default">{destination.description}</ThemedText>
        ) : null}
        {destination.bestTimeToVisit ? (
          <ThemedText type="default">Best time to visit: {destination.bestTimeToVisit}</ThemedText>
        ) : null}
        {destination.entryFeeNotes ? (
          <ThemedText type="default">Entry fees: {destination.entryFeeNotes}</ThemedText>
        ) : null}
        {destination.safetyNotes ? (
          <ThemedText type="default">Safety notes: {destination.safetyNotes}</ThemedText>
        ) : null}
        {destination.conservationNotes ? (
          <ThemedText type="default">Conservation: {destination.conservationNotes}</ThemedText>
        ) : null}

        <Button
          label="Plan Your Visit"
          onPress={() => router.push(`/destination/${destination.slug}/inquire`)}
        />

        <SectionHeader title="Stories from this place" />
        {destination.series.length === 0 ? (
          <EmptyState title="No stories yet" body="Stories from this place will appear here." />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {destination.series.map((series) => (
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

        <SectionHeader title="Local contributors" />
        {destination.contributors.length === 0 ? (
          <EmptyState
            title="No contributors yet"
            body="Local storytellers and guides will appear here."
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {destination.contributors.map((contributor) => (
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
      {activeVideoUrl ? (
        <VideoModal url={activeVideoUrl} onClose={() => setActiveVideoUrl(null)} />
      ) : null}
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
  cover: {
    width: "100%",
    height: 200,
    borderRadius: Spacing.two,
  },
  row: {
    gap: Spacing.three,
  },
  galleryImage: {
    width: 160,
    height: 120,
    borderRadius: Spacing.two,
  },
  videoThumbnail: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
});
