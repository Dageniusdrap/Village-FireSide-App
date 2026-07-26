/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import "@/global.css";

import { Platform } from "react-native";

export const Colors = {
  light: {
    primary: "#1F3B2C",
    primaryPressed: "#16291F",
    accent: "#C1652F",
    accentSoft: "#F2DCC9",
    background: "#FAF6EF",
    backgroundElement: "#FFFFFF",
    backgroundSelected: "#EFE3D0",
    text: "#1C1B18",
    textSecondary: "#6B6459",
    gold: "#C08A28",
    border: "#E4D9C5",
    error: "#C0392B",
    success: "#2E7D4F",
  },
  dark: {
    primary: "#4C7A5A",
    primaryPressed: "#3A5D45",
    accent: "#E08A54",
    accentSoft: "#3A2A1E",
    background: "#14181A",
    backgroundElement: "#1E2422",
    backgroundSelected: "#262E2B",
    text: "#F2EFE8",
    textSecondary: "#A9A79D",
    gold: "#E0B24A",
    border: "#2E3532",
    error: "#E57368",
    success: "#4CAF77",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = {
  serif: "Lora_600SemiBold",
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemiBold: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
  mono:
    Platform.select({
      ios: "ui-monospace",
      web: "var(--font-mono)",
      default: "monospace",
    }) ?? "monospace",
  rounded:
    Platform.select({
      ios: "ui-rounded",
      web: "var(--font-rounded)",
      default: "normal",
    }) ?? "normal",
};

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
