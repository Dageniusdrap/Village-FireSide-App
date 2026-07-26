import { StyleSheet, View } from "react-native";

import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function Skeleton({ width, height }: { width: number | `${number}%`; height: number }) {
  const theme = useTheme();

  return (
    <View style={[styles.block, { width, height, backgroundColor: theme.backgroundSelected }]} />
  );
}

const styles = StyleSheet.create({
  block: {
    borderRadius: Spacing.two,
  },
});
