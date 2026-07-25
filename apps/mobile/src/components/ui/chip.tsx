// apps/mobile/src/components/ui/chip.tsx
import { Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const textColor = selected ? theme.background : theme.textSecondary;

  return (
    <Pressable
      style={[
        styles.chip,
        { backgroundColor: selected ? theme.accent : theme.accentSoft, borderColor: theme.border },
      ]}
      onPress={onPress}
    >
      <ThemedText type="small" style={{ color: textColor }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    borderRadius: Spacing.four,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
});
