// apps/mobile/src/app/(app)/series/[id].tsx
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EpisodeRow } from "@/components/ui/episode-row";
import { Skeleton } from "@/components/ui/skeleton";
import { SignInPromptSheet } from "@/components/sign-in-prompt-sheet";
import { Spacing } from "@/constants/theme";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useIsFavorited } from "@/hooks/queries/use-is-favorited";
import { useSeriesDetail, type SeriesDetailEpisode } from "@/hooks/queries/use-series-detail";
import { useToggleFavorite } from "@/hooks/queries/use-toggle-favorite";
import { usePlayerStore } from "@/stores/player-store";

export default function SeriesDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useSeriesDetail(id);
  const play = usePlayerStore((state) => state.play);
  const { toggle } = useToggleFavorite();
  const { requireAuth, promptVisible, dismissPrompt } = useRequireAuth();
  const isFavoritedQuery = useIsFavorited({ seriesId: id });
  const isFavorited = isFavoritedQuery.data ?? false;

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
          body="This series isn't available — it may have been unpublished or the link may be wrong."
        />
      </SafeAreaView>
    );
  }

  const series = query.data;
  const resumable = series.episodes.find((episode) => episode.resumePositionSeconds !== null);
  const firstFreeEpisode = series.episodes.find((episode) => episode.accessTier === "free");

  const playAll = () => {
    const target: SeriesDetailEpisode | undefined =
      resumable ?? firstFreeEpisode ?? series.episodes[0];
    if (target) {
      play({
        id: target.id,
        title: target.title,
        durationSeconds: target.durationSeconds,
        accessTier: target.accessTier,
        contentSource: target.contentSource,
      });
    }
  };

  const handleFavorite = () => {
    requireAuth(() => {
      // Optimistic update + rollback happens inside useToggleFavorite's
      // mutation (onMutate/onError against the shared favorite query key);
      // this screen just needs to swallow the rejection so it doesn't
      // surface as an unhandled promise rejection.
      toggle({ seriesId: series.id }, isFavorited).catch(() => {});
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <ScrollView contentContainerStyle={styles.content}>
        {series.coverImageUrl ? (
          <Image source={{ uri: series.coverImageUrl }} style={styles.cover} contentFit="cover" />
        ) : null}
        <ThemedText type="title">{series.title}</ThemedText>
        {series.description ? (
          <ThemedText type="default" themeColor="textSecondary">
            {series.description}
          </ThemedText>
        ) : null}
        {series.category ? (
          <ThemedText type="small" themeColor="textSecondary">
            {series.category}
          </ThemedText>
        ) : null}

        <ThemedView style={styles.actions}>
          <Button
            label={resumable ? "Resume" : "Play All"}
            onPress={playAll}
            disabled={series.episodes.length === 0}
          />
          <Pressable onPress={handleFavorite}>
            <ThemedText type="default" themeColor={isFavorited ? "accent" : "textSecondary"}>
              {isFavorited ? "♥ Favorited" : "♡ Favorite"}
            </ThemedText>
          </Pressable>
        </ThemedView>

        {series.episodes.length === 0 ? (
          <EmptyState title="No episodes yet" body="Episodes will appear here once published." />
        ) : (
          series.episodes.map((episode) => (
            <EpisodeRow
              key={episode.id}
              title={episode.title}
              durationSeconds={episode.durationSeconds}
              accessTier={episode.accessTier}
              contentSource={episode.contentSource}
              coinPrice={episode.coinPrice}
              resumePositionSeconds={episode.resumePositionSeconds}
              onPress={
                episode.accessTier === "free"
                  ? () =>
                      play({
                        id: episode.id,
                        title: episode.title,
                        durationSeconds: episode.durationSeconds,
                        accessTier: episode.accessTier,
                        contentSource: episode.contentSource,
                      })
                  : undefined
              }
            />
          ))
        )}
      </ScrollView>
      <SignInPromptSheet
        visible={promptVisible}
        onDismiss={dismissPrompt}
        onSignIn={() => {
          dismissPrompt();
          router.push("/sign-in");
        }}
        onSignUp={() => {
          dismissPrompt();
          router.push("/sign-up");
        }}
      />
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
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
});
