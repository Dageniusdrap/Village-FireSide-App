# Mobile App Shell, Theme & Navigation (Prompt 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mobile app's tab-navigation shell, warm African-nature design system, and a persistent (currently inert) MiniPlayer, per `docs/PROMPT_PACK.md`'s Prompt 6, using mock data standing in for the real Supabase queries Prompt 7 adds later.

**Architecture:** Extends the existing `Colors`/`Fonts`/`Spacing` tokens in `apps/mobile/src/constants/theme.ts` and the existing `ThemedText`/`ThemedView` primitives (built in Prompt 5) with a warm forest-green/terracotta palette and Google Fonts (Lora serif, Inter sans). A new `components/ui/` design system (`Button`, `Card`, `Chip`, `SectionHeader`, `SourceBadge`, `EpisodeRow`, `SeriesCard`, `DestinationCard`, `MiniPlayer`) is built on top. Navigation replaces `(app)`'s current bare `<Stack>` with a nested `(tabs)` Expo Router group (5 screens) plus the `MiniPlayer` rendered as a sibling overlay. A new, empty-logic-for-now zustand `player-store.ts` backs the `MiniPlayer`.

**Tech Stack:** `@expo-google-fonts/lora`, `@expo-google-fonts/inter` (font loading via the already-installed `expo-font`), `@expo/vector-icons` (tab bar icons), `expo-image` (already installed, used for card artwork), `zustand` (already installed, player store), Jest (one new pure-function unit test).

## Global Constraints

- No Supabase CLI, no Docker, no live device/simulator in this environment — every task is verified by `pnpm typecheck` + `pnpm lint` (+ a real unit test for `SourceBadge`'s pure content-mapping function), never by running the app.
- Use `npx expo install <package>` (not `pnpm add`) for Expo/React-Native-ecosystem packages, so the SDK-compatible version resolves automatically — matches this project's established convention (see Prompt 5's Task 2/3).
- `ThemedText`/`ThemedView`'s existing public API (`type`, `themeColor` props) must not change — the 8 auth screens built in Prompt 5 depend on it and must continue to typecheck and inherit the new palette with no code changes of their own.
- Non-goals, explicitly out of scope for this plan: real content/data fetching (Prompt 7), audio playback logic (Prompt 8), map-based destination browsing/education-mode filtering/favorites/downloads/coins/premium UI (Prompts 9, 10, 11, 12), wiring `useRequireAuth`/`SignInPromptSheet` (Prompt 5) to any gated action (no such action exists yet), any change to `apps/admin`.
- Every episode shown anywhere in this plan's screens must render its `SourceBadge`, per `docs/schema.md`'s "Narrated-production labeling rule" (every episode with `content_source` other than `elder_testimony` must show a "Narrated production" label; `elder_testimony` shows "Elder testimony").
- Mock data types in `src/types/content.ts` mirror the real `episodes`/`series`/`destinations` column names/shapes from `docs/schema.md` (not invented field names), so Prompt 7 can swap in real Supabase queries without restructuring the UI.
- `apps/mobile/src/app/_layout.tsx`'s existing four-branch auth-redirect logic (built and security-reviewed in Prompt 5: `!session && !guestMode` → `/welcome`; `session && passwordRecovery` → `/reset-password`; `session && !passwordRecovery` → `/`; `!session && guestMode` → `/`) must not change in this plan — only the splash-screen-hide condition gains a font-loaded check.

---

### Task 1: Color palette & typography tokens

**Files:**

- Modify: `apps/mobile/src/constants/theme.ts`
- Modify: `apps/mobile/src/components/themed-text.tsx`

**Interfaces:**

- Consumes: nothing new.
- Produces: an expanded `Colors.light`/`Colors.dark` (new keys: `primary`, `primaryPressed`, `accent`, `accentSoft`, `backgroundSelected` (already existed), `gold`, `border`, `error`, `success`, plus existing `text`/`background`/`backgroundElement`/`textSecondary` unchanged) and an expanded `Fonts` (`serif`, `sans`, `sansMedium`, `sansSemiBold`, `sansBold` — new; `mono`, `rounded` — unchanged values, restructured) — consumed by every later task in this plan, and by Prompt 5's existing `ThemedText`/`ThemedView` consumers with no code changes on their end.

- [ ] **Step 1: Install the font packages**

```bash
cd apps/mobile
npx expo install @expo-google-fonts/lora @expo-google-fonts/inter
cd ../..
```

`expo-font` (the underlying loader `useFonts()` is built on) is already installed (`apps/mobile/package.json` has `"expo-font": "~57.0.1"`) — do not reinstall it.

- [ ] **Step 2: Rewrite `theme.ts`'s `Colors` and `Fonts`**

Read the current file first (`apps/mobile/src/constants/theme.ts`) — only `Colors` and `Fonts` change; `Spacing`, `BottomTabInset`, `MaxContentWidth`, and the `ThemeColor` type declaration are unchanged (though `ThemeColor` will automatically widen since it's derived from `Colors.light`'s keys via `keyof typeof`).

Replace the `Colors` and `Fonts` exports with:

```ts
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
```

`serif`/`sans`/`sansMedium`/`sansSemiBold`/`sansBold` are Expo Google Fonts PostScript names, loaded via `useFonts()` in Task 2 — identical across all platforms, unlike the old system-font `Platform.select`. `mono`/`rounded` keep their exact prior per-platform values (just restructured from one shared `Platform.select({ios:{...},default:{...},web:{...}})` call into two independent per-key calls) since nothing in this plan changes monospace/rounded typography.

The `import { Platform } from "react-native";` line at the top of the file stays (still needed for `mono`/`rounded`).

- [ ] **Step 3: Rewrite `themed-text.tsx`'s styles to use the new fonts, and fix `linkPrimary`'s hardcoded color**

Read the current file first. `styles.linkPrimary` currently hardcodes `color: "#3c87f7"` (a leftover template blue that never actually themes — it permanently overrides whatever `theme[themeColor]` color `ThemedText` computes, in both light and dark mode, since it's the last style applied). Fix this by making `linkPrimary` default to the theme's `primary` color instead of `text` when no explicit `themeColor` prop is passed, and removing the hardcoded hex:

```tsx
import { Platform, StyleSheet, Text, type TextProps } from "react-native";

import { Fonts, ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type ThemedTextProps = TextProps & {
  type?: "default" | "title" | "small" | "smallBold" | "subtitle" | "link" | "linkPrimary" | "code";
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = "default", themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const defaultColorKey: ThemeColor = type === "linkPrimary" ? "primary" : "text";

  return (
    <Text
      style={[
        { color: theme[themeColor ?? defaultColorKey] },
        type === "default" && styles.default,
        type === "title" && styles.title,
        type === "small" && styles.small,
        type === "smallBold" && styles.smallBold,
        type === "subtitle" && styles.subtitle,
        type === "link" && styles.link,
        type === "linkPrimary" && styles.linkPrimary,
        type === "code" && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.sansMedium,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.sansBold,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: Fonts.sansMedium,
  },
  title: {
    fontSize: 48,
    lineHeight: 52,
    fontFamily: Fonts.serif,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontFamily: Fonts.serif,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    fontFamily: Fonts.sansSemiBold,
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
```

Every `fontWeight` number that used to pair with a generic system font is removed — Google Fonts ships one file per weight, so the weight now comes entirely from which `fontFamily` is selected, not a `fontWeight` override (mixing both would have RN try to fake-embolden an already-weighted font file). `code`'s `fontWeight`/`Platform.select` pairing is untouched, since `mono` isn't a Google Font.

- [ ] **Step 4: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both pass. This is a pure token/style change with no new logic, so no test is added for this task (consistent with how Prompt 5 treated purely-structural theme/type changes) — later tasks that consume `Colors`/`Fonts` are what get tested/verified.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/constants/theme.ts apps/mobile/src/components/themed-text.tsx apps/mobile/package.json apps/mobile/pnpm-lock.yaml pnpm-lock.yaml
git commit -m "feat: add warm African-nature color palette and Google Fonts typography"
```

If the workspace uses a single root `pnpm-lock.yaml` (check with `git status` — only files that actually changed need to be added; drop any path above that `git status` doesn't show as modified).

---

### Task 2: Load fonts in the root layout

**Files:**

- Modify: `apps/mobile/src/app/_layout.tsx`

**Interfaces:**

- Consumes: `Inter_400Regular`/`Inter_500Medium`/`Inter_600SemiBold`/`Inter_700Bold` (from `@expo-google-fonts/inter`, Task 1), `Lora_600SemiBold` (from `@expo-google-fonts/lora`, Task 1), `useFonts` (from `expo-font`).
- Produces: nothing new consumed by later tasks — this task only changes when the splash screen hides.

This file is security/architecture-sensitive: Prompt 5's whole-branch review specifically traced its four-branch auth-redirect logic for correctness. This task changes ONLY the splash-screen-hide condition (adding a font-loaded check) — the redirect branches themselves must be byte-for-byte unchanged.

- [ ] **Step 1: Add font loading, gating the splash-screen hide on both auth-loading and fonts-loaded**

Read the current file first (`apps/mobile/src/app/_layout.tsx`). Add the font imports and a `useFonts()` call, and change every place that currently checks only `loading` to also check `fontsLoaded`:

```tsx
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Lora_600SemiBold } from "@expo-google-fonts/lora";
import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { ThemedView } from "@/components/themed-view";
import { useAuthListener } from "@/hooks/use-auth-listener";
import { useRecoveryLinkHandler } from "@/hooks/use-recovery-link-handler";
import { useAuthStore } from "@/stores/auth-store";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useAuthListener();
  useRecoveryLinkHandler();

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Lora_600SemiBold,
  });

  const loading = useAuthStore((state) => state.loading);
  const session = useAuthStore((state) => state.session);
  const guestMode = useAuthStore((state) => state.guestMode);
  const passwordRecovery = useAuthStore((state) => state.passwordRecovery);

  useEffect(() => {
    if (!loading && fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [loading, fontsLoaded]);

  const theme = colorScheme === "dark" ? DarkTheme : DefaultTheme;

  if (loading || !fontsLoaded) {
    return (
      <ThemeProvider value={theme}>
        <ThemedView style={styles.loadingContainer}>
          <ActivityIndicator />
        </ThemedView>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={theme}>
      <AnimatedSplashOverlay />
      {!session && !guestMode && <Redirect href="/welcome" />}
      {session && passwordRecovery && <Redirect href="/reset-password" />}
      {session && !passwordRecovery && <Redirect href="/" />}
      {!session && guestMode && <Redirect href="/" />}
      <Slot />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
```

The four `<Redirect>` lines are copied verbatim from the current file — do not alter their conditions.

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Verify the redirect logic is unchanged**

```bash
git diff apps/mobile/src/app/_layout.tsx | grep -A1 "Redirect href"
```

Expected: the diff shows no `+`/`-` lines touching any `<Redirect href=...>` line — only the `loading`/`fontsLoaded` conditions and the new imports/`useFonts()` call should appear as additions.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/_layout.tsx
git commit -m "feat: load Google Fonts before hiding the splash screen"
```

---

### Task 3: Content types and mock data

**Files:**

- Create: `apps/mobile/src/types/content.ts`
- Create: `apps/mobile/src/mocks/content.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `ContentSource`, `AccessTier`, `Episode`, `Series`, `Destination` types, and `mockEpisodes`, `mockSeries`, `mockDestinations` arrays — consumed by Task 4 (`SourceBadge`'s `source: ContentSource` prop), Task 6 (`EpisodeRow`/`SeriesCard`/`DestinationCard`'s props), Task 7 (`player-store.ts`'s `currentEpisode: Episode | null`), and Tasks 10-11 (Home/Explore screens).

No test for these two files — they're plain type declarations and static data with no branching logic to assert on (same reasoning Prompt 5 applied to its own thin, logic-free files).

- [ ] **Step 1: Write the content types**

```ts
// apps/mobile/src/types/content.ts
export type ContentSource =
  "elder_testimony" | "narrated_production" | "ai_assisted" | "tour_guide_original";

export type AccessTier = "free" | "coins" | "premium";

export type Episode = {
  id: string;
  title: string;
  durationSeconds: number | null;
  accessTier: AccessTier;
  contentSource: ContentSource;
};

export type Series = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  category: string | null;
  episodeCount: number;
};

export type Destination = {
  id: string;
  name: string;
  region: string | null;
  coverImageUrl: string | null;
};
```

Field names and value sets are matched to `docs/schema.md`'s `episodes`/`series`/`destinations` tables and its `content_source`/`access_tier` enums (not invented) so Prompt 7 can swap this file's arrays for real Supabase queries without changing the type shape.

- [ ] **Step 2: Write the mock data**

```ts
// apps/mobile/src/mocks/content.ts
import type { Destination, Episode, Series } from "@/types/content";

export const mockEpisodes: Episode[] = [
  {
    id: "ep-1",
    title: "The Lake That Remembers",
    durationSeconds: 642,
    accessTier: "free",
    contentSource: "elder_testimony",
  },
  {
    id: "ep-2",
    title: "How the Baobab Got Its Shape",
    durationSeconds: 518,
    accessTier: "coins",
    contentSource: "narrated_production",
  },
  {
    id: "ep-3",
    title: "The Drummer of Kabale Hills",
    durationSeconds: 731,
    accessTier: "premium",
    contentSource: "ai_assisted",
  },
];

export const mockSeries: Series[] = [
  {
    id: "series-1",
    title: "Lakeside Legends",
    coverImageUrl: "https://placehold.co/400x400?text=Lakeside+Legends",
    category: "lakes",
    episodeCount: 8,
  },
  {
    id: "series-2",
    title: "Elder History",
    coverImageUrl: "https://placehold.co/400x400?text=Elder+History",
    category: "elder_history",
    episodeCount: 12,
  },
  {
    id: "series-3",
    title: "Hidden Africa",
    coverImageUrl: "https://placehold.co/400x400?text=Hidden+Africa",
    category: "hidden_africa",
    episodeCount: 5,
  },
];

export const mockDestinations: Destination[] = [
  {
    id: "dest-1",
    name: "Lake Bunyonyi",
    region: "Kigezi",
    coverImageUrl: "https://placehold.co/400x300?text=Lake+Bunyonyi",
  },
  {
    id: "dest-2",
    name: "Sipi Falls",
    region: "Mount Elgon",
    coverImageUrl: "https://placehold.co/400x300?text=Sipi+Falls",
  },
  {
    id: "dest-3",
    name: "Kibale Forest",
    region: "Western Region",
    coverImageUrl: "https://placehold.co/400x300?text=Kibale+Forest",
  },
];
```

- [ ] **Step 3: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/types/content.ts apps/mobile/src/mocks/content.ts
git commit -m "feat: add mobile content types and mock data"
```

---

### Task 4: `SourceBadge` (TDD)

**Files:**

- Create: `apps/mobile/src/lib/source-badge.ts`
- Test: `apps/mobile/src/lib/source-badge.test.ts`
- Create: `apps/mobile/src/components/ui/source-badge.tsx`

**Interfaces:**

- Consumes: `ContentSource` (Task 3).
- Produces: `getSourceBadgeContent(source: ContentSource): { label: string; variant: "gold" | "neutral" }` (pure, tested) and `<SourceBadge source: ContentSource />` — consumed by Task 6's `EpisodeRow`.

Following this codebase's established split (Prompt 5's `phone.ts`/`recovery-link.ts`): pure branching logic lives in `src/lib/*.ts` and is unit tested; the thin rendering wrapper in `src/components/ui/*.tsx` is not.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/source-badge.test.ts
import { getSourceBadgeContent } from "./source-badge";

describe("getSourceBadgeContent", () => {
  it("labels elder testimony in gold", () => {
    expect(getSourceBadgeContent("elder_testimony")).toEqual({
      label: "Elder testimony",
      variant: "gold",
    });
  });

  it("labels narrated production as neutral", () => {
    expect(getSourceBadgeContent("narrated_production")).toEqual({
      label: "Narrated production",
      variant: "neutral",
    });
  });

  it("labels AI-assisted content as neutral 'Narrated production'", () => {
    expect(getSourceBadgeContent("ai_assisted")).toEqual({
      label: "Narrated production",
      variant: "neutral",
    });
  });

  it("labels tour-guide-original content as neutral 'Narrated production'", () => {
    expect(getSourceBadgeContent("tour_guide_original")).toEqual({
      label: "Narrated production",
      variant: "neutral",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && npx jest src/lib/source-badge.test.ts
```

Expected: FAIL with a module-not-found error for `./source-badge`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/lib/source-badge.ts
import type { ContentSource } from "@/types/content";

export type SourceBadgeContent = {
  label: string;
  variant: "gold" | "neutral";
};

export function getSourceBadgeContent(source: ContentSource): SourceBadgeContent {
  if (source === "elder_testimony") {
    return { label: "Elder testimony", variant: "gold" };
  }
  return { label: "Narrated production", variant: "neutral" };
}
```

This satisfies `docs/schema.md`'s labeling rule for all three non-elder-testimony sources (`narrated_production`, `ai_assisted`, `tour_guide_original`) by falling through to the same "Narrated production" label, matching the rule's exact wording ("Every episode with `content_source` of `narrated_production` or `ai_assisted` must show a 'Narrated production' label" — extended here to `tour_guide_original` too, since that source is equally not elder testimony and the rule's intent is clearly "elder testimony gets its own label, everything else says narrated production").

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && npx jest src/lib/source-badge.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the `SourceBadge` component**

```tsx
// apps/mobile/src/components/ui/source-badge.tsx
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { getSourceBadgeContent } from "@/lib/source-badge";
import type { ContentSource } from "@/types/content";

export function SourceBadge({ source }: { source: ContentSource }) {
  const theme = useTheme();
  const { label, variant } = getSourceBadgeContent(source);
  const backgroundColor = variant === "gold" ? theme.gold : theme.accentSoft;
  const textColor = variant === "gold" ? "#3A2A1E" : theme.textSecondary;

  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <ThemedText type="small" style={{ color: textColor }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});
```

`variant === "gold"`'s text color is a fixed dark brown (`#3A2A1E`, matching `Colors.dark.accentSoft`) rather than a theme-switched value — the gold badge background (`theme.gold`) is mid-brightness in both light and dark mode, so a single fixed dark text color reads correctly against it either way, and doesn't need to track color-scheme changes.

- [ ] **Step 6: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/source-badge.ts apps/mobile/src/lib/source-badge.test.ts apps/mobile/src/components/ui/source-badge.tsx
git commit -m "feat: add SourceBadge component with tested content-source label mapping"
```

---

### Task 5: Base design system primitives — `Button`, `Card`, `Chip`, `SectionHeader`

**Files:**

- Create: `apps/mobile/src/components/ui/button.tsx`
- Create: `apps/mobile/src/components/ui/card.tsx`
- Create: `apps/mobile/src/components/ui/chip.tsx`
- Create: `apps/mobile/src/components/ui/section-header.tsx`

**Interfaces:**

- Consumes: `Colors`/`Spacing` (Task 1), `ThemedText`/`useTheme` (existing, Prompt 5).
- Produces: `<Button variant? label onPress disabled? loading? />`, `<Card style? children />`, `<Chip label selected? onPress? />`, `<SectionHeader title actionLabel? onActionPress? />` — consumed by Task 6 (`Card` by `SeriesCard`/`DestinationCard`), Task 9 (`Button` by the Profile screen), and Tasks 10-13 (`SectionHeader` by every tab screen, `Chip` by Learn).

No tests for these four files — thin, purely presentational wrappers with no branching logic (same reasoning as Prompt 5's `FormError`/`SignInPromptSheet`), verified by typecheck/lint.

- [ ] **Step 1: Write `Button`**

```tsx
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
```

- [ ] **Step 2: Write `Card`**

```tsx
// apps/mobile/src/components/ui/card.tsx
import { StyleSheet, View, type ViewProps } from "react-native";

import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
  },
});
```

- [ ] **Step 3: Write `Chip`**

```tsx
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
```

- [ ] **Step 4: Write `SectionHeader`**

```tsx
// apps/mobile/src/components/ui/section-header.tsx
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

export function SectionHeader({
  title,
  actionLabel,
  onActionPress,
}: {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
}) {
  return (
    <View style={styles.row}>
      <ThemedText type="subtitle" style={styles.title}>
        {title}
      </ThemedText>
      {actionLabel && onActionPress ? (
        <Pressable onPress={onActionPress}>
          <ThemedText type="linkPrimary">{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.three,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
  },
});
```

`title` keeps `type="subtitle"`'s serif `fontFamily` but overrides the size down from 32/44 to 22/28 — full subtitle size reads too large for a repeated section label, but the serif family still ties it visually to episode/series titles elsewhere on screen.

- [ ] **Step 5: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/ui/button.tsx apps/mobile/src/components/ui/card.tsx apps/mobile/src/components/ui/chip.tsx apps/mobile/src/components/ui/section-header.tsx
git commit -m "feat: add Button, Card, Chip, and SectionHeader design system primitives"
```

---

### Task 6: Content display components — `EpisodeRow`, `SeriesCard`, `DestinationCard`

**Files:**

- Create: `apps/mobile/src/components/ui/episode-row.tsx`
- Create: `apps/mobile/src/components/ui/series-card.tsx`
- Create: `apps/mobile/src/components/ui/destination-card.tsx`

**Interfaces:**

- Consumes: `Card` (Task 5), `SourceBadge` (Task 4), `AccessTier`/`ContentSource` (Task 3).
- Produces: `<EpisodeRow title durationSeconds accessTier contentSource onPress? />`, `<SeriesCard title coverImageUrl category episodeCount onPress? />`, `<DestinationCard name region coverImageUrl onPress? />` — consumed by Tasks 10-11 (Home, Explore).

No tests — presentational, no branching logic beyond `EpisodeRow`'s `formatDuration` helper, which is trivial enough (one division, one modulo, one pad) that it doesn't warrant a separate tested module — verified by typecheck/lint.

- [ ] **Step 1: Write `EpisodeRow`**

```tsx
// apps/mobile/src/components/ui/episode-row.tsx
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { SourceBadge } from "@/components/ui/source-badge";
import { Spacing } from "@/constants/theme";
import type { AccessTier, ContentSource } from "@/types/content";

function formatDuration(durationSeconds: number | null): string {
  if (durationSeconds === null) {
    return "—";
  }
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function EpisodeRow({
  title,
  durationSeconds,
  accessTier,
  contentSource,
  onPress,
}: {
  title: string;
  durationSeconds: number | null;
  accessTier: AccessTier;
  contentSource: ContentSource;
  onPress?: () => void;
}) {
  const isLocked = accessTier !== "free";

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <ThemedText type="default" themeColor="primary" style={styles.playIcon}>
        ▶
      </ThemedText>
      <View style={styles.info}>
        <ThemedText type="default">{title}</ThemedText>
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDuration(durationSeconds)}
          </ThemedText>
          <SourceBadge source={contentSource} />
        </View>
      </View>
      <ThemedText type="small" themeColor={isLocked ? "textSecondary" : "primary"}>
        {isLocked ? "🔒" : "Free"}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  playIcon: {
    width: Spacing.four,
    textAlign: "center",
  },
  info: {
    flex: 1,
    gap: Spacing.one,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
});
```

Every `EpisodeRow` renders a `SourceBadge` — this is what makes `docs/schema.md`'s mandatory labeling rule actually true in the UI, not just a component that exists but is never shown.

- [ ] **Step 2: Write `SeriesCard`**

```tsx
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
```

- [ ] **Step 3: Write `DestinationCard`**

```tsx
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
```

`expo-image`'s `Image` (not React Native core's `Image`) is used for both cards, matching this codebase's existing convention (`apps/mobile/src/components/animated-icon.tsx` and `web-badge.tsx` already use `expo-image`).

- [ ] **Step 4: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/ui/episode-row.tsx apps/mobile/src/components/ui/series-card.tsx apps/mobile/src/components/ui/destination-card.tsx
git commit -m "feat: add EpisodeRow, SeriesCard, and DestinationCard components"
```

---

### Task 7: Player store (zustand)

**Files:**

- Create: `apps/mobile/src/stores/player-store.ts`

**Interfaces:**

- Consumes: `Episode` (Task 3).
- Produces: `usePlayerStore` exposing `currentEpisode: Episode | null`, `isPlaying: boolean`, `expanded: boolean`, `play(episode: Episode): void`, `pause(): void`, `expand(): void`, `collapse(): void` — consumed by Task 8's `MiniPlayer`. `play`/`pause` are state-only stubs with no real audio engine; Prompt 8 replaces their bodies.

No test — a thin zustand store with plain setters and no branching (same reasoning Prompt 5 originally applied to its own `auth-store.ts`, before that file later gained real conditional logic and a test in a different task — this store has no such logic).

- [ ] **Step 1: Write the store**

```ts
// apps/mobile/src/stores/player-store.ts
import { create } from "zustand";

import type { Episode } from "@/types/content";

type PlayerState = {
  currentEpisode: Episode | null;
  isPlaying: boolean;
  expanded: boolean;
  play: (episode: Episode) => void;
  pause: () => void;
  expand: () => void;
  collapse: () => void;
};

export const usePlayerStore = create<PlayerState>((set) => ({
  currentEpisode: null,
  isPlaying: false,
  expanded: false,
  play: (episode) => set({ currentEpisode: episode, isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  expand: () => set({ expanded: true }),
  collapse: () => set({ expanded: false }),
}));
```

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/stores/player-store.ts
git commit -m "feat: add empty-logic player store for the MiniPlayer"
```

---

### Task 8: `MiniPlayer`

**Files:**

- Create: `apps/mobile/src/components/ui/mini-player.tsx`

**Interfaces:**

- Consumes: `usePlayerStore` (Task 7), `Card` (Task 5), `BottomTabInset`/`Spacing` (existing/Task 1).
- Produces: `<MiniPlayer />` (no props — reads directly from `usePlayerStore`) — consumed by Task 9's `(app)/_layout.tsx`.

No test — presentational, its only logic is `currentEpisode ? render : null` and a play/pause label toggle, both trivial and unverifiable without a render environment this project doesn't have (same reasoning as every other Prompt 5/6 screen-level component).

- [ ] **Step 1: Write the component**

```tsx
// apps/mobile/src/components/ui/mini-player.tsx
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { BottomTabInset, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { usePlayerStore } from "@/stores/player-store";

export function MiniPlayer() {
  const theme = useTheme();
  const currentEpisode = usePlayerStore((state) => state.currentEpisode);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const play = usePlayerStore((state) => state.play);
  const pause = usePlayerStore((state) => state.pause);
  const expand = usePlayerStore((state) => state.expand);

  if (!currentEpisode) {
    return null;
  }

  return (
    <Pressable style={[styles.container, { bottom: BottomTabInset }]} onPress={expand}>
      <Card style={styles.card}>
        <View style={[styles.artworkPlaceholder, { backgroundColor: theme.accentSoft }]} />
        <ThemedText type="small" style={styles.title} numberOfLines={1}>
          {currentEpisode.title}
        </ThemedText>
        <Pressable
          onPress={() => (isPlaying ? pause() : play(currentEpisode))}
          hitSlop={Spacing.two}
        >
          <ThemedText type="default" themeColor="primary">
            {isPlaying ? "⏸" : "▶"}
          </ThemedText>
        </Pressable>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginHorizontal: Spacing.two,
    padding: Spacing.two,
  },
  artworkPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: Spacing.one,
  },
  title: {
    flex: 1,
  },
});
```

`currentEpisode` has no artwork-URL field on the `Episode` type (Task 3), so a plain colored `View` stands in for cover art — real artwork arrives whenever a future prompt adds that field and wires real playback. `bottom: BottomTabInset` positions the bar just above the tab bar using the same constant Prompt 1's scaffold already defined for this purpose.

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/ui/mini-player.tsx
git commit -m "feat: add MiniPlayer overlay component"
```

---

### Task 9: Tab navigation shell

**Files:**

- Delete: `apps/mobile/src/app/(app)/index.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`
- Create: `apps/mobile/src/app/(app)/(tabs)/_layout.tsx`
- Create: `apps/mobile/src/app/(app)/(tabs)/profile.tsx`

**Interfaces:**

- Consumes: `MiniPlayer` (Task 8), `Button`/`SectionHeader` (Task 5), `useTheme` (existing).
- Produces: the `(tabs)` Expo Router group and its 5-tab `<Tabs>` navigator (4 of its screens — `index`, `explore`, `learn`, `library` — are created by Tasks 10-13; `profile` is created here) that Tasks 10-13's screens are added into.

No tests — Expo Router navigation, same untestable-in-this-environment reasoning as every navigation file in Prompt 5.

- [ ] **Step 1: Install `@expo/vector-icons`**

```bash
cd apps/mobile
npx expo install @expo/vector-icons
cd ../..
```

Confirmed via `node_modules` search that this package is not currently installed in `apps/mobile`, despite often shipping by default in Expo templates — do not assume it's already available. `@expo/vector-icons`' icon fonts are bundled and made available automatically by Expo's asset pipeline; no `useFonts()` call is needed for them (unlike Task 2's Google Fonts, which are loaded explicitly because they're not part of Expo's built-in asset set). If you find this assumption doesn't hold against the installed package's own documentation, note it in your report rather than silently working around it.

- [ ] **Step 2: Delete the old placeholder screen**

```bash
git rm "apps/mobile/src/app/(app)/index.tsx"
```

Its content moves into `(tabs)/profile.tsx` in Step 4 below, restyled with the new design system.

- [ ] **Step 3: Rewrite `(app)/_layout.tsx` to render the tabs group plus the MiniPlayer overlay**

```tsx
// apps/mobile/src/app/(app)/_layout.tsx
import { Slot } from "expo-router";
import { StyleSheet, View } from "react-native";

import { MiniPlayer } from "@/components/ui/mini-player";

export default function AppLayout() {
  return (
    <View style={styles.container}>
      <Slot />
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
```

This replaces the current bare `<Stack screenOptions={{ headerShown: false }} />`. `<Slot />` renders whichever child route is active — here, that's always the `(tabs)` group's own layout (Step 4) — while `<MiniPlayer />` sits as a sibling overlay so it's visible above every tab.

- [ ] **Step 4: Write the tabs layout**

```tsx
// apps/mobile/src/app/(app)/(tabs)/_layout.tsx
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { useTheme } from "@/hooks/use-theme";

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.backgroundElement, borderTopColor: theme.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: "Learn",
          tabBarIcon: ({ color, size }) => <Ionicons name="school" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color, size }) => <Ionicons name="bookmark" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 5: Write the Profile screen**

```tsx
// apps/mobile/src/app/(app)/(tabs)/profile.tsx
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export default function ProfileScreen() {
  const session = useAuthStore((state) => state.session);
  const guestMode = useAuthStore((state) => state.guestMode);
  const signOut = useAuthStore((state) => state.signOut);

  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      // Resetting local state to match the absence of a session, not a cascading render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayName(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) {
          setDisplayName(data?.display_name ?? null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader title="Profile" />
        <ThemedText type="default">
          {guestMode ? "Browsing as Guest" : `Signed in as ${displayName ?? "…"}`}
        </ThemedText>
        <Button
          label={guestMode ? "Sign In" : "Sign Out"}
          variant="ghost"
          onPress={() => void signOut()}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
```

The session-fetch/`display_name` effect and the sign-out button's behavior (in guest mode, pressing "Sign In" calls `signOut()`, which clears `guestMode` and lets the root layout's redirect send the user to `/welcome` to actually sign in) are copied verbatim from the deleted `(app)/index.tsx` — this task only relocates and restyles them with the new design system; it does not change the underlying auth logic, which is out of this plan's scope.

- [ ] **Step 6: Verify typecheck and lint, and confirm no dangling references to the deleted file**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
grep -rn "app)/index" apps/mobile/src || echo "no dangling references"
```

Expected: both pass, and the grep finds nothing (or prints "no dangling references").

- [ ] **Step 7: Commit**

```bash
git add -A "apps/mobile/src/app/(app)"
git commit -m "feat: add tab navigation shell with MiniPlayer overlay"
```

---

### Task 10: Home screen

**Files:**

- Create: `apps/mobile/src/app/(app)/(tabs)/index.tsx`

**Interfaces:**

- Consumes: `SectionHeader` (Task 5), `EpisodeRow`/`SeriesCard` (Task 6), `mockEpisodes`/`mockSeries` (Task 3).
- Produces: the tabs group's `index` route (Home tab) that Task 9's `<Tabs.Screen name="index">` renders.

No test — screen-level scaffold, same reasoning as every other screen in this plan.

- [ ] **Step 1: Write the screen**

```tsx
// apps/mobile/src/app/(app)/(tabs)/index.tsx
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EpisodeRow } from "@/components/ui/episode-row";
import { SectionHeader } from "@/components/ui/section-header";
import { SeriesCard } from "@/components/ui/series-card";
import { Spacing } from "@/constants/theme";
import { mockEpisodes, mockSeries } from "@/mocks/content";

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Continue Listening" />
        {mockEpisodes.map((episode) => (
          <EpisodeRow
            key={episode.id}
            title={episode.title}
            durationSeconds={episode.durationSeconds}
            accessTier={episode.accessTier}
            contentSource={episode.contentSource}
          />
        ))}

        <SectionHeader title="Popular Series" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {mockSeries.map((series) => (
            <SeriesCard
              key={series.id}
              title={series.title}
              coverImageUrl={series.coverImageUrl}
              category={series.category}
              episodeCount={series.episodeCount}
            />
          ))}
        </ScrollView>
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
    gap: Spacing.four,
  },
  row: {
    gap: Spacing.three,
  },
});
```

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(app)/(tabs)/index.tsx"
git commit -m "feat: add Home tab screen with mock episodes and series"
```

---

### Task 11: Explore screen

**Files:**

- Create: `apps/mobile/src/app/(app)/(tabs)/explore.tsx`

**Interfaces:**

- Consumes: `SectionHeader` (Task 5), `DestinationCard` (Task 6), `mockDestinations` (Task 3).
- Produces: the tabs group's `explore` route.

No test — same reasoning as Task 10.

- [ ] **Step 1: Write the screen**

```tsx
// apps/mobile/src/app/(app)/(tabs)/explore.tsx
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DestinationCard } from "@/components/ui/destination-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { mockDestinations } from "@/mocks/content";

export default function ExploreScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Destinations" />
        <View style={styles.grid}>
          {mockDestinations.map((destination) => (
            <DestinationCard
              key={destination.id}
              name={destination.name}
              region={destination.region}
              coverImageUrl={destination.coverImageUrl}
            />
          ))}
        </View>
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
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
  },
});
```

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(app)/(tabs)/explore.tsx"
git commit -m "feat: add Explore tab screen with mock destinations"
```

---

### Task 12: Learn screen

**Files:**

- Create: `apps/mobile/src/app/(app)/(tabs)/learn.tsx`

**Interfaces:**

- Consumes: `SectionHeader`/`Chip` (Task 5).
- Produces: the tabs group's `learn` route.

No test — same reasoning as Task 10.

- [ ] **Step 1: Write the screen**

```tsx
// apps/mobile/src/app/(app)/(tabs)/learn.tsx
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components/ui/chip";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";

const mockSubjects = ["History", "Biology", "Geography", "Culture", "Conservation", "Folklore"];

export default function LearnScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Browse by Subject" />
        <View style={styles.row}>
          {mockSubjects.map((subject) => (
            <Chip key={subject} label={subject} />
          ))}
        </View>
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
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
});
```

`mockSubjects` matches `docs/schema.md`'s `subject_area` enum values (`history`, `biology`, `geography`, `culture`, `conservation`, `folklore`), title-cased for display — Prompt 12 (Learn tab) replaces this static list with real filtering.

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(app)/(tabs)/learn.tsx"
git commit -m "feat: add Learn tab screen with mock subject chips"
```

---

### Task 13: Library screen

**Files:**

- Create: `apps/mobile/src/app/(app)/(tabs)/library.tsx`

**Interfaces:**

- Consumes: `SectionHeader` (Task 5).
- Produces: the tabs group's `library` route — the last of the 5 tabs, completing the shell.

No test — same reasoning as Task 10.

- [ ] **Step 1: Write the screen**

```tsx
// apps/mobile/src/app/(app)/(tabs)/library.tsx
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";

export default function LibraryScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader title="Library" />
      <ThemedText type="default" themeColor="textSecondary" style={styles.empty}>
        Your favorites, downloads, and listening history will show up here.
      </ThemedText>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    padding: Spacing.four,
  },
  empty: {
    marginTop: Spacing.three,
  },
});
```

This is a plain empty-state placeholder — Prompt 10 (Offline Downloads) and the favorites/listening-history features arrive in later prompts.

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(app)/(tabs)/library.tsx"
git commit -m "feat: add Library tab screen placeholder"
```

---

## Verification (whole plan)

- `pnpm typecheck` and `pnpm lint` pass across the whole workspace.
- `pnpm test` (or `pnpm --filter mobile test`) passes: `source-badge.test.ts`'s 4 tests, plus every pre-existing Prompt 5 mobile test (39 tests as of the end of Prompt 5, across `phone.test.ts`, `validation.test.ts`, `secure-store-adapter.test.ts`, `use-require-auth.test.ts`, `auth-store.test.ts`, `recovery-link.test.ts`) continuing to pass unchanged — 43 tests total, all green.
- No dangling references to the deleted `apps/mobile/src/app/(app)/index.tsx` anywhere in `apps/mobile/src`.
- Every `EpisodeRow` rendered by the Home screen shows a `SourceBadge`.
- The 8 Prompt 5 auth screens still typecheck and render unchanged (no code edits to any of them in this plan) while visually inheriting the new palette and fonts through `ThemedText`/`ThemedView`.
- Running the app in a real simulator/device — Home/Explore/Learn/Library/Profile all reachable via the tab bar, the MiniPlayer stays hidden (no episode ever calls `usePlayerStore`'s `play()` in this plan, so `currentEpisode` stays `null`), dark mode switches the palette correctly — is the authoritative end-to-end check, out of this plan's scope per the established no-live-device convention (the same posture Prompt 5 used throughout).
