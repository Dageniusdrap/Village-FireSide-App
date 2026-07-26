import { Pressable, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { useBookmarks } from "@/hooks/queries/use-bookmarks";
import { formatDuration } from "@/lib/format-duration";
import { usePlayerStore } from "@/stores/player-store";

export default function LibraryScreen() {
  const bookmarksQuery = useBookmarks();
  const playQueue = usePlayerStore((state) => state.playQueue);
  const expand = usePlayerStore((state) => state.expand);
  const bookmarks = bookmarksQuery.data ?? [];

  const openBookmark = (bookmark: NonNullable<typeof bookmarksQuery.data>[number]) => {
    playQueue([bookmark.episode], 0, bookmark.positionSeconds)
      .then(expand)
      .catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader title="Library" />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="default" themeColor="textSecondary">
          Your favorites, downloads, and listening history will show up here.
        </ThemedText>

        <SectionHeader title="Bookmarks" />
        {bookmarks.length === 0 ? (
          <EmptyState
            title="No bookmarks yet"
            body="Bookmark a moment while listening to an episode and it'll show up here."
          />
        ) : (
          bookmarks.map((bookmark) => (
            <Pressable key={bookmark.id} style={styles.row} onPress={() => openBookmark(bookmark)}>
              <ThemedText type="default">{bookmark.episode.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {bookmark.episode.seriesTitle} · {formatDuration(bookmark.positionSeconds)}
              </ThemedText>
              {bookmark.note ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {bookmark.note}
                </ThemedText>
              ) : null}
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
    gap: Spacing.two,
  },
  row: {
    gap: Spacing.half,
    paddingVertical: Spacing.two,
  },
});
