# Home & Discovery (Prompt 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the mobile app's Home tab on real Supabase data (6 sections) and add Series/Contributor/Cultural-Group detail screens, per `docs/PROMPT_PACK.md`'s Prompt 7.

**Architecture:** `@tanstack/react-query` becomes the data layer, replacing Prompt 6's mock data. One query hook per data need, each a thin wrapper around a direct `supabase.from(...)` call — no repository abstraction. `(app)/_layout.tsx` changes from a bare `<Slot>` to a `<Stack>` so three new full-screen detail routes can push over the tab bar. Favoriting adopts Prompt 5's previously-inert `useRequireAuth`/`SignInPromptSheet` gate for the first time.

**Tech Stack:** `@tanstack/react-query` (new), existing Supabase client, zustand (`usePlayerStore`, `useAuthStore` — both already built), Expo Router `<Stack>`.

## Global Constraints

- No Supabase CLI, no Docker, no live device/simulator in this environment — every task is verified by `pnpm typecheck` + `pnpm lint` (+ a real unit test for the one piece of pure logic this plan introduces — the favorite-target row resolver), never by running the app or querying a live project.
- This codebase has no generated Supabase `Database` types file (confirmed: no such file exists anywhere in `apps/mobile` or `apps/admin`). Every query hook types its result explicitly via supabase-js v2's `.returns<T>()` method, matching this project's established no-codegen convention — never leave a query result implicitly `any`.
- `app_settings` does not exist (created in a future prompt) — the "Peoples & Kingdoms" section and Cultural Group detail screen show every published `cultural_groups` row with no per-country filtering. Do not add a filter for this.
- No real audio playback — tapping a free episode or "Play All" calls the existing `usePlayerStore.play(episode)` (a state-only stub from an earlier plan); do not add any audio engine code.
- No coins/premium purchase UI — a locked episode (`accessTier !== "free"`) shows its price/premium badge only; it is not tappable, and no Unlock Sheet exists yet.
- Explore, Learn, Library tabs are untouched by this plan — they keep using mock data from `apps/mobile/src/mocks/content.ts`'s `mockDestinations`, which stays in that file unchanged.
- RLS already permits everything this plan's queries need with no new policies: `series`/`episodes` are publicly readable where published; `favorites`/`listening_progress` grant full owner CRUD (`auth.uid() = user_id`); `cultural_groups` and its two junction tables are publicly readable where the linked `cultural_groups` row is published; `public_contributors` is a public view. Do not add or modify any RLS policy in this plan.
- `public_contributors` (not the base `contributors` table) is the only table/view this plan's code ever queries for contributor data — it already masks `is_anonymous` contributors' PII and filters to only contributors linked to a published episode, so no client-side masking logic is needed on top of it.

---

### Task 1: Database — `series.is_featured` migration

**Files:**

- Create: `supabase/migrations/20260726100000_series_is_featured.sql`
- Modify: `docs/schema.md`

**Interfaces:**

- Consumes: nothing.
- Produces: `series.is_featured` column — consumed by Task 6's `useFeaturedSeries()`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260726100000_series_is_featured.sql
alter table series add column is_featured boolean not null default false;
```

- [ ] **Step 2: Verify the migration file structurally**

```bash
grep -c "^alter table" supabase/migrations/20260726100000_series_is_featured.sql
```

Expected: `1`. Matches this project's established structural-verification convention (no live Postgres in this environment).

- [ ] **Step 3: Document the new column**

Read `docs/schema.md`'s `### \`series\``table section first. Add a row for`is_featured`to its existing column table, directly after the`sort_order`row (matching the migration's logical position — a display/curation flag, same family as`sort_order`):

```markdown
| `is_featured` | `boolean`, default `false` | Admin-flagged for the Home tab's hero section. |
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260726100000_series_is_featured.sql docs/schema.md
git commit -m "feat: add series.is_featured column for the Home hero section"
```

---

### Task 2: TanStack Query setup

**Files:**

- Create: `apps/mobile/src/lib/query-client.ts`
- Modify: `apps/mobile/src/app/_layout.tsx`

**Interfaces:**

- Consumes: nothing new.
- Produces: `queryClient` (a `QueryClient` singleton) and app-wide `<QueryClientProvider>` coverage — consumed by every query hook in Tasks 6, 7, and Task 5's `useToggleFavorite`.

No test — a singleton instantiation and provider wiring, no branching logic.

- [ ] **Step 1: Install the dependency**

```bash
cd apps/mobile
pnpm add @tanstack/react-query
cd ../..
```

Use `pnpm add` here, not `npx expo install` — `@tanstack/react-query` is a plain JS package with no native code or Expo SDK version coupling, unlike the Expo-ecosystem packages installed in earlier plans.

- [ ] **Step 2: Create the QueryClient singleton**

```ts
// apps/mobile/src/lib/query-client.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient();
```

A module-level singleton is the correct, documented pattern for `QueryClient` (unlike the Supabase client, which this project deliberately constructs fresh per call elsewhere — those are different libraries with different lifecycle requirements; do not "fix" this into a factory function).

- [ ] **Step 3: Wrap the app in `QueryClientProvider`**

Read the current `apps/mobile/src/app/_layout.tsx` first. Add the import and wrap both `<ThemeProvider>` return blocks (the loading-state early return, and the main return) in `<QueryClientProvider>`:

```tsx
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Lora_600SemiBold } from "@expo-google-fonts/lora";
import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { ThemedView } from "@/components/themed-view";
import { useAuthListener } from "@/hooks/use-auth-listener";
import { useRecoveryLinkHandler } from "@/hooks/use-recovery-link-handler";
import { queryClient } from "@/lib/query-client";
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
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={theme}>
          <ThemedView style={styles.loadingContainer}>
            <ActivityIndicator />
          </ThemedView>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={theme}>
        <AnimatedSplashOverlay />
        {!session && !guestMode && <Redirect href="/welcome" />}
        {session && passwordRecovery && <Redirect href="/reset-password" />}
        {session && !passwordRecovery && <Redirect href="/" />}
        {!session && guestMode && <Redirect href="/" />}
        <Slot />
      </ThemeProvider>
    </QueryClientProvider>
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

The four `<Redirect>` lines and their conditions are copied verbatim from the current file — do not alter them; this task only adds `QueryClientProvider` as an outer wrapper around both existing return blocks.

- [ ] **Step 4: Verify typecheck and lint, and that the redirect logic is unchanged**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
cd ../.. && git diff apps/mobile/src/app/_layout.tsx | grep -A1 "Redirect href"
```

Expected: both pass; the grep shows no `+`/`-` lines touching any `<Redirect href=...>` line.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/query-client.ts apps/mobile/src/app/_layout.tsx apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat: add TanStack Query as the mobile app's data layer"
```

(Check `git status` for the actual lockfile path — this workspace uses a single root `pnpm-lock.yaml`, not a per-app one; drop `apps/mobile/pnpm-lock.yaml` from the command if `git status` doesn't show it as modified.)

---

### Task 3: Content types and mock-data cleanup

**Files:**

- Modify: `apps/mobile/src/types/content.ts`
- Modify: `apps/mobile/src/mocks/content.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `CulturalGroup`, `PublicContributor`, `ContributorType` types (added to the existing `Episode`/`Series`/`Destination`/`AccessTier`/`ContentSource` types) — consumed by Tasks 6 and 7's query hooks. `mocks/content.ts` keeps only `mockDestinations`.

No test — pure type declarations and a data-file trim, no branching logic.

- [ ] **Step 1: Add the new types**

Read the current `apps/mobile/src/types/content.ts` first. Add these three new exports after the existing `Destination` type — do not change `ContentSource`, `AccessTier`, `Episode`, `Series`, or `Destination`:

```ts
export type ContributorType =
  "elder" | "voice_artist" | "writer" | "tour_guide" | "historian" | "translator";

export type CulturalGroup = {
  id: string;
  name: string;
  description: string | null;
  country: string | null;
  region: string | null;
  coverImageUrl: string | null;
};

export type PublicContributor = {
  id: string;
  displayName: string;
  contributorType: ContributorType;
  bio: string | null;
  photoUrl: string | null;
  district: string | null;
  country: string | null;
};
```

Field names/types match `docs/schema.md`'s `cultural_groups` table and `public_contributors` view exactly (not invented), and `ContributorType`'s values match `docs/schema.md`'s `contributor_type` enum exactly.

- [ ] **Step 2: Trim the mock data file**

Read the current `apps/mobile/src/mocks/content.ts` first. Remove `mockEpisodes` and `mockSeries` (and their now-unused `Episode`/`Series` imports) — keep `mockDestinations` and its `Destination` import exactly as-is:

```ts
// apps/mobile/src/mocks/content.ts
import type { Destination } from "@/types/content";

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

Do not run this yet if Task 9 hasn't landed — the current Home screen (`(app)/(tabs)/index.tsx`) still imports `mockEpisodes`/`mockSeries` from this file until Task 9 rewrites it, so typecheck WILL fail after this task alone. This is expected and matches this plan's task ordering (Task 9 depends on Task 3): verify typecheck fails with exactly two "has no exported member" errors for `mockEpisodes`/`mockSeries`, referencing `(app)/(tabs)/index.tsx`, and no other errors:

```bash
cd apps/mobile && pnpm typecheck
```

Expected: FAIL, with errors pointing only at `(app)/(tabs)/index.tsx`'s import of `mockEpisodes`/`mockSeries` — confirming this task's own two files are otherwise correct and the only breakage is the known, expected, soon-to-be-fixed dependency on the old Home screen.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/types/content.ts apps/mobile/src/mocks/content.ts
git commit -m "feat: add cultural group and contributor types, trim unused mock data"
```

The repo will not typecheck cleanly again until Task 9 lands — this is expected for this multi-task plan (later tasks depend on earlier ones); each task's own commit is verified against what it can be, per this step's instructions.

---

### Task 4: `Skeleton` and `EmptyState` components

**Files:**

- Create: `apps/mobile/src/components/ui/skeleton.tsx`
- Create: `apps/mobile/src/components/ui/empty-state.tsx`

**Interfaces:**

- Consumes: `Spacing`/`useTheme` (existing).
- Produces: `<Skeleton width height />`, `<EmptyState title body />` — consumed by every section/screen built in Tasks 9-12.

No tests — thin, purely presentational, no branching logic, matching this codebase's established precedent for this class of component.

- [ ] **Step 1: Write `Skeleton`**

```tsx
// apps/mobile/src/components/ui/skeleton.tsx
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
```

This is a static placeholder block (no shimmer animation) — deliberately simple. A future prompt can add an `Animated`/`reanimated`-driven shimmer if the product wants it; this plan doesn't require it and adding one now would be unrequested scope.

- [ ] **Step 2: Write `EmptyState`**

```tsx
// apps/mobile/src/components/ui/empty-state.tsx
import { StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {body}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.one,
    alignItems: "center",
  },
});
```

- [ ] **Step 3: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: same two pre-existing `mockEpisodes`/`mockSeries` errors from Task 3 (still not yet fixed — Task 9's job), no new errors from these two new files.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/ui/skeleton.tsx apps/mobile/src/components/ui/empty-state.tsx
git commit -m "feat: add Skeleton and EmptyState components"
```

---

### Task 5: Favorites — pure resolver (TDD) + `useToggleFavorite`

**Files:**

- Create: `apps/mobile/src/lib/favorite-target.ts`
- Test: `apps/mobile/src/lib/favorite-target.test.ts`
- Create: `apps/mobile/src/hooks/queries/use-toggle-favorite.ts`

**Interfaces:**

- Consumes: `supabase` (existing), `queryClient` (Task 2).
- Produces: `resolveFavoriteTarget(target: FavoriteTarget): { episode_id: string | null; series_id: string | null; destination_id: string | null }` (pure, tested), `FavoriteTarget = { episodeId: string } | { seriesId: string } | { destinationId: string }`, and `useToggleFavorite(): { toggle: (target: FavoriteTarget, isFavorited: boolean) => Promise<void> }` — consumed by Task 10's Series detail screen.

Following this codebase's established split: the pure branching logic (which of the three FK columns to set) is tested; the thin Supabase-calling wrapper around it is not.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/favorite-target.test.ts
import { resolveFavoriteTarget } from "./favorite-target";

describe("resolveFavoriteTarget", () => {
  it("sets only episode_id for an episode target", () => {
    expect(resolveFavoriteTarget({ episodeId: "ep-1" })).toEqual({
      episode_id: "ep-1",
      series_id: null,
      destination_id: null,
    });
  });

  it("sets only series_id for a series target", () => {
    expect(resolveFavoriteTarget({ seriesId: "series-1" })).toEqual({
      episode_id: null,
      series_id: "series-1",
      destination_id: null,
    });
  });

  it("sets only destination_id for a destination target", () => {
    expect(resolveFavoriteTarget({ destinationId: "dest-1" })).toEqual({
      episode_id: null,
      series_id: null,
      destination_id: "dest-1",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && npx jest src/lib/favorite-target.test.ts
```

Expected: FAIL with a module-not-found error for `./favorite-target`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/lib/favorite-target.ts
export type FavoriteTarget =
  { episodeId: string } | { seriesId: string } | { destinationId: string };

export type FavoriteRow = {
  episode_id: string | null;
  series_id: string | null;
  destination_id: string | null;
};

export function resolveFavoriteTarget(target: FavoriteTarget): FavoriteRow {
  if ("episodeId" in target) {
    return { episode_id: target.episodeId, series_id: null, destination_id: null };
  }
  if ("seriesId" in target) {
    return { episode_id: null, series_id: target.seriesId, destination_id: null };
  }
  return { episode_id: null, series_id: null, destination_id: target.destinationId };
}
```

The discriminated union (`FavoriteTarget`) makes it a compile error to pass more than one target field — TypeScript won't accept `{ episodeId: "x", seriesId: "y" }` against this type, so the "exactly one" invariant the `favorites` table's CHECK constraint enforces at the database level is also enforced at the call-site type level.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && npx jest src/lib/favorite-target.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the `useToggleFavorite` hook**

```ts
// apps/mobile/src/hooks/queries/use-toggle-favorite.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { resolveFavoriteTarget, type FavoriteTarget } from "@/lib/favorite-target";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);

  const mutation = useMutation({
    mutationFn: async ({
      target,
      isFavorited,
    }: {
      target: FavoriteTarget;
      isFavorited: boolean;
    }) => {
      if (!session) {
        return;
      }
      const row = resolveFavoriteTarget(target);
      if (isFavorited) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .match({ user_id: session.user.id, ...row });
        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({ user_id: session.user.id, ...row });
        if (error) {
          throw error;
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  return {
    toggle: (target: FavoriteTarget, isFavorited: boolean) =>
      mutation.mutateAsync({ target, isFavorited }),
  };
}
```

The `!session` early-return is a defensive fallback, not the actual guest gate — Task 10's screen wraps every call site in `useRequireAuth`'s `requireAuth(...)`, so this hook should never actually be invoked while `session` is null in practice. It's still correct to guard here too, cheaply, in case a future call site forgets the `requireAuth` wrapper.

- [ ] **Step 6: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: same two pre-existing `mockEpisodes`/`mockSeries` errors from Task 3, no new errors.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/favorite-target.ts apps/mobile/src/lib/favorite-target.test.ts apps/mobile/src/hooks/queries/use-toggle-favorite.ts
git commit -m "feat: add favorite toggle with tested target-resolution logic"
```

---

### Task 6: Home section data hooks

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-home-sections.ts`

**Interfaces:**

- Consumes: `supabase` (existing), `useAuthStore` (existing), `Episode`/`Series`/`CulturalGroup`/`PublicContributor` (Task 3).
- Produces: `useFeaturedSeries()`, `useElderVoicesSeries()`, `useContinueListening()`, `useCategoryRail(category: string)`, `useCulturalGroups()`, `useStorytellers()` — each returning `UseQueryResult<T[]>` from `@tanstack/react-query` — consumed by Task 9's Home screen.

No tests — thin query wrappers with no branching logic beyond the row-shape mapping, which is a straight field-rename with no conditionals to assert on; verified by typecheck/lint.

- [ ] **Step 1: Write the file**

```ts
// apps/mobile/src/hooks/queries/use-home-sections.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import type { CulturalGroup, Episode, PublicContributor, Series } from "@/types/content";

type SeriesRow = {
  id: string;
  title: string;
  cover_image_url: string | null;
  category: string | null;
  episodes: { count: number }[];
};

function mapSeriesRow(row: SeriesRow): Series {
  return {
    id: row.id,
    title: row.title,
    coverImageUrl: row.cover_image_url,
    category: row.category,
    episodeCount: row.episodes[0]?.count ?? 0,
  };
}

export function useFeaturedSeries() {
  return useQuery({
    queryKey: ["home", "featured-series"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("series")
        .select("id, title, cover_image_url, category, episodes(count)")
        .eq("is_featured", true)
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .returns<SeriesRow[]>();
      if (error) {
        throw error;
      }
      return data.map(mapSeriesRow);
    },
  });
}

export function useElderVoicesSeries() {
  return useQuery({
    queryKey: ["home", "elder-voices-series"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("series")
        .select("id, title, cover_image_url, category, episodes(count)")
        .eq("category", "elder_history")
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .returns<SeriesRow[]>();
      if (error) {
        throw error;
      }
      return data.map(mapSeriesRow);
    },
  });
}

type ContinueListeningRow = {
  position_seconds: number;
  episodes: {
    id: string;
    title: string;
    duration_seconds: number | null;
    access_tier: Episode["accessTier"];
    content_source: Episode["contentSource"];
  };
};

export function useContinueListening() {
  const session = useAuthStore((state) => state.session);

  return useQuery({
    queryKey: ["home", "continue-listening", session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async () => {
      if (!session) {
        return [];
      }
      const { data, error } = await supabase
        .from("listening_progress")
        .select(
          "position_seconds, episodes(id, title, duration_seconds, access_tier, content_source)",
        )
        .eq("user_id", session.user.id)
        .eq("completed", false)
        .order("updated_at", { ascending: false })
        .limit(10)
        .returns<ContinueListeningRow[]>();
      if (error) {
        throw error;
      }
      return data.map((row): Episode => ({
        id: row.episodes.id,
        title: row.episodes.title,
        durationSeconds: row.episodes.duration_seconds,
        accessTier: row.episodes.access_tier,
        contentSource: row.episodes.content_source,
      }));
    },
  });
}

export function useCategoryRail(category: string) {
  return useQuery({
    queryKey: ["home", "category-rail", category],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("series")
        .select("id, title, cover_image_url, category, episodes(count)")
        .eq("category", category)
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .returns<SeriesRow[]>();
      if (error) {
        throw error;
      }
      return data.map(mapSeriesRow);
    },
  });
}

type CulturalGroupRow = {
  id: string;
  name: string;
  description: string | null;
  country: string | null;
  region: string | null;
  cover_image_url: string | null;
};

export function useCulturalGroups() {
  return useQuery({
    queryKey: ["home", "cultural-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cultural_groups")
        .select("id, name, description, country, region, cover_image_url")
        .eq("is_published", true)
        .returns<CulturalGroupRow[]>();
      if (error) {
        throw error;
      }
      return data.map((row): CulturalGroup => ({
        id: row.id,
        name: row.name,
        description: row.description,
        country: row.country,
        region: row.region,
        coverImageUrl: row.cover_image_url,
      }));
    },
  });
}

type PublicContributorRow = {
  id: string;
  display_name: string;
  contributor_type: PublicContributor["contributorType"];
  bio: string | null;
  photo_url: string | null;
  district: string | null;
  country: string | null;
};

export function useStorytellers() {
  return useQuery({
    queryKey: ["home", "storytellers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_contributors")
        .select("id, display_name, contributor_type, bio, photo_url, district, country")
        .returns<PublicContributorRow[]>();
      if (error) {
        throw error;
      }
      return data.map((row): PublicContributor => ({
        id: row.id,
        displayName: row.display_name,
        contributorType: row.contributor_type,
        bio: row.bio,
        photoUrl: row.photo_url,
        district: row.district,
        country: row.country,
      }));
    },
  });
}
```

`episodes(count)` is PostgREST's embedded-resource count-aggregate syntax — it returns an array with one element shaped `{ count: number }` (not a bare number), which is why `mapSeriesRow` reads `row.episodes[0]?.count ?? 0` rather than `row.episodes.count`. `useContinueListening`'s `enabled: session !== null` stops TanStack Query from even attempting the query for guests (rather than running it and getting an empty RLS-filtered result) — cheaper and avoids a network call that can never succeed for a signed-out user.

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: same two pre-existing `mockEpisodes`/`mockSeries` errors from Task 3, no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/hooks/queries/use-home-sections.ts
git commit -m "feat: add Home tab data hooks"
```

---

### Task 7: Detail screen data hooks

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-series-detail.ts`
- Create: `apps/mobile/src/hooks/queries/use-contributor-detail.ts`
- Create: `apps/mobile/src/hooks/queries/use-cultural-group-detail.ts`

**Interfaces:**

- Consumes: `supabase` (existing), `Episode`/`Series`/`CulturalGroup`/`PublicContributor` (Task 3).
- Produces: `useSeriesDetail(id)`, `useContributorDetail(id)`, `useCulturalGroupDetail(id)`, plus the composite types `SeriesDetail`, `ContributorDetail`, `CulturalGroupDetail` each hook returns — consumed by Tasks 10, 11, 12 respectively.

No tests — thin query wrappers, same reasoning as Task 6.

- [ ] **Step 1: Write `use-series-detail.ts`**

```ts
// apps/mobile/src/hooks/queries/use-series-detail.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { AccessTier, ContentSource } from "@/types/content";

export type SeriesDetailEpisode = {
  id: string;
  title: string;
  episodeNumber: number;
  durationSeconds: number | null;
  accessTier: AccessTier;
  coinPrice: number;
  contentSource: ContentSource;
  resumePositionSeconds: number | null;
};

export type SeriesDetail = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  destinationId: string | null;
  coverImageUrl: string | null;
  episodes: SeriesDetailEpisode[];
};

type SeriesDetailRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  destination_id: string | null;
  cover_image_url: string | null;
  episodes: {
    id: string;
    title: string;
    episode_number: number;
    duration_seconds: number | null;
    access_tier: AccessTier;
    coin_price: number;
    content_source: ContentSource;
    listening_progress: { position_seconds: number }[];
  }[];
};

export function useSeriesDetail(id: string) {
  return useQuery({
    queryKey: ["series-detail", id],
    queryFn: async (): Promise<SeriesDetail> => {
      const { data, error } = await supabase
        .from("series")
        .select(
          "id, title, description, category, destination_id, cover_image_url, episodes(id, title, episode_number, duration_seconds, access_tier, coin_price, content_source, listening_progress(position_seconds))",
        )
        .eq("id", id)
        .eq("is_published", true)
        .order("episode_number", { referencedTable: "episodes", ascending: true })
        .single()
        .returns<SeriesDetailRow>();
      if (error) {
        throw error;
      }
      return {
        id: data.id,
        title: data.title,
        description: data.description,
        category: data.category,
        destinationId: data.destination_id,
        coverImageUrl: data.cover_image_url,
        episodes: data.episodes.map((episode) => ({
          id: episode.id,
          title: episode.title,
          episodeNumber: episode.episode_number,
          durationSeconds: episode.duration_seconds,
          accessTier: episode.access_tier,
          coinPrice: episode.coin_price,
          contentSource: episode.content_source,
          resumePositionSeconds: episode.listening_progress[0]?.position_seconds ?? null,
        })),
      };
    },
  });
}
```

The embedded `listening_progress(position_seconds)` inside `episodes(...)` relies on RLS, not an explicit filter, to scope results to the current user: `listening_progress`'s owner-only policy (`auth.uid() = user_id`) applies through embedded/nested PostgREST resources exactly as it does to a direct query, so an authenticated request's embed only ever contains that user's own rows, and a guest (`anon` key, no `auth.uid()`) always gets an empty array here — which is exactly the "no explicit gate, just naturally empty for guests" behavior the design spec calls for. Do not add an explicit `user_id` filter on this embed; RLS is already doing that job, and adding a redundant filter risks it silently diverging from RLS's own definition later.

- [ ] **Step 2: Write `use-contributor-detail.ts`**

```ts
// apps/mobile/src/hooks/queries/use-contributor-detail.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { ContributorType } from "@/types/content";

export type ContributorDetailEpisode = {
  id: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  role: string;
};

export type ContributorDetail = {
  id: string;
  displayName: string;
  contributorType: ContributorType;
  bio: string | null;
  photoUrl: string | null;
  district: string | null;
  country: string | null;
  episodes: ContributorDetailEpisode[];
};

type ContributorRow = {
  id: string;
  display_name: string;
  contributor_type: ContributorType;
  bio: string | null;
  photo_url: string | null;
  district: string | null;
  country: string | null;
};

type EpisodeContributorRow = {
  role: string;
  episodes: {
    id: string;
    title: string;
    series_id: string;
    series: { title: string };
  };
};

export function useContributorDetail(id: string) {
  return useQuery({
    queryKey: ["contributor-detail", id],
    queryFn: async (): Promise<ContributorDetail> => {
      const { data: contributor, error: contributorError } = await supabase
        .from("public_contributors")
        .select("id, display_name, contributor_type, bio, photo_url, district, country")
        .eq("id", id)
        .single()
        .returns<ContributorRow>();
      if (contributorError) {
        throw contributorError;
      }

      const { data: episodeLinks, error: episodesError } = await supabase
        .from("episode_contributors")
        .select("role, episodes(id, title, series_id, series(title))")
        .eq("contributor_id", id)
        .returns<EpisodeContributorRow[]>();
      if (episodesError) {
        throw episodesError;
      }

      return {
        id: contributor.id,
        displayName: contributor.display_name,
        contributorType: contributor.contributor_type,
        bio: contributor.bio,
        photoUrl: contributor.photo_url,
        district: contributor.district,
        country: contributor.country,
        episodes: episodeLinks.map((link) => ({
          id: link.episodes.id,
          title: link.episodes.title,
          seriesId: link.episodes.series_id,
          seriesTitle: link.episodes.series.title,
          role: link.role,
        })),
      };
    },
  });
}
```

`episode_contributors` embeds `episodes` (a real FK: `episode_contributors.episode_id → episodes.id`), and `episodes` further embeds `series` (a real FK: `episodes.series_id → series.id`) — both are standard, direct PostgREST foreign-table embeds, unlike the cultural-group-to-contributor case below, which needs a different approach.

- [ ] **Step 3: Write `use-cultural-group-detail.ts`**

```ts
// apps/mobile/src/hooks/queries/use-cultural-group-detail.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { CulturalGroup, PublicContributor } from "@/types/content";

export type CulturalGroupDetail = CulturalGroup & {
  series: { id: string; title: string; coverImageUrl: string | null; episodeCount: number }[];
  contributors: PublicContributor[];
};

type CulturalGroupRow = {
  id: string;
  name: string;
  description: string | null;
  country: string | null;
  region: string | null;
  cover_image_url: string | null;
};

type SeriesLinkRow = {
  series: {
    id: string;
    title: string;
    cover_image_url: string | null;
    episodes: { count: number }[];
  };
};

type ContributorLinkRow = {
  contributor_id: string;
};

type PublicContributorRow = {
  id: string;
  display_name: string;
  contributor_type: PublicContributor["contributorType"];
  bio: string | null;
  photo_url: string | null;
  district: string | null;
  country: string | null;
};

export function useCulturalGroupDetail(id: string) {
  return useQuery({
    queryKey: ["cultural-group-detail", id],
    queryFn: async (): Promise<CulturalGroupDetail> => {
      const { data: group, error: groupError } = await supabase
        .from("cultural_groups")
        .select("id, name, description, country, region, cover_image_url")
        .eq("id", id)
        .eq("is_published", true)
        .single()
        .returns<CulturalGroupRow>();
      if (groupError) {
        throw groupError;
      }

      const { data: seriesLinks, error: seriesError } = await supabase
        .from("series_cultural_groups")
        .select("series(id, title, cover_image_url, episodes(count))")
        .eq("cultural_group_id", id)
        .returns<SeriesLinkRow[]>();
      if (seriesError) {
        throw seriesError;
      }

      const { data: contributorLinks, error: linksError } = await supabase
        .from("contributor_cultural_groups")
        .select("contributor_id")
        .eq("cultural_group_id", id)
        .returns<ContributorLinkRow[]>();
      if (linksError) {
        throw linksError;
      }

      const contributorIds = contributorLinks.map((link) => link.contributor_id);
      let contributors: PublicContributor[] = [];
      if (contributorIds.length > 0) {
        const { data: contributorRows, error: contributorsError } = await supabase
          .from("public_contributors")
          .select("id, display_name, contributor_type, bio, photo_url, district, country")
          .in("id", contributorIds)
          .returns<PublicContributorRow[]>();
        if (contributorsError) {
          throw contributorsError;
        }
        contributors = contributorRows.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          contributorType: row.contributor_type,
          bio: row.bio,
          photoUrl: row.photo_url,
          district: row.district,
          country: row.country,
        }));
      }

      return {
        id: group.id,
        name: group.name,
        description: group.description,
        country: group.country,
        region: group.region,
        coverImageUrl: group.cover_image_url,
        series: seriesLinks.map((link) => ({
          id: link.series.id,
          title: link.series.title,
          coverImageUrl: link.series.cover_image_url,
          episodeCount: link.series.episodes[0]?.count ?? 0,
        })),
        contributors,
      };
    },
  });
}
```

Deliberately does NOT try to embed `public_contributors` directly through `contributor_cultural_groups.contributor_id` — that column's foreign key points at the base `contributors` table, not the `public_contributors` view, and PostgREST's embed resolution is based on actual FK constraints, not "this view happens to be based on that table." Relying on an embed there would be guessing at behavior this project has no live database to verify against. Instead: fetch the linked `contributor_id`s from the junction table (a real FK, safe to embed if needed, though here just selecting the bare column is simpler), then a second, guaranteed-correct `.in("id", contributorIds)` query against `public_contributors` directly. `series_cultural_groups.series_id → series.id` IS a real FK to the base table itself (not a view), so that embed is safe and used directly.

- [ ] **Step 4: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: same two pre-existing `mockEpisodes`/`mockSeries` errors from Task 3, no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hooks/queries/use-series-detail.ts apps/mobile/src/hooks/queries/use-contributor-detail.ts apps/mobile/src/hooks/queries/use-cultural-group-detail.ts
git commit -m "feat: add Series/Contributor/Cultural-Group detail data hooks"
```

---

### Task 8: Navigation — `(app)/_layout.tsx` from `Slot` to `Stack`

**Files:**

- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: `MiniPlayer` (existing).
- Produces: a `<Stack>`-based `(app)` layout with the `(tabs)` group as its default (header-hidden) screen — consumed by Tasks 10, 11, 12's detail routes, which will render as further `<Stack>` screens once their files exist.

No test — Expo Router navigation, same untestable-in-this-environment reasoning as every navigation file in the prior plans.

- [ ] **Step 1: Rewrite the layout**

```tsx
// apps/mobile/src/app/(app)/_layout.tsx
import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";

import { MiniPlayer } from "@/components/ui/mini-player";

export default function AppLayout() {
  return (
    <View style={styles.container}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
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

Only the `(tabs)` screen is declared explicitly (to hide its header, since the tab navigator draws its own chrome) — Expo Router's file-based routing means the three detail screens Tasks 10-12 add under `(app)/series/`, `(app)/contributor/`, `(app)/cultural-group/` will be automatically registered as further `<Stack>` screens once those files exist, with default header/back-button behavior, no changes needed here. `<MiniPlayer />` stays exactly where it was — a sibling overlay outside the `<Stack>`, so it persists across every screen the stack navigates to, not just the tabs.

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: same two pre-existing `mockEpisodes`/`mockSeries` errors from Task 3, no new errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(app)/_layout.tsx"
git commit -m "feat: restructure (app) layout from Slot to Stack for drill-down screens"
```

---

### Task 9: Home screen rewrite

**Files:**

- Modify: `apps/mobile/src/app/(app)/(tabs)/index.tsx`

**Interfaces:**

- Consumes: `useFeaturedSeries`/`useElderVoicesSeries`/`useContinueListening`/`useCategoryRail`/`useCulturalGroups`/`useStorytellers` (Task 6), `Skeleton`/`EmptyState` (Task 4), `EpisodeRow`/`SeriesCard`/`DestinationCard`/`SectionHeader` (existing).
- Produces: the rebuilt Home tab — this is the task that fixes the two `mockEpisodes`/`mockSeries` typecheck errors every prior task in this plan has been carrying forward.

No test — screen-level composition, same reasoning as every screen in the prior plans.

- [ ] **Step 1: Rewrite the screen**

Read the current file first (it still imports `mockEpisodes`/`mockSeries` — this task removes that import entirely).

```tsx
// apps/mobile/src/app/(app)/(tabs)/index.tsx
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DestinationCard } from "@/components/ui/destination-card";
import { EmptyState } from "@/components/ui/empty-state";
import { EpisodeRow } from "@/components/ui/episode-row";
import { SectionHeader } from "@/components/ui/section-header";
import { SeriesCard } from "@/components/ui/series-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import {
  useCategoryRail,
  useContinueListening,
  useCulturalGroups,
  useElderVoicesSeries,
  useFeaturedSeries,
  useStorytellers,
} from "@/hooks/queries/use-home-sections";

const CATEGORY_RAILS = [
  { key: "lakes", title: "Lakes" },
  { key: "forests", title: "Forests" },
  { key: "wildlife", title: "Wildlife" },
  { key: "hidden_africa", title: "Hidden Africa" },
  { key: "children", title: "Children" },
];

function SeriesRail({
  query,
  onPressSeries,
}: {
  query: {
    data?: {
      id: string;
      title: string;
      coverImageUrl: string | null;
      category: string | null;
      episodeCount: number;
    }[];
    isLoading: boolean;
  };
  onPressSeries: (id: string) => void;
}) {
  if (query.isLoading) {
    return <Skeleton width="100%" height={140} />;
  }
  if (!query.data || query.data.length === 0) {
    return <EmptyState title="Nothing here yet" body="Check back soon for new stories." />;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {query.data.map((series) => (
        <SeriesCard
          key={series.id}
          title={series.title}
          coverImageUrl={series.coverImageUrl}
          category={series.category}
          episodeCount={series.episodeCount}
          onPress={() => onPressSeries(series.id)}
        />
      ))}
    </ScrollView>
  );
}

function CategoryRailSection({
  category,
  title,
  onPressSeries,
}: {
  category: string;
  title: string;
  onPressSeries: (id: string) => void;
}) {
  const query = useCategoryRail(category);
  return (
    <View>
      <SectionHeader title={title} />
      <SeriesRail query={query} onPressSeries={onPressSeries} />
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const featuredSeries = useFeaturedSeries();
  const elderVoicesSeries = useElderVoicesSeries();
  const continueListening = useContinueListening();
  const culturalGroups = useCulturalGroups();
  const storytellers = useStorytellers();

  const goToSeries = (id: string) => router.push(`/series/${id}`);
  const goToCulturalGroup = (id: string) => router.push(`/cultural-group/${id}`);
  const goToContributor = (id: string) => router.push(`/contributor/${id}`);

  const isRefreshing =
    featuredSeries.isRefetching ||
    elderVoicesSeries.isRefetching ||
    continueListening.isRefetching ||
    culturalGroups.isRefetching ||
    storytellers.isRefetching;

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["home"] });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <SectionHeader title="Featured" />
        <SeriesRail query={featuredSeries} onPressSeries={goToSeries} />

        <SectionHeader title="Voices of Our Elders" />
        <SeriesRail query={elderVoicesSeries} onPressSeries={goToSeries} />

        <SectionHeader title="Continue Listening" />
        {continueListening.isLoading ? (
          <Skeleton width="100%" height={80} />
        ) : !continueListening.data || continueListening.data.length === 0 ? (
          <EmptyState
            title="Nothing in progress"
            body="Episodes you start will show up here so you can pick up where you left off."
          />
        ) : (
          continueListening.data.map((episode) => (
            <EpisodeRow
              key={episode.id}
              title={episode.title}
              durationSeconds={episode.durationSeconds}
              accessTier={episode.accessTier}
              contentSource={episode.contentSource}
            />
          ))
        )}

        {CATEGORY_RAILS.map((rail) => (
          <CategoryRailSection
            key={rail.key}
            category={rail.key}
            title={rail.title}
            onPressSeries={goToSeries}
          />
        ))}

        <SectionHeader title="Peoples & Kingdoms" />
        {culturalGroups.isLoading ? (
          <Skeleton width="100%" height={140} />
        ) : !culturalGroups.data || culturalGroups.data.length === 0 ? (
          <EmptyState title="Nothing here yet" body="Check back soon for new cultures." />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {culturalGroups.data.map((group) => (
              <DestinationCard
                key={group.id}
                name={group.name}
                region={group.region}
                coverImageUrl={group.coverImageUrl}
                onPress={() => goToCulturalGroup(group.id)}
              />
            ))}
          </ScrollView>
        )}

        <SectionHeader title="Meet the Storytellers" />
        {storytellers.isLoading ? (
          <Skeleton width="100%" height={140} />
        ) : !storytellers.data || storytellers.data.length === 0 ? (
          <EmptyState title="Nothing here yet" body="Storyteller profiles will appear here soon." />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {storytellers.data.map((contributor) => (
              <DestinationCard
                key={contributor.id}
                name={contributor.displayName}
                region={contributor.district}
                coverImageUrl={contributor.photoUrl}
                onPress={() => goToContributor(contributor.id)}
              />
            ))}
          </ScrollView>
        )}
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

`DestinationCard` is reused for both the "Peoples & Kingdoms" and "Meet the Storytellers" rails (cover/photo + name + a subtitle line) rather than building two more near-identical card components — it already has exactly the `name`/`region`/`coverImageUrl` shape both need (a contributor's `district` maps to the `region` slot). `useCategoryRail(category)` is called from inside `CategoryRailSection` — a real component, not a callback — so each of the 5 rendered instances calls the hook once at its own top level; this satisfies React's rules of hooks with no lint suppression needed (rules of hooks constrains a single component instance's call order across renders, not how many sibling component instances exist — calling `useCategoryRail` directly inside `HomeScreen`'s `.map()` callback would have been the actual violation, which is why it's factored into its own component instead).

- [ ] **Step 2: Verify typecheck and lint — this is the task that must turn both green**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both PASS with zero errors — this is the first point in the plan where that's true, since this task removes the last reference to `mockEpisodes`/`mockSeries`.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(app)/(tabs)/index.tsx"
git commit -m "feat: rebuild Home tab on real Supabase data"
```

---

### Task 10: Series detail screen

**Files:**

- Create: `apps/mobile/src/app/(app)/series/[id].tsx`

**Interfaces:**

- Consumes: `useSeriesDetail` (Task 7), `useToggleFavorite` (Task 5), `useRequireAuth`/`SignInPromptSheet` (existing, adopted here for the first time), `usePlayerStore` (existing), `Skeleton`/`EmptyState` (Task 4).
- Produces: the `series/[id]` drill-down route.

No test — screen-level composition.

- [ ] **Step 1: Write the screen**

```tsx
// apps/mobile/src/app/(app)/series/[id].tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EpisodeRow } from "@/components/ui/episode-row";
import { Skeleton } from "@/components/ui/skeleton";
import { SignInPromptSheet } from "@/components/sign-in-prompt-sheet";
import { Spacing } from "@/constants/theme";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useSeriesDetail, type SeriesDetailEpisode } from "@/hooks/queries/use-series-detail";
import { useToggleFavorite } from "@/hooks/queries/use-toggle-favorite";
import { usePlayerStore } from "@/stores/player-store";

export default function SeriesDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useSeriesDetail(id);
  const play = usePlayerStore((state) => state.play);
  const { toggle } = useToggleFavorite();
  const { requireAuth, promptVisible, dismissPrompt } = useRequireAuth();
  const [isFavorited, setIsFavorited] = useState(false);

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Skeleton width="100%" height={200} />
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <EmptyState
          title="Not found"
          body="This series isn't available — it may have been unpublished or the link may be wrong."
        />
      </SafeAreaView>
    );
  }

  const series = query.data;
  const resumable = series.episodes.find((episode) => episode.resumePositionSeconds !== null);
  const firstFreeEpisode = series.episodes.find((episode) => episode.accessTier === "free");

  const playAll = () => {
    const target: SeriesDetailEpisode | undefined =
      resumable ?? firstFreeEpisode ?? series.episodes[0];
    if (target) {
      play({
        id: target.id,
        title: target.title,
        durationSeconds: target.durationSeconds,
        accessTier: target.accessTier,
        contentSource: target.contentSource,
      });
    }
  };

  const handleFavorite = () => {
    requireAuth(() => {
      const wasFavorited = isFavorited;
      setIsFavorited(!wasFavorited);
      toggle({ seriesId: series.id }, wasFavorited).catch(() => {
        setIsFavorited(wasFavorited);
      });
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">{series.title}</ThemedText>
        {series.description ? (
          <ThemedText type="default" themeColor="textSecondary">
            {series.description}
          </ThemedText>
        ) : null}
        {series.category ? (
          <ThemedText type="small" themeColor="textSecondary">
            {series.category}
          </ThemedText>
        ) : null}

        <ThemedView style={styles.actions}>
          <Button
            label={resumable ? "Resume" : "Play All"}
            onPress={playAll}
            disabled={series.episodes.length === 0}
          />
          <Pressable onPress={handleFavorite}>
            <ThemedText type="default" themeColor={isFavorited ? "accent" : "textSecondary"}>
              {isFavorited ? "♥ Favorited" : "♡ Favorite"}
            </ThemedText>
          </Pressable>
        </ThemedView>

        {series.episodes.length === 0 ? (
          <EmptyState title="No episodes yet" body="Episodes will appear here once published." />
        ) : (
          series.episodes.map((episode) => (
            <EpisodeRow
              key={episode.id}
              title={episode.title}
              durationSeconds={episode.durationSeconds}
              accessTier={episode.accessTier}
              contentSource={episode.contentSource}
              onPress={
                episode.accessTier === "free"
                  ? () =>
                      play({
                        id: episode.id,
                        title: episode.title,
                        durationSeconds: episode.durationSeconds,
                        accessTier: episode.accessTier,
                        contentSource: episode.contentSource,
                      })
                  : undefined
              }
            />
          ))
        )}
      </ScrollView>
      <SignInPromptSheet
        visible={promptVisible}
        onDismiss={dismissPrompt}
        onSignIn={() => {
          dismissPrompt();
          router.push("/sign-in");
        }}
        onSignUp={() => {
          dismissPrompt();
          router.push("/sign-up");
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
});
```

`isFavorited` is local `useState`, not derived from a query — this plan doesn't add a "is this already favorited" read query (the design spec scopes favoriting to the toggle mutation itself, not a favorited-state fetch), so the heart starts unfavorited every time the screen mounts and only reflects toggles made during this visit. This is a known, acceptable simplification for this prompt, not a bug — a future prompt can add a `useIsFavorited(seriesId)` read if the product wants the heart to reflect prior-session state. `SignInPromptSheet`'s `onSignIn`/`onSignUp` navigate to the existing `/sign-in`/`/sign-up` auth routes (built in the prior authentication plan) — this is the first place in the app that actually triggers `SignInPromptSheet`, exactly as the prior plan's `docs/auth.md` anticipated.

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(app)/series/[id].tsx"
git commit -m "feat: add Series detail screen with Play All, favoriting, and guest gating"
```

---

### Task 11: Contributor profile screen

**Files:**

- Create: `apps/mobile/src/app/(app)/contributor/[id].tsx`

**Interfaces:**

- Consumes: `useContributorDetail` (Task 7), `Skeleton`/`EmptyState` (Task 4).
- Produces: the `contributor/[id]` drill-down route.

No test — screen-level composition.

- [ ] **Step 1: Write the screen**

```tsx
// apps/mobile/src/app/(app)/contributor/[id].tsx
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useContributorDetail } from "@/hooks/queries/use-contributor-detail";

export default function ContributorProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useContributorDetail(id);

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Skeleton width="100%" height={200} />
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <EmptyState
          title="Not found"
          body="This storyteller's profile isn't available right now."
        />
      </SafeAreaView>
    );
  }

  const contributor = query.data;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        {contributor.photoUrl ? (
          <Image source={{ uri: contributor.photoUrl }} style={styles.photo} contentFit="cover" />
        ) : null}
        <ThemedText type="title">{contributor.displayName}</ThemedText>
        {contributor.district || contributor.country ? (
          <ThemedText type="small" themeColor="textSecondary">
            {[contributor.district, contributor.country].filter(Boolean).join(", ")}
          </ThemedText>
        ) : null}
        {contributor.bio ? <ThemedText type="default">{contributor.bio}</ThemedText> : null}

        {contributor.episodes.length === 0 ? (
          <EmptyState
            title="No episodes yet"
            body="Episodes this storyteller contributed to will appear here."
          />
        ) : (
          contributor.episodes.map((episode) => (
            <Pressable
              key={`${episode.id}-${episode.role}`}
              style={styles.episodeRow}
              onPress={() => router.push(`/series/${episode.seriesId}`)}
            >
              <View style={styles.episodeInfo}>
                <ThemedText type="default">{episode.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {episode.seriesTitle} · {episode.role}
                </ThemedText>
              </View>
            </Pressable>
          ))
        )}
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
    gap: Spacing.three,
  },
  photo: {
    width: 96,
    height: 96,
    borderRadius: Spacing.six,
  },
  episodeRow: {
    paddingVertical: Spacing.two,
  },
  episodeInfo: {
    gap: Spacing.half,
  },
});
```

Each episode row navigates to that episode's parent series detail screen (Task 10), not a standalone episode screen — episodes were never made independently routable anywhere in this plan or the schema (they're always reached through a series), matching the design spec's explicit note on this.

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(app)/contributor/[id].tsx"
git commit -m "feat: add Contributor profile screen"
```

---

### Task 12: Cultural Group detail screen

**Files:**

- Create: `apps/mobile/src/app/(app)/cultural-group/[id].tsx`

**Interfaces:**

- Consumes: `useCulturalGroupDetail` (Task 7), `SeriesCard`/`DestinationCard`/`SectionHeader` (existing), `Skeleton`/`EmptyState` (Task 4).
- Produces: the `cultural-group/[id]` drill-down route — the last new screen in this plan.

No test — screen-level composition.

- [ ] **Step 1: Write the screen**

```tsx
// apps/mobile/src/app/(app)/cultural-group/[id].tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { DestinationCard } from "@/components/ui/destination-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { SeriesCard } from "@/components/ui/series-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useCulturalGroupDetail } from "@/hooks/queries/use-cultural-group-detail";

export default function CulturalGroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useCulturalGroupDetail(id);

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Skeleton width="100%" height={200} />
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <EmptyState title="Not found" body="This culture's page isn't available right now." />
      </SafeAreaView>
    );
  }

  const group = query.data;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">{group.name}</ThemedText>
        {group.country || group.region ? (
          <ThemedText type="small" themeColor="textSecondary">
            {[group.region, group.country].filter(Boolean).join(", ")}
          </ThemedText>
        ) : null}
        {group.description ? <ThemedText type="default">{group.description}</ThemedText> : null}

        <SectionHeader title="Series" />
        {group.series.length === 0 ? (
          <EmptyState title="No series yet" body="Series from this culture will appear here." />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {group.series.map((series) => (
              <SeriesCard
                key={series.id}
                title={series.title}
                coverImageUrl={series.coverImageUrl}
                category={null}
                episodeCount={series.episodeCount}
                onPress={() => router.push(`/series/${series.id}`)}
              />
            ))}
          </ScrollView>
        )}

        <SectionHeader title="Contributors" />
        {group.contributors.length === 0 ? (
          <EmptyState
            title="No contributors yet"
            body="Storytellers from this culture will appear here."
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {group.contributors.map((contributor) => (
              <DestinationCard
                key={contributor.id}
                name={contributor.displayName}
                region={contributor.district}
                coverImageUrl={contributor.photoUrl}
                onPress={() => router.push(`/contributor/${contributor.id}`)}
              />
            ))}
          </ScrollView>
        )}
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
    gap: Spacing.three,
  },
  row: {
    gap: Spacing.three,
  },
});
```

`SeriesCard`'s `category` prop is passed `null` here (not `series.category`, since `CulturalGroupDetail`'s `series` shape — defined in Task 7 — deliberately doesn't fetch `category` at all, only what this rail actually displays: title/cover/episode count) — this is intentional, not an oversight; re-check Task 7's `CulturalGroupDetail` type if this looks like a missing field, it isn't one.

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(app)/cultural-group/[id].tsx"
git commit -m "feat: add Cultural Group detail screen"
```

---

## Verification (whole plan)

- `pnpm typecheck` and `pnpm lint` pass across the whole workspace (true starting from Task 9 onward — Tasks 3-8 each carry forward two known, expected `mockEpisodes`/`mockSeries` errors until Task 9 removes the last reference to them).
- `pnpm test` passes: `favorite-target.test.ts`'s 3 new tests, plus every pre-existing test from prior plans continuing to pass unchanged.
- No dangling references to `mockEpisodes`/`mockSeries` anywhere in `apps/mobile/src` after Task 9.
- Home's "Continue Listening" section and every detail screen degrade gracefully (skeleton → data or empty state, never a crash) for both guest and signed-in sessions.
- The Series detail screen's Favorite toggle shows `SignInPromptSheet` for a guest and toggles immediately for a signed-in user; "Play All"/tapping a free episode calls `usePlayerStore.play()` and the `MiniPlayer` becomes visible for the first time in this app's history.
- Running the app against a real Supabase project with real `is_featured`/`is_published`/`cultural_groups`/`contributors` data — confirming the Home sections populate correctly, pull-to-refresh works, and each embedded-resource query (`episodes(count)`, `listening_progress` scoped by RLS, `series_cultural_groups`/`contributor_cultural_groups` junctions) returns the expected shape — is the authoritative end-to-end test, out of this plan's scope per the established no-Docker/no-local-Supabase convention this project has used throughout.
