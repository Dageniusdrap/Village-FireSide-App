import { Alert, Pressable, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { useBookmarks } from "@/hooks/queries/use-bookmarks";
import { formatBytes } from "@/lib/format-bytes";
import { formatDuration } from "@/lib/format-duration";
import { useDownloadQueueStore } from "@/stores/download-queue-store";
import { usePlayerStore } from "@/stores/player-store";

export default function LibraryScreen() {
  const bookmarksQuery = useBookmarks();
  const playQueue = usePlayerStore((state) => state.playQueue);
  const expand = usePlayerStore((state) => state.expand);
  const bookmarks = bookmarksQuery.data ?? [];

  const downloadEntries = useDownloadQueueStore((state) => state.entries);
  const removeDownload = useDownloadQueueStore((state) => state.remove);
  const retryDownload = useDownloadQueueStore((state) => state.retry);
  const cancelDownload = useDownloadQueueStore((state) => state.cancel);
  const removeAllDownloads = useDownloadQueueStore((state) => state.removeAll);

  const downloads = Object.entries(downloadEntries).map(([episodeId, entry]) => ({
    episodeId,
    ...entry,
  }));
  const totalBytes = downloads
    .filter((d) => d.status === "downloaded")
    .reduce((sum, d) => sum + (d.fileSize ?? 0), 0);

  const confirmDeleteAll = () => {
    Alert.alert(
      "Delete all downloads?",
      "This removes every downloaded episode from this device.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete All", style: "destructive", onPress: removeAllDownloads },
      ],
    );
  };

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

        <SectionHeader
          title={`Downloads${downloads.length > 0 ? ` · ${formatBytes(totalBytes)}` : ""}`}
          actionLabel={downloads.some((d) => d.status === "downloaded") ? "Delete All" : undefined}
          onActionPress={
            downloads.some((d) => d.status === "downloaded") ? confirmDeleteAll : undefined
          }
        />
        {downloads.length === 0 ? (
          <EmptyState
            title="No downloads yet"
            body="Download an episode from its series page to listen offline."
          />
        ) : (
          downloads.map((download) => (
            <ThemedView key={download.episodeId} style={styles.row}>
              <ThemedText type="default">{download.episode.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {download.episode.seriesTitle}
                {download.status === "downloaded" && download.fileSize
                  ? ` · ${formatBytes(download.fileSize)}`
                  : ""}
                {download.status === "downloading"
                  ? ` · ${Math.round(download.progress * 100)}%`
                  : ""}
                {download.status === "queued" ? " · Queued" : ""}
                {download.status === "paused_wifi" ? " · Waiting for Wi-Fi" : ""}
                {download.status === "error" ? ` · ${download.error}` : ""}
              </ThemedText>
              {download.status === "downloaded" ? (
                <Pressable onPress={() => removeDownload(download.episodeId)}>
                  <ThemedText type="small" themeColor="accent">
                    Delete
                  </ThemedText>
                </Pressable>
              ) : null}
              {download.status === "error" ? (
                <Pressable onPress={() => retryDownload(download.episodeId)}>
                  <ThemedText type="small" themeColor="accent">
                    Retry
                  </ThemedText>
                </Pressable>
              ) : null}
              {download.status === "queued" ||
              download.status === "downloading" ||
              download.status === "paused_wifi" ? (
                <Pressable onPress={() => cancelDownload(download.episodeId)}>
                  <ThemedText type="small" themeColor="accent">
                    Cancel
                  </ThemedText>
                </Pressable>
              ) : null}
            </ThemedView>
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
