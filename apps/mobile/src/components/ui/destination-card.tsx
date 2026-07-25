// apps/mobile/src/components/ui/destination-card.tsx
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { Spacing } from "@/constants/theme";

export function DestinationCard({
  name,
  region,
  coverImageUrl,
  onPress,
}: {
  name: string;
  region: string | null;
  coverImageUrl: string | null;
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
            {name}
          </ThemedText>
          {region ? (
            <ThemedText type="small" themeColor="textSecondary">
              {region}
            </ThemedText>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: 200,
  },
  card: {
    padding: 0,
    overflow: "hidden",
    gap: Spacing.two,
  },
  cover: {
    width: "100%",
    height: 120,
  },
  body: {
    padding: Spacing.two,
    gap: Spacing.half,
  },
});
