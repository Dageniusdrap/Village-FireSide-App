// apps/mobile/src/components/ui/button.tsx
import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type ButtonProps = Omit<PressableProps, "style"> & {
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
};

export function Button({ label, variant = "primary", loading, disabled, ...rest }: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const backgroundColor =
    variant === "primary" ? theme.primary : variant === "secondary" ? theme.accent : "transparent";
  const textColor = variant === "ghost" ? theme.primary : theme.background;

  return (
    <Pressable
      style={[styles.base, { backgroundColor }, isDisabled ? styles.disabled : null]}
      disabled={isDisabled}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <ThemedText type="default" style={{ color: textColor }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
});
