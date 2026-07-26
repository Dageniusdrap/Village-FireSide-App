// apps/mobile/src/components/ui/series-card.tsx
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { Spacing } from "@/constants/theme";

export function SeriesCard({
  title,
  coverImageUrl,
  category,
  episodeCount,
  onPress,
}: {
  title: string;
  coverImageUrl: string | null;
  category: string | null;
  episodeCount: number;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.pressable}>
      <Card style={styles.card}>
        {coverImageUrl ? (
          <Image source={{ uri: coverImageUrl }} style={styles.cover} contentFit="cover" />
        ) : null}
        <View style={styles.body}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {title}
          </ThemedText>
          {category ? (
            <ThemedText type="small" themeColor="textSecondary">
              {category}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {episodeCount} episodes
          </ThemedText>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: 160,
  },
  card: {
    padding: 0,
    overflow: "hidden",
    gap: Spacing.two,
  },
  cover: {
    width: "100%",
    height: 100,
  },
  body: {
    padding: Spacing.two,
    gap: Spacing.half,
  },
});
