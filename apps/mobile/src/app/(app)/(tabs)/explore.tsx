import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView from "react-native-map-clustering";
import { Marker } from "react-native-maps";

import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/chip";
import { DestinationCard } from "@/components/ui/destination-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { matchesDestinationFilters } from "@/lib/destination-filter";
import { useDestinations } from "@/hooks/queries/use-destinations";

export default function ExploreScreen() {
  const router = useRouter();
  const query = useDestinations();
  const [view, setView] = useState<"list" | "map">("list");
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const destinations = query.data ?? [];

  const countries = useMemo(
    () => [...new Set(destinations.map((d) => d.country).filter((c): c is string => c !== null))],
    [destinations],
  );
  const categories = useMemo(
    () => [...new Set(destinations.flatMap((d) => d.categories))],
    [destinations],
  );

  const filtered = destinations.filter((d) =>
    matchesDestinationFilters(d, selectedCountries, selectedCategories),
  );

  const toggleSelection = (value: string, list: string[], setList: (next: string[]) => void) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader title="Explore" />

      <View style={styles.toggleRow}>
        <Chip label="List" selected={view === "list"} onPress={() => setView("list")} />
        <Chip label="Map" selected={view === "map"} onPress={() => setView("map")} />
      </View>

      {countries.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {countries.map((country) => (
            <Chip
              key={country}
              label={country}
              selected={selectedCountries.includes(country)}
              onPress={() => toggleSelection(country, selectedCountries, setSelectedCountries)}
            />
          ))}
        </ScrollView>
      ) : null}

      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {categories.map((category) => (
            <Chip
              key={category}
              label={category}
              selected={selectedCategories.includes(category)}
              onPress={() => toggleSelection(category, selectedCategories, setSelectedCategories)}
            />
          ))}
        </ScrollView>
      ) : null}

      {query.isLoading ? (
        <Skeleton width="100%" height={200} />
      ) : view === "list" ? (
        <ScrollView contentContainerStyle={styles.content}>
          {filtered.length === 0 ? (
            <EmptyState title="No destinations found" body="Try adjusting your filters." />
          ) : (
            <View style={styles.grid}>
              {filtered.map((destination) => (
                <DestinationCard
                  key={destination.id}
                  name={destination.name}
                  region={destination.region}
                  coverImageUrl={destination.coverImageUrl}
                  onPress={() => router.push(`/destination/${destination.slug}`)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        <MapView
          style={styles.map}
          initialRegion={{
            // Roughly centered over Uganda/Rwanda/Kenya — a fixed default,
            // not derived from device location (no location-permission flow
            // exists anywhere in this app).
            latitude: 0.5,
            longitude: 32.5,
            latitudeDelta: 8,
            longitudeDelta: 8,
          }}
        >
          {filtered
            .filter((d) => d.latitude !== null && d.longitude !== null)
            .map((destination) => (
              <Marker
                key={destination.id}
                coordinate={{ latitude: destination.latitude!, longitude: destination.longitude! }}
                title={destination.name}
                onPress={() => router.push(`/destination/${destination.slug}`)}
              />
            ))}
        </MapView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  toggleRow: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  chipRow: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  content: {
    padding: Spacing.four,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
  },
  map: {
    flex: 1,
  },
});
