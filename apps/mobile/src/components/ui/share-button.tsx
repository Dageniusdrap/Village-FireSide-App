import { Pressable, Share, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

export function ShareButton({ url }: { url: string }) {
  const onPress = () => {
    Share.share({ message: url }).catch(() => {});
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Share"
      hitSlop={Spacing.two}
    >
      <ThemedText type="default" themeColor="textSecondary" style={styles.icon}>
        ⤴ Share
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  icon: {},
});
