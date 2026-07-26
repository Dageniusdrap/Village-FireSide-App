import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { BackButton } from "@/components/ui/back-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useContributorDetail } from "@/hooks/queries/use-contributor-detail";

export default function ContributorProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useContributorDetail(id);

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
        <EmptyState
          title="Not found"
          body="This storyteller's profile isn't available right now."
        />
      </SafeAreaView>
    );
  }

  const contributor = query.data;

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <ScrollView contentContainerStyle={styles.content}>
        {contributor.photoUrl ? (
          <Image source={{ uri: contributor.photoUrl }} style={styles.photo} contentFit="cover" />
        ) : null}
        <ThemedText type="title">{contributor.displayName}</ThemedText>
        {contributor.district || contributor.country ? (
          <ThemedText type="small" themeColor="textSecondary">
            {[contributor.district, contributor.country].filter(Boolean).join(", ")}
          </ThemedText>
        ) : null}
        {contributor.bio ? <ThemedText type="default">{contributor.bio}</ThemedText> : null}

        {contributor.episodes.length === 0 ? (
          <EmptyState
            title="No episodes yet"
            body="Episodes this storyteller contributed to will appear here."
          />
        ) : (
          contributor.episodes.map((episode) => (
            <Pressable
              key={`${episode.id}-${episode.role}`}
              style={styles.episodeRow}
              onPress={() => router.push(`/series/${episode.seriesId}`)}
            >
              <View style={styles.episodeInfo}>
                <ThemedText type="default">{episode.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {episode.seriesTitle} · {episode.role}
                </ThemedText>
              </View>
            </Pressable>
          ))
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
  photo: {
    width: 96,
    height: 96,
    borderRadius: Spacing.six,
  },
  episodeRow: {
    paddingVertical: Spacing.two,
  },
  episodeInfo: {
    gap: Spacing.half,
  },
});
