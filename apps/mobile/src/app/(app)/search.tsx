import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BackButton } from "@/components/ui/back-button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { useGlobalSearch } from "@/hooks/queries/use-global-search";
import { useSearchHistoryStore } from "@/stores/search-history-store";

const DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const recentQueries = useSearchHistoryStore((state) => state.queries);
  const addQuery = useSearchHistoryStore((state) => state.addQuery);
  const clearHistory = useSearchHistoryStore((state) => state.clearHistory);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(input), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  const query = useGlobalSearch(debounced);

  const onSubmit = () => {
    if (input.trim().length > 0) {
      addQuery(input.trim());
    }
  };

  const showRecent = debounced.trim().length === 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <ThemedView style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Search stories, places, storytellers…"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={onSubmit}
          autoFocus
        />
      </ThemedView>

      <ScrollView contentContainerStyle={styles.content}>
        {showRecent ? (
          <>
            <SectionHeader
              title="Recent searches"
              actionLabel="Clear"
              onActionPress={clearHistory}
            />
            {recentQueries.length === 0 ? (
              <EmptyState
                title="No recent searches"
                body="Your recent searches will appear here."
              />
            ) : (
              recentQueries.map((recent) => (
                <Pressable
                  key={recent}
                  onPress={() => {
                    setInput(recent);
                    setDebounced(recent);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Search again for ${recent}`}
                >
                  <ThemedText type="default">{recent}</ThemedText>
                </Pressable>
              ))
            )}
          </>
        ) : query.isError ? (
          <EmptyState title="Couldn't search" body="Please try again." />
        ) : query.isLoading ? null : (
          <>
            {query.data && query.data.series.length > 0 ? (
              <>
                <SectionHeader title="Series" />
                {query.data.series.map((result) => (
                  <Pressable
                    key={result.id}
                    onPress={() => router.push(`/series/${result.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open series ${result.title}`}
                  >
                    <ThemedText type="default">{result.title}</ThemedText>
                  </Pressable>
                ))}
              </>
            ) : null}
            {query.data && query.data.episodes.length > 0 ? (
              <>
                <SectionHeader title="Episodes" />
                {query.data.episodes.map((result) => (
                  <Pressable
                    key={result.id}
                    onPress={() => router.push(`/episode/${result.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open episode ${result.title}`}
                  >
                    <ThemedText type="default">{result.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {result.seriesTitle}
                    </ThemedText>
                  </Pressable>
                ))}
              </>
            ) : null}
            {query.data && query.data.destinations.length > 0 ? (
              <>
                <SectionHeader title="Destinations" />
                {query.data.destinations.map((result) => (
                  <Pressable
                    key={result.id}
                    onPress={() => router.push(`/destination/${result.slug}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open destination ${result.name}`}
                  >
                    <ThemedText type="default">{result.name}</ThemedText>
                  </Pressable>
                ))}
              </>
            ) : null}
            {query.data && query.data.contributors.length > 0 ? (
              <>
                <SectionHeader title="Contributors" />
                {query.data.contributors.map((result) => (
                  <Pressable
                    key={result.id}
                    onPress={() => router.push(`/contributor/${result.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open contributor ${result.displayName}`}
                  >
                    <ThemedText type="default">{result.displayName}</ThemedText>
                  </Pressable>
                ))}
              </>
            ) : null}
            {query.data &&
            query.data.series.length === 0 &&
            query.data.episodes.length === 0 &&
            query.data.destinations.length === 0 &&
            query.data.contributors.length === 0 ? (
              <EmptyState title="No results" body="Try a different search term." />
            ) : null}
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
  searchRow: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
});
