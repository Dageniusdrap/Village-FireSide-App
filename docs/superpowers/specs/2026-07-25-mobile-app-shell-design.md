# Mobile App Shell, Theme & Navigation (Prompt 6) — Design Spec

## Scope

Build the mobile app's navigational shell and visual design system in
`apps/mobile`, per `docs/PROMPT_PACK.md`'s Prompt 6:

- 5-tab bottom navigation (Home, Explore, Learn, Library, Profile)
- A warm, African-nature color palette (light + dark mode) and typography
  (serif titles, sans UI text)
- A small design system in `components/ui/`: `Button`, `Card`, `Chip`,
  `SectionHeader`, `EpisodeRow`, `SeriesCard`, `DestinationCard`,
  `SourceBadge`
- A persistent `MiniPlayer` bar above the tab bar, wired to an
  empty-logic-for-now zustand player store
- Mock data standing in for real content until Prompt 7 wires Supabase
  queries

**Non-goals (explicitly out of scope for this prompt):**

- Real content/data fetching — Prompt 7 (Home & Discovery) replaces the
  mock data with live Supabase queries
- Audio playback logic — Prompt 8 fills in the player store's actions
- Map-based destination browsing, education-mode filtering, favorites,
  downloads, coins/premium UI — each has its own later prompt
  (11, 12, 9, 10 respectively)
- Wiring `useRequireAuth`/`SignInPromptSheet` (built in Prompt 5) to any
  gated action — no gated action exists yet; still inert, as Prompt 5 left
  it
- Any change to `apps/admin`

## New Dependencies

- `@expo-google-fonts/lora`, `@expo-google-fonts/inter`, `expo-font` — font
  loading (`expo-font` is Expo's underlying font-loading module that
  `useFonts()` is built on; confirm at plan time whether it's already a
  transitive dependency of the installed Expo SDK or needs an explicit
  `expo install`).
- `@expo/vector-icons` — tab bar icons. Not currently present in
  `apps/mobile`'s `node_modules` (confirmed by search) despite often
  shipping by default in Expo templates — needs an explicit
  `expo install @expo/vector-icons` at plan time, not assumed already
  available.

## Color Palette

Extends `apps/mobile/src/constants/theme.ts`'s existing `Colors.light`/
`Colors.dark` objects with new keys, keeping the existing keys
(`text`, `background`, `backgroundElement`, `backgroundSelected`,
`textSecondary`) and `ThemedText`/`ThemedView`'s public API (`type`,
`themeColor` props) unchanged, so the 8 auth screens built in Prompt 5
inherit the new palette automatically with no code changes.

| Token                | Light     | Dark      | Use                                                                                                   |
| -------------------- | --------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `primary`            | `#1F3B2C` | `#4C7A5A` | forest green — primary buttons, active tab icon (light value already used in Prompt 5's auth screens) |
| `primaryPressed`     | `#16291F` | `#3A5D45` | pressed/active state                                                                                  |
| `accent`             | `#C1652F` | `#E08A54` | terracotta — secondary CTAs, highlights                                                               |
| `accentSoft`         | `#F2DCC9` | `#3A2A1E` | chip/badge backgrounds                                                                                |
| `background`         | `#FAF6EF` | `#14181A` | warm off-white / warm near-black                                                                      |
| `backgroundElement`  | `#FFFFFF` | `#1E2422` | cards, inputs                                                                                         |
| `backgroundSelected` | `#EFE3D0` | `#262E2B` | selected/hover state                                                                                  |
| `text`               | `#1C1B18` | `#F2EFE8` | high-contrast body text                                                                               |
| `textSecondary`      | `#6B6459` | `#A9A79D` | captions, metadata                                                                                    |
| `gold`               | `#C08A28` | `#E0B24A` | "Elder testimony" `SourceBadge`                                                                       |
| `border`             | `#E4D9C5` | `#2E3532` | dividers, input borders                                                                               |
| `error`              | `#C0392B` | `#E57368` | matches `FormError`'s existing light-mode value from Prompt 5                                         |
| `success`            | `#2E7D4F` | `#4CAF77` | reserved for future use (e.g. "downloaded" state)                                                     |

`ThemeColor` (the type alias `keyof typeof Colors.light & keyof typeof
Colors.dark`) widens automatically since it's derived from the object
keys — no other type changes needed.

## Typography

Add `@expo-google-fonts/lora` and `@expo-google-fonts/inter` (both
lightweight, tree-shaken by Expo's font loading — only the requested
weights are bundled). Load via `useFonts()` in
`apps/mobile/src/app/_layout.tsx`, gating the existing splash-screen hide
(`SplashScreen.hideAsync()`, currently gated only on `!loading` from the
auth store) on `fontsLoaded && !loading` instead.

Weights: `Lora_600SemiBold` (episode/series titles), `Inter_400Regular`
(body), `Inter_500Medium` (default UI text, matches `ThemedText`'s current
default weight), `Inter_600SemiBold` (buttons, subtitles).

`theme.ts`'s `Fonts` export changes from the current per-platform system
font names to:

```ts
export const Fonts = {
  serif: "Lora_600SemiBold",
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemiBold: "Inter_600SemiBold",
};
```

`ThemedText`'s `title`/`subtitle` style variants switch their
`fontFamily` to `Fonts.serif`; all other variants use the appropriate
`Inter` weight instead of `fontWeight` numbers (Expo Google Fonts ships
weight-specific font files, not a single variable font, so weight must be
selected via `fontFamily`, not `fontWeight`).

## Design System (`apps/mobile/src/components/ui/`)

Each component is a standalone file, built on `ThemedText`/`ThemedView`
and the theme tokens above — no external UI library.

- **`Button`** — `variant: "primary" | "secondary" | "ghost"`, `label`,
  `onPress`, `disabled?`, `loading?`. `primary` uses `Colors.primary`
  background; `secondary` uses `Colors.accent`; `ghost` is text-only.
- **`Card`** — `children`, `style?`. Rounded corners, `backgroundElement`
  fill, subtle border.
- **`Chip`** — `label`, `selected?`, `onPress?`. Pill shape,
  `accentSoft`/`accent` when selected.
- **`SectionHeader`** — `title`, `actionLabel?`, `onActionPress?` (e.g. a
  "See all" link).
- **`SourceBadge`** — `source: ContentSource` (the mock/real
  `content_source` value: `"elder_testimony" | "narrated_production" |
"ai_assisted" | "tour_guide_original"`). Renders a gold pill labeled
  "Elder testimony" for `elder_testimony`; a neutral pill labeled
  "Narrated production" for the other three — satisfying
  `docs/schema.md`'s "Narrated-production labeling rule" that every
  non-elder-testimony episode must show that label. The
  source→label/color mapping is a pure exported function
  (`getSourceBadgeContent(source: ContentSource)`) so it can be unit
  tested independent of rendering.
- **`EpisodeRow`** — `title`, `durationSeconds`, `accessTier: "free" |
"coins" | "premium"`, `onPress?`. Shows a lock icon for
  `coins`/`premium`, a "Free" tag for `free`, and a play-button affordance.
- **`SeriesCard`** — `title`, `coverImageUrl`, `category`, `episodeCount`.
- **`DestinationCard`** — `name`, `region`, `coverImageUrl`.

## Navigation Structure

```
apps/mobile/src/app/(app)/
  _layout.tsx           <- wraps <Tabs> (via <Slot>-equivalent) + <MiniPlayer> overlay
  (tabs)/
    _layout.tsx          <- <Tabs> navigator, 5 screens, @expo/vector-icons icons
    index.tsx              Home      (SectionHeader + mock SeriesCard row)
    explore.tsx              Explore   (SectionHeader + mock DestinationCard grid)
    learn.tsx                  Learn     (SectionHeader + mock Chip row for subjects)
    library.tsx                  Library   (SectionHeader + empty-state placeholder)
    profile.tsx                     Profile   (moves today's sign-out button here from
                                                the current (app)/index.tsx placeholder)
```

`(app)/_layout.tsx` (currently a bare `<Stack>` wrapping the Prompt-5
placeholder screen) is rewritten to render `<Tabs>` (via a nested
`(tabs)` group, so the `MiniPlayer` overlay can sit outside/above it) plus
the `MiniPlayer`. `@expo/vector-icons` (bundled with Expo, no new
dependency) supplies tab icons — `Ionicons`, matching the outline/filled
active-state convention most Expo apps use.

Each of the 4 new tab screens (Home, Explore, Learn, Library) is a light
scaffold proving the design system renders with mock data — not a full
feature (those arrive in Prompts 7, 11, 12, and 10 respectively). Profile
keeps Prompt 5's sign-out button and gets a `SectionHeader`.

## MiniPlayer + Player Store

`apps/mobile/src/stores/player-store.ts` (zustand):

```ts
type PlayerState = {
  currentEpisode: Episode | null;
  isPlaying: boolean;
  expanded: boolean;
  play: (episode: Episode) => void;
  pause: () => void;
  expand: () => void;
  collapse: () => void;
};
```

`play`/`pause` are no-op-for-now state setters (`play` sets
`currentEpisode`/`isPlaying: true`; `pause` sets `isPlaying: false`) with
no actual audio engine — Prompt 8 replaces these bodies. `expand`/
`collapse` toggle `expanded`, for the "tap to expand" requirement (the
expanded view itself is not built this prompt — `expanded` is plumbed
through but has no consumer yet, matching this prompt's "wire it, don't
finish it" scope).

`apps/mobile/src/components/mini-player.tsx`: renders `null` when
`currentEpisode` is `null`; otherwise an absolutely-positioned `Card` at
the bottom of `(app)/_layout.tsx`, above the tab bar height (using the
existing `BottomTabInset` constant from `theme.ts`), showing artwork
placeholder, title, and a play/pause `Button`.

## Mock Data & Types

`apps/mobile/src/types/content.ts` — types mirroring the real
`episodes`/`series`/`destinations` table columns relevant to the UI
(field names and types matched to `docs/schema.md`, not invented):

```ts
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

`apps/mobile/src/mocks/content.ts` — small (3-5 item) arrays of each
type, imported by the tab screens. Cover images use placeholder URLs
(e.g. `https://placehold.co/...`) rather than bundled assets, so no new
image files are needed this prompt.

## Testing

Following this codebase's established precedent (Prompt 5): screens and
navigation aren't unit-tested here — there's no runtime in this
environment to exercise Expo Router navigation or rendering, so they're
verified by `pnpm typecheck && pnpm lint` only. `SourceBadge`'s
`getSourceBadgeContent` pure function is the one place with real
branching logic and is unit tested (Jest), mirroring how `phone.ts` and
`proxy.ts`'s `decideRedirect` were tested in Prompt 5.

## Docs

No `docs/*.md` updates are required by this prompt's scope — the design
system and navigation structure are self-documenting via the component
files themselves, and there's no schema/API surface change to document.
