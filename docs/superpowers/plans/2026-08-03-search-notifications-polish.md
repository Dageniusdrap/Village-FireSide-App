# Search, Notifications & Polish (Prompt 13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build global full-text search, push-notification token infrastructure (send-trigger deferred to Prompt 15), and a polish pass — share buttons, error/retry states plus one error boundary, haptics, a repo-wide accessibility retrofit, and a dead-asset cleanup.

**Architecture:** Search is 4 parallel client-side `.textSearch()` queries against existing RLS-protected tables/views (no new privileged function). Push notifications get one owner-only table (`push_tokens`) and client-side registration; nothing sends to it yet. Polish tasks are independent, mostly-additive edits across many existing files — each task's diff is self-contained and reviewable on its own.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, TanStack Query, Zustand, expo-notifications, expo-haptics (new), expo-updates (new), Postgres full-text search (`tsvector`/GIN), TypeScript throughout.

## Global Constraints

- **Read the exact versioned Expo docs before writing code.** `apps/mobile/AGENTS.md` requires checking https://docs.expo.dev/versions/v57.0.0/ before writing any code — this matters most for `expo-notifications` (permission/token APIs), `expo-haptics`, and `expo-updates` (`Updates.reloadAsync()`), all newly exercised or newly added in this plan.
- **Add new dependencies via `npx expo install`, not hand-typed versions.** Run `npx expo install expo-haptics expo-updates` from `apps/mobile/` — this resolves the exact SDK-57-compatible pinned version Expo's own tooling would choose, matching this project's existing `expo-*` tilde-pinning convention (do not fabricate a version number).
- **Every task must leave `pnpm typecheck` clean.**
- **`class_episode_listen_counts`'s return shape stays untouched.** Not touched by this plan at all — noted only because Prompt 12 established the constraint and no task here should ever add a migration that touches it.
- **Commit after every task**, following this repo's convention: `git commit -m "Prompt 13: <description>"`.
- **No automated tests for query hooks, screens, or component prop additions** — matches this codebase's established, confirmed precedent (no test file exists for any `use-*.ts` query hook or screen component anywhere in this app). Each task instead ends with `pnpm typecheck` (and `pnpm lint` where noted) passing, plus a manual verification step where one is meaningful.
- Full spec: `docs/superpowers/specs/2026-08-03-search-notifications-polish-design.md`. Read it if any task below is unclear about intent — it also documents the reasoning behind several non-obvious decisions (query volume, permission timing, error-boundary mechanics) this plan assumes without repeating.

---

### Task 1: Search — `tsvector` columns, GIN indexes, and index-usage verification

**Files:**

- Create: `supabase/migrations/20260803100000_search_tsvector_columns.sql`

**Interfaces:**

- Produces: `search_vector` column on `series`, `episodes`, `destinations`, `contributors`; `public_contributors` view gains a `search_vector` column. Consumed by Task 2's `useGlobalSearch`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260803100000_search_tsvector_columns.sql

alter table series
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index series_search_vector_idx on series using gin (search_vector);

alter table episodes
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index episodes_search_vector_idx on episodes using gin (search_vector);

alter table destinations
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index destinations_search_vector_idx on destinations using gin (search_vector);

alter table contributors
  add column search_vector tsvector
  generated always as (to_tsvector('english', coalesce(display_name, ''))) stored;

create index contributors_search_vector_idx on contributors using gin (search_vector);

create or replace view public_contributors as
select
  id,
  display_name,
  contributor_type,
  case when is_anonymous then null else bio end as bio,
  case when is_anonymous then null else photo_url end as photo_url,
  case when is_anonymous then null else district end as district,
  case when is_anonymous then null else country end as country,
  search_vector
from contributors
where exists (
  select 1
  from episode_contributors ec
  join episodes e on e.id = ec.episode_id
  where ec.contributor_id = contributors.id
    and e.status = 'published'
);
```

- [ ] **Step 2: Apply the migration to the live linked project**

From the repo root:

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
supabase db push
```

(If `.env.supabase-cli.local` doesn't exist in this session, run `supabase login` first, then re-link with `supabase link` before `db push`.)

- [ ] **Step 3: Confirm it applied**

```bash
supabase migration list
```

Expected: `20260803100000` appears with matching `local`/`remote` values.

- [ ] **Step 4: Verify index usage — not with a plain `EXPLAIN ANALYZE`**

This project's content tables are currently empty (`contributors`/`series`/`episodes`/`destinations` all 0 rows, confirmed live during planning). Postgres's planner costs a sequential scan as cheaper than an index scan at near-zero row counts regardless of whether a usable index exists — a plain `explain analyze` here would show `Seq Scan` for a reason that has nothing to do with whether the view's `where exists` subquery lets pushdown reach the indexed expression. Force the planner's hand instead, via the Management API (same technique used earlier this session):

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
PROJECT_REF=$(cat supabase/.temp/project-ref)
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"begin; set local enable_seqscan = off; explain select * from public_contributors where search_vector @@ websearch_to_tsquery(\'"'"'english\'"'"', \'"'"'test\'"'"'); rollback;"}'
```

Expected: the plan output references `contributors_search_vector_idx` (an `Index Scan`/`Bitmap Index Scan` line). If it still shows a sequential scan even with `enable_seqscan` off, that's a real finding — pushdown through the view genuinely isn't reaching the indexed column — and this task is not done; escalate rather than proceeding to Task 2. Report the actual plan output in the task's completion notes either way.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803100000_search_tsvector_columns.sql
git commit -m "Prompt 13: add search tsvector columns and GIN indexes"
```

---

### Task 2: `useGlobalSearch` query hook

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-global-search.ts`

**Interfaces:**

- Consumes: `search_vector` columns from Task 1 (via Supabase `.textSearch()`).
- Produces: `useGlobalSearch(query: string)` returning
  `{ data: GlobalSearchResults | undefined, isLoading: boolean, isError: boolean }`
  where
  `GlobalSearchResults = { series: SearchSeriesResult[], episodes: SearchEpisodeResult[], destinations: SearchDestinationResult[], contributors: SearchContributorResult[] }`.
  Consumed by Task 5's `/search` screen.

- [ ] **Step 1: Write the hook**

```ts
// apps/mobile/src/hooks/queries/use-global-search.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

const RESULT_LIMIT = 5;

export type SearchSeriesResult = { id: string; title: string; coverImageUrl: string | null };
export type SearchEpisodeResult = {
  id: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
};
export type SearchDestinationResult = { id: string; slug: string; name: string };
export type SearchContributorResult = { id: string; displayName: string };

export type GlobalSearchResults = {
  series: SearchSeriesResult[];
  episodes: SearchEpisodeResult[];
  destinations: SearchDestinationResult[];
  contributors: SearchContributorResult[];
};

type SeriesRow = { id: string; title: string; cover_image_url: string | null };
type EpisodeRow = {
  id: string;
  title: string;
  series_id: string;
  series: { title: string } | null;
};
type DestinationRow = { id: string; slug: string; name: string };
type ContributorRow = { id: string; display_name: string };

export function useGlobalSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", trimmed],
    enabled: trimmed.length > 0,
    queryFn: async (): Promise<GlobalSearchResults> => {
      const tsQuery = trimmed.split(/\s+/).join(" | ");

      const [seriesRes, episodesRes, destinationsRes, contributorsRes] = await Promise.all([
        supabase
          .from("series")
          .select("id, title, cover_image_url")
          .textSearch("search_vector", tsQuery)
          .limit(RESULT_LIMIT)
          .returns<SeriesRow[]>(),
        supabase
          .from("episodes")
          .select("id, title, series_id, series(title)")
          .textSearch("search_vector", tsQuery)
          .limit(RESULT_LIMIT)
          .returns<EpisodeRow[]>(),
        supabase
          .from("destinations")
          .select("id, slug, name")
          .textSearch("search_vector", tsQuery)
          .limit(RESULT_LIMIT)
          .returns<DestinationRow[]>(),
        supabase
          .from("public_contributors")
          .select("id, display_name")
          .textSearch("search_vector", tsQuery)
          .limit(RESULT_LIMIT)
          .returns<ContributorRow[]>(),
      ]);

      if (seriesRes.error) throw seriesRes.error;
      if (episodesRes.error) throw episodesRes.error;
      if (destinationsRes.error) throw destinationsRes.error;
      if (contributorsRes.error) throw contributorsRes.error;

      return {
        series: (seriesRes.data ?? []).map((row) => ({
          id: row.id,
          title: row.title,
          coverImageUrl: row.cover_image_url,
        })),
        episodes: (episodesRes.data ?? [])
          .filter((row): row is EpisodeRow & { series: { title: string } } => row.series !== null)
          .map((row) => ({
            id: row.id,
            title: row.title,
            seriesId: row.series_id,
            seriesTitle: row.series.title,
          })),
        destinations: (destinationsRes.data ?? []).map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
        })),
        contributors: (contributorsRes.data ?? []).map((row) => ({
          id: row.id,
          displayName: row.display_name,
        })),
      };
    },
  });
}
```

`row.series !== null` guard on the episodes result follows the same
established nullable-embed pattern as `use-subject-episodes.ts` and
`use-bookmarks.ts` — a published episode under an unpublished series
returns a null `series` embed via RLS, and must be filtered rather than
crash the mapper. `tsQuery`'s `split(/\s+/).join(" | ")` builds an
OR-across-words query (any word matches) rather than
`websearch_to_tsquery`'s implicit AND, matching a short, informal
search box's expected behavior over a strict all-words match.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/hooks/queries/use-global-search.ts
git commit -m "Prompt 13: add useGlobalSearch hook"
```

---

### Task 3: Recent-searches local storage

**Files:**

- Create: `apps/mobile/src/lib/search-history.ts`
- Create: `apps/mobile/src/stores/search-history-store.ts`

**Interfaces:**

- Produces: `readSearchHistory(): string[]`, `writeSearchHistory(queries: string[]): void` (lib); `useSearchHistoryStore()` returning `{ queries: string[], addQuery: (query: string) => void, clearHistory: () => void }` (store). Consumed by Task 5's `/search` screen.

- [ ] **Step 1: Write the file-based lib, mirroring `lib/settings.ts` exactly**

```ts
// apps/mobile/src/lib/search-history.ts
import { File, Paths } from "expo-file-system";

const MAX_HISTORY = 10;

const historyFile = new File(Paths.document, "search-history.json");

export function readSearchHistory(): string[] {
  if (!historyFile.exists) {
    return [];
  }
  try {
    const parsed = JSON.parse(historyFile.textSync()) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeSearchHistory(queries: string[]): void {
  if (!historyFile.exists) {
    historyFile.create();
  }
  historyFile.write(JSON.stringify(queries.slice(0, MAX_HISTORY)));
}
```

- [ ] **Step 2: Write the Zustand wrapper, mirroring `stores/settings-store.ts`**

```ts
// apps/mobile/src/stores/search-history-store.ts
import { create } from "zustand";

import { readSearchHistory, writeSearchHistory } from "@/lib/search-history";

type SearchHistoryState = {
  queries: string[];
  addQuery: (query: string) => void;
  clearHistory: () => void;
};

export const useSearchHistoryStore = create<SearchHistoryState>((set, get) => ({
  queries: readSearchHistory(),
  addQuery: (query) => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return;
    }
    const next = [trimmed, ...get().queries.filter((q) => q !== trimmed)];
    writeSearchHistory(next);
    set({ queries: next });
  },
  clearHistory: () => {
    writeSearchHistory([]);
    set({ queries: [] });
  },
}));
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/search-history.ts apps/mobile/src/stores/search-history-store.ts
git commit -m "Prompt 13: add recent-searches local storage"
```

---

### Task 4: `TabHeader` component and wiring into all 5 tab screens

**Files:**

- Create: `apps/mobile/src/components/ui/tab-header.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/index.tsx:119-124`
- Modify: `apps/mobile/src/app/(app)/(tabs)/explore.tsx:44-45`
- Modify: `apps/mobile/src/app/(app)/(tabs)/learn.tsx:18-20`
- Modify: `apps/mobile/src/app/(app)/(tabs)/library.tsx:53-54`
- Modify: `apps/mobile/src/app/(app)/(tabs)/profile.tsx:21-23`

**Interfaces:**

- Produces: `<TabHeader title={string} />` — a title plus a magnifier icon that navigates to `/search`. Consumed by Task 5 (the icon's destination).

- [ ] **Step 1: Write `TabHeader`**

```tsx
// apps/mobile/src/components/ui/tab-header.tsx
import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

export function TabHeader({ title }: { title: string }) {
  const router = useRouter();

  return (
    <ThemedView style={styles.row}>
      <ThemedText type="title">{title}</ThemedText>
      <Pressable
        onPress={() => router.push("/search")}
        hitSlop={Spacing.two}
        accessibilityRole="button"
        accessibilityLabel="Search"
      >
        <ThemedText type="title">🔍</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
});
```

- [ ] **Step 2: Wire into `index.tsx`**

Add `import { TabHeader } from "@/components/ui/tab-header";` to the imports, and insert `<TabHeader title="Home" />` immediately before the existing `<SectionHeader title="Featured" />` at line 124 (inside the same `ScrollView`, as its new first child).

- [ ] **Step 3: Wire into `explore.tsx`**

Add the same import. `explore.tsx:44-45` currently has `<SectionHeader title="Explore" />` as the screen's title — replace that line with `<TabHeader title="Explore" />` (it already serves the same role; `TabHeader` supersedes it rather than sitting alongside it).

- [ ] **Step 4: Wire into `learn.tsx`**

Add the same import. Insert `<TabHeader title="Learn" />` immediately before the existing `<SectionHeader title="Browse by Subject" />` at `learn.tsx:18-20` (inside the `ScrollView`, as its new first child) — `learn.tsx` has no existing screen-level title, so this is additive, not a replacement.

- [ ] **Step 5: Wire into `library.tsx`**

Add the same import. `library.tsx:53-54` has `<SectionHeader title="Library" />` **outside** the `ScrollView`, unlike the other four screens — replace that line with `<TabHeader title="Library" />` in the same outside-the-scroll-view position.

- [ ] **Step 6: Wire into `profile.tsx`**

Add the same import. `profile.tsx:21-23` has `<SectionHeader title="Profile" />` inside `ThemedView`/`SafeAreaView`, before the scroll content (this screen doesn't use a `ScrollView` at all) — replace that line with `<TabHeader title="Profile" />` in the same position.

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/components/ui/tab-header.tsx apps/mobile/src/app/\(app\)/\(tabs\)/index.tsx apps/mobile/src/app/\(app\)/\(tabs\)/explore.tsx apps/mobile/src/app/\(app\)/\(tabs\)/learn.tsx apps/mobile/src/app/\(app\)/\(tabs\)/library.tsx apps/mobile/src/app/\(app\)/\(tabs\)/profile.tsx
git commit -m "Prompt 13: add TabHeader with search entry point to all tab screens"
```

---

### Task 5: `/search` screen

**Files:**

- Create: `apps/mobile/src/app/(app)/search.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: `useGlobalSearch` (Task 2), `useSearchHistoryStore` (Task 3).
- Produces: the `/search` route, navigable from any `TabHeader`'s magnifier icon (Task 4).

- [ ] **Step 1: Write the search screen**

```tsx
// apps/mobile/src/app/(app)/search.tsx
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BackButton } from "@/components/ui/back-button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { useGlobalSearch } from "@/hooks/queries/use-global-search";
import { useSearchHistoryStore } from "@/stores/search-history-store";

const DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const recentQueries = useSearchHistoryStore((state) => state.queries);
  const addQuery = useSearchHistoryStore((state) => state.addQuery);
  const clearHistory = useSearchHistoryStore((state) => state.clearHistory);

  const onChangeText = (text: string) => {
    setInput(text);
    const handle = setTimeout(() => setDebounced(text), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  };

  const query = useGlobalSearch(debounced);

  const onSubmit = () => {
    if (input.trim().length > 0) {
      addQuery(input.trim());
    }
  };

  const showRecent = debounced.trim().length === 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <ThemedView style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Search stories, places, storytellers…"
          value={input}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          autoFocus
        />
      </ThemedView>

      <ScrollView contentContainerStyle={styles.content}>
        {showRecent ? (
          <>
            <SectionHeader
              title="Recent searches"
              actionLabel="Clear"
              onActionPress={clearHistory}
            />
            {recentQueries.length === 0 ? (
              <EmptyState
                title="No recent searches"
                body="Your recent searches will appear here."
              />
            ) : (
              recentQueries.map((recent) => (
                <Pressable
                  key={recent}
                  onPress={() => {
                    setInput(recent);
                    setDebounced(recent);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Search again for ${recent}`}
                >
                  <ThemedText type="default">{recent}</ThemedText>
                </Pressable>
              ))
            )}
          </>
        ) : query.isError ? (
          <EmptyState title="Couldn't search" body="Please try again." />
        ) : query.isLoading ? null : (
          <>
            {query.data && query.data.series.length > 0 ? (
              <>
                <SectionHeader title="Series" />
                {query.data.series.map((result) => (
                  <Pressable
                    key={result.id}
                    onPress={() => router.push(`/series/${result.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open series ${result.title}`}
                  >
                    <ThemedText type="default">{result.title}</ThemedText>
                  </Pressable>
                ))}
              </>
            ) : null}
            {query.data && query.data.episodes.length > 0 ? (
              <>
                <SectionHeader title="Episodes" />
                {query.data.episodes.map((result) => (
                  <Pressable
                    key={result.id}
                    onPress={() => router.push(`/episode/${result.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open episode ${result.title}`}
                  >
                    <ThemedText type="default">{result.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {result.seriesTitle}
                    </ThemedText>
                  </Pressable>
                ))}
              </>
            ) : null}
            {query.data && query.data.destinations.length > 0 ? (
              <>
                <SectionHeader title="Destinations" />
                {query.data.destinations.map((result) => (
                  <Pressable
                    key={result.id}
                    onPress={() => router.push(`/destination/${result.slug}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open destination ${result.name}`}
                  >
                    <ThemedText type="default">{result.name}</ThemedText>
                  </Pressable>
                ))}
              </>
            ) : null}
            {query.data && query.data.contributors.length > 0 ? (
              <>
                <SectionHeader title="Contributors" />
                {query.data.contributors.map((result) => (
                  <Pressable
                    key={result.id}
                    onPress={() => router.push(`/contributor/${result.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open contributor ${result.displayName}`}
                  >
                    <ThemedText type="default">{result.displayName}</ThemedText>
                  </Pressable>
                ))}
              </>
            ) : null}
            {query.data &&
            query.data.series.length === 0 &&
            query.data.episodes.length === 0 &&
            query.data.destinations.length === 0 &&
            query.data.contributors.length === 0 ? (
              <EmptyState title="No results" body="Try a different search term." />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  searchRow: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
});
```

`SectionHeader`'s `actionLabel`/`onActionPress` props are the existing
ones already used elsewhere in this codebase for a header-level action
link (confirmed in exploration: `ui/section-header.tsx:22`, "Section
header's optional action link, e.g. 'Delete All'") — reused here for
"Clear" rather than inventing a new pattern.

- [ ] **Step 2: Register the route**

In `apps/mobile/src/app/(app)/_layout.tsx`, add one line inside the `<Stack>`, immediately after the `(tabs)` screen entry:

```tsx
<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
<Stack.Screen name="search" options={{ headerShown: false }} />
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/\(app\)/search.tsx apps/mobile/src/app/\(app\)/_layout.tsx
git commit -m "Prompt 13: add global search screen"
```

---

### Task 6: `push_tokens` table

**Files:**

- Create: `supabase/migrations/20260803100100_push_tokens_table.sql`

**Interfaces:**

- Produces: `push_tokens` table (`id`, `user_id`, `expo_push_token`, `platform`, `created_at`, `updated_at`) with owner-only RLS. Consumed by Task 7.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260803100100_push_tokens_table.sql

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  expo_push_token text not null,
  platform text not null, -- 'ios' | 'android'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create trigger push_tokens_set_updated_at
  before update on push_tokens
  for each row
  execute function set_updated_at();

alter table push_tokens enable row level security;

create policy push_tokens_owner_all
  on push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

- [ ] **Step 2: Apply to the live linked project**

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
supabase db push
```

- [ ] **Step 3: Confirm it applied**

```bash
supabase migration list
```

Expected: `20260803100100` shows matching `local`/`remote` values.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260803100100_push_tokens_table.sql
git commit -m "Prompt 13: add push_tokens table"
```

---

### Task 7: Notification permission flow and token registration

**Files:**

- Create: `apps/mobile/src/lib/notification-permission-flag.ts`
- Create: `apps/mobile/src/lib/push-token-registration.ts`
- Modify: `apps/mobile/src/components/audio-status-driver.tsx:81-94`

**Interfaces:**

- Consumes: `push_tokens` table (Task 6).
- Produces: `hasPromptedForNotifications(): boolean`, `markPromptedForNotifications(): void`; `registerPushToken(userId: string): Promise<void>`. `registerPushToken` is also consumed by Task 8's cold-start re-registration.

- [ ] **Step 1: Write the one-shot flag lib, mirroring `lib/settings.ts`**

```ts
// apps/mobile/src/lib/notification-permission-flag.ts
import { File, Paths } from "expo-file-system";

const flagFile = new File(Paths.document, "notification-prompt-flag.json");

export function hasPromptedForNotifications(): boolean {
  if (!flagFile.exists) {
    return false;
  }
  try {
    return (JSON.parse(flagFile.textSync()) as { prompted?: boolean }).prompted === true;
  } catch {
    return false;
  }
}

export function markPromptedForNotifications(): void {
  if (!flagFile.exists) {
    flagFile.create();
  }
  flagFile.write(JSON.stringify({ prompted: true }));
}
```

- [ ] **Step 2: Write push-token registration**

```ts
// apps/mobile/src/lib/push-token-registration.ts
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

export async function registerPushToken(userId: string): Promise<void> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );

  await supabase.from("push_tokens").upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      platform: Platform.OS,
    },
    { onConflict: "user_id,expo_push_token" },
  );
}

export async function requestNotificationPermissionAndRegister(userId: string): Promise<void> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status === "granted") {
    await registerPushToken(userId);
  }
}
```

Read the versioned Expo docs for `expo-notifications`
(https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) before
finalizing this file — the exact shape of
`getExpoPushTokenAsync`'s options and where a project ID is read from
(`Constants.expoConfig?.extra?.eas?.projectId` vs. another field) is
exactly the kind of API surface `apps/mobile/AGENTS.md` warns may have
changed from training-data expectations.

- [ ] **Step 3: Wire the one-time prompt into `audio-status-driver.tsx`'s "episode finished" edge**

This is the one and only place in the codebase where "an episode just
finished" is a discrete, knowable event (confirmed during planning —
`persistListeningProgress`'s internal `completed` boolean is never
exposed to any caller). `audio-status-driver.tsx` already has
`userIdRef.current` (line 35-38) tracking the current user id. Modify
lines 81-94:

```tsx
// didJustFinish edges false -> true exactly once per track end.
const didJustFinishRef = useRef(false);
useEffect(() => {
  if (status.didJustFinish && !didJustFinishRef.current) {
    didJustFinishRef.current = true;
    if (userIdRef.current && !hasPromptedForNotifications()) {
      markPromptedForNotifications();
      void requestNotificationPermissionAndRegister(userIdRef.current);
    }
    if (sleepTimer.mode === "end-of-episode") {
      audioPlayer.pause();
      cancelSleepTimer();
    } else {
      void next();
    }
  } else if (!status.didJustFinish) {
    didJustFinishRef.current = false;
  }
}, [status.didJustFinish, sleepTimer.mode, next, cancelSleepTimer]);
```

Add the two new imports at the top of the file:

```ts
import {
  hasPromptedForNotifications,
  markPromptedForNotifications,
} from "@/lib/notification-permission-flag";
import { requestNotificationPermissionAndRegister } from "@/lib/push-token-registration";
```

A guest (no `userIdRef.current`) never triggers the prompt — matches
the spec's intent that this is a signed-in-user feature; a guest who
later signs in and finishes a first episode after that will still get
prompted normally, since the flag is per-device, not per-account.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/notification-permission-flag.ts apps/mobile/src/lib/push-token-registration.ts apps/mobile/src/components/audio-status-driver.tsx
git commit -m "Prompt 13: request notification permission and register token after first episode finish"
```

---

### Task 8: Notification listeners and cold-start re-registration

**Files:**

- Create: `apps/mobile/src/hooks/use-push-notification-listeners.ts`
- Create: `apps/mobile/src/hooks/use-push-token-reregistration.ts`
- Modify: `apps/mobile/src/app/_layout.tsx`

**Interfaces:**

- Consumes: `registerPushToken` (Task 7).
- Produces: `usePushNotificationListeners()`, `usePushTokenReregistration()` — both called once from the root layout.

- [ ] **Step 1: Write the notification listeners hook**

Tapping a notification whose `data.episodeId` is present navigates to
the existing `/episode/[id]` deep-link-resolver route (Task 5's
`useGlobalSearch` results already navigate there the same way, and
`episode/[id].tsx` already exists from Prompt 11) — no new resolution
logic needed.

```ts
// apps/mobile/src/hooks/use-push-notification-listeners.ts
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";

export function usePushNotificationListeners() {
  const router = useRouter();

  useEffect(() => {
    const receivedSubscription = Notifications.addNotificationReceivedListener(() => {
      // Foreground receipt — no action needed beyond the OS's own
      // foreground presentation (configured via
      // Notifications.setNotificationHandler elsewhere if this project
      // wants a custom in-app banner; out of scope here).
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const episodeId = response.notification.request.content.data?.episodeId;
        if (typeof episodeId === "string") {
          router.push(`/episode/${episodeId}`);
        }
      },
    );

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, [router]);
}
```

Read the versioned Expo docs for `expo-notifications`'s listener API
before finalizing — confirm `addNotificationReceivedListener`/
`addNotificationResponseReceivedListener`'s exact signatures and
whether a `setNotificationHandler` call is required for foreground
presentation on this SDK version.

- [ ] **Step 2: Write the cold-start re-registration hook**

```ts
// apps/mobile/src/hooks/use-push-token-reregistration.ts
import * as Notifications from "expo-notifications";
import { useEffect } from "react";

import { registerPushToken } from "@/lib/push-token-registration";

export function usePushTokenReregistration(userId: string | null) {
  useEffect(() => {
    if (!userId) {
      return;
    }
    void Notifications.getPermissionsAsync().then(({ status }) => {
      if (status === "granted") {
        void registerPushToken(userId);
      }
    });
  }, [userId]);
}
```

This re-registers (upserts) once per cold start when a session exists
and permission is already granted — a deliberate low-cost decision at
current scale (see spec), not an unexamined default. `push_tokens`'
`unique (user_id, expo_push_token)` constraint makes the upsert
idempotent.

- [ ] **Step 3: Wire both hooks into the root layout**

In `apps/mobile/src/app/_layout.tsx`, add two imports:

```ts
import { usePushNotificationListeners } from "@/hooks/use-push-notification-listeners";
import { usePushTokenReregistration } from "@/hooks/use-push-token-reregistration";
```

And two calls alongside the existing hook calls at lines 37-41 (after `useSyncPurchasesIdentity();`):

```tsx
useSyncPurchasesIdentity();
usePushNotificationListeners();
usePushTokenReregistration(session?.user.id ?? null);
```

Note `session` is read further down in the existing file (line 54,
`const session = useAuthStore((state) => state.session);`) — move that
line above these two new calls, since `usePushTokenReregistration`
needs it as an argument.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Manual verification**

No automated way to test this without a real device and a real Expo
push token. Once implemented on a device: finish an episode as a
signed-in user, grant the permission prompt, then send yourself a test
push via Expo's push notification tool (https://expo.dev/notifications)
with `data: { "episodeId": "<a real episode id from this project>" }`
targeting the captured Expo push token (visible via a temporary
`console.log` in `registerPushToken`, removed before committing).
Confirm tapping the notification navigates to `/episode/{id}` and
plays it. Record whether this was actually performed or deferred (no
device/simulator available) — matching this project's established
carve-out precedent from prior prompts — rather than silently claiming
it as done.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/hooks/use-push-notification-listeners.ts apps/mobile/src/hooks/use-push-token-reregistration.ts apps/mobile/src/app/_layout.tsx
git commit -m "Prompt 13: add notification tap deep-linking and cold-start token re-registration"
```

---

### Task 9: `EmptyState` retry affordance, wired into all 7 `isError` sites

**Files:**

- Modify: `apps/mobile/src/components/ui/empty-state.tsx`
- Modify: `apps/mobile/src/app/(app)/series/[id].tsx:45-54`
- Modify: `apps/mobile/src/app/(app)/learn/[subject].tsx:120-121`
- Modify: `apps/mobile/src/app/(app)/learn/teacher/index.tsx:64-65`
- Modify: `apps/mobile/src/app/(app)/learn/teacher/class/[id].tsx:40-44`
- Modify: `apps/mobile/src/app/(app)/cultural-group/[id].tsx:30-34`
- Modify: `apps/mobile/src/app/(app)/destination/[slug].tsx:34-40`
- Modify: `apps/mobile/src/app/(app)/contributor/[id].tsx:27-34`

**Interfaces:**

- Produces: `EmptyState`'s new optional `onRetry?: () => void` prop.

- [ ] **Step 1: Add `onRetry` to `EmptyState`**

```tsx
// apps/mobile/src/components/ui/empty-state.tsx
import { Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

export function EmptyState({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {body}
      </ThemedText>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          hitSlop={Spacing.two}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <ThemedText type="default" themeColor="accent">
            Try again
          </ThemedText>
        </Pressable>
      ) : null}
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

- [ ] **Step 2: Wire `onRetry` into each of the 7 sites**

Two of these sites (`learn/[subject].tsx`, `learn/teacher/index.tsx`)
are pure `query.isError` branches — a straightforward retry. The other
5 combine `query.isError || !query.data` into one branch that also
covers a legitimate 404 (a genuinely deleted/unpublished row, no
error). Adding `onRetry` there is somewhat imprecise for the pure-404
case (retrying won't un-404 a real 404), but matches this task's
blanket instruction; noted here rather than silently treated as if
these were pure-error branches:

| File:Line                         | Change                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `learn/[subject].tsx:121`         | Add `onRetry={() => query.refetch()}` to the existing `<EmptyState title="Couldn't load stories" .../>`                      |
| `learn/teacher/index.tsx:65`      | Add `onRetry={() => query.refetch()}` to the existing `<EmptyState title="Couldn't load classes" .../>`                      |
| `learn/teacher/class/[id].tsx:44` | Add `onRetry={() => query.refetch()}` to the existing `<EmptyState title="Couldn't load this class" .../>`                   |
| `series/[id].tsx:49-52`           | Add `onRetry={() => query.refetch()}` to the existing `<EmptyState title="Not found" body="This series isn't available…" />` |
| `cultural-group/[id].tsx:34`      | Add `onRetry={() => query.refetch()}` to the existing `<EmptyState title="Not found" .../>`                                  |
| `destination/[slug].tsx:38`       | Add `onRetry={() => query.refetch()}` to the existing `<EmptyState title="Not found" .../>`                                  |
| `contributor/[id].tsx:31-34`      | Add `onRetry={() => query.refetch()}` to the existing `<EmptyState title="Not found" .../>`                                  |

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/ui/empty-state.tsx apps/mobile/src/app/\(app\)/series/\[id\].tsx apps/mobile/src/app/\(app\)/learn/\[subject\].tsx apps/mobile/src/app/\(app\)/learn/teacher/index.tsx apps/mobile/src/app/\(app\)/learn/teacher/class/\[id\].tsx apps/mobile/src/app/\(app\)/cultural-group/\[id\].tsx apps/mobile/src/app/\(app\)/destination/\[slug\].tsx apps/mobile/src/app/\(app\)/contributor/\[id\].tsx
git commit -m "Prompt 13: add retry affordance to EmptyState, wire into every data screen"
```

---

### Task 10: Error boundary

**Files:**

- Modify: `apps/mobile/package.json`, `apps/mobile/pnpm-lock.yaml` (via `npx expo install expo-updates`)
- Create: `apps/mobile/src/components/error-boundary.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Produces: `<ErrorBoundary>` wrapping the `(app)` layout's rendered tree.

- [ ] **Step 1: Add `expo-updates`**

```bash
cd apps/mobile && npx expo install expo-updates
```

- [ ] **Step 2: Write the error boundary**

```tsx
// apps/mobile/src/components/error-boundary.tsx
import * as Updates from "expo-updates";
import { Component, type ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

type Props = { children: ReactNode };
type State = { hasError: boolean };

// "Restart" calls Updates.reloadAsync() — a full JS-context reload —
// not a re-mount of `children`. Zustand stores are module-level
// singletons living outside React's tree, so re-mounting alone would
// not reset any of them; a genuine state-corruption bug would
// immediately re-crash. A full reload resets all in-memory store
// state. This codebase's real local-persistence convention
// (lib/settings.ts, lib/search-history.ts, lib/notification-permission-flag.ts)
// already wraps every read in try/catch with a safe-default fallback,
// so a reload is unlikely to immediately repeat-crash from corrupted
// *persisted* data — the one part of this not independently verified
// is Supabase's own session storage (secure-store-adapter.ts, internal
// to supabase-js), which is assumed (not confirmed here) to treat a
// malformed stored session as "no session" rather than throwing.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  handleRestart = () => {
    void Updates.reloadAsync();
  };

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <ThemedView style={styles.container}>
            <ThemedText type="title">Something went wrong</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              Please restart the app.
            </ThemedText>
            <Pressable
              onPress={this.handleRestart}
              accessibilityRole="button"
              accessibilityLabel="Restart"
            >
              <ThemedText type="default" themeColor="accent">
                Restart
              </ThemedText>
            </Pressable>
          </ThemedView>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    padding: Spacing.four,
  },
});
```

A class component is required here — `componentDidCatch`/
`getDerivedStateFromError` have no hook equivalent in React.

- [ ] **Step 3: Wrap the `(app)` layout**

In `apps/mobile/src/app/(app)/_layout.tsx`, import `ErrorBoundary` and
wrap the returned tree (the outer `<View style={styles.container}>`),
so it also catches `MiniPlayer`/`NowPlayingOverlay` render crashes, not
just the `Stack`:

```tsx
import { ErrorBoundary } from "@/components/error-boundary";
// ...existing imports...

export default function AppLayout() {
  return (
    <ErrorBoundary>
      <View style={styles.container}>
        <Stack>{/* ...existing Stack.Screen entries, including Task 5's "search"... */}</Stack>
        <MiniPlayer />
        <UnlockSheet />
        <PlaybackToast />
        <NowPlayingOverlay />
      </View>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/pnpm-lock.yaml apps/mobile/src/components/error-boundary.tsx apps/mobile/src/app/\(app\)/_layout.tsx
git commit -m "Prompt 13: add top-level error boundary"
```

---

### Task 11: `ShareButton` component

**Files:**

- Create: `apps/mobile/src/components/ui/share-button.tsx`
- Modify: `apps/mobile/src/app/(app)/series/[id].tsx:111-127`
- Modify: `apps/mobile/src/app/(app)/destination/[slug].tsx:104-108`
- Modify: `apps/mobile/src/components/now-playing-overlay.tsx:242-258`
- Modify: `docs/known-issues.md`

**Interfaces:**

- Produces: `<ShareButton url={string} />`.

- [ ] **Step 1: Write `ShareButton`**

```tsx
// apps/mobile/src/components/ui/share-button.tsx
import { Pressable, Share, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";

export function ShareButton({ url }: { url: string }) {
  const onPress = () => {
    Share.share({ message: url }).catch(() => {});
  };

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Share">
      <ThemedText type="default" themeColor="textSecondary" style={styles.icon}>
        ⤴ Share
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  icon: {},
});
```

- [ ] **Step 2: Wire into `series/[id].tsx`**

Add `import { ShareButton } from "@/components/ui/share-button";`. In
the `actions` `ThemedView` (lines 111-127), add a fourth entry right
after the existing download `Pressable` (after line 126):

```tsx
<ShareButton url={`villagefireside://series/${series.id}`} />
```

- [ ] **Step 3: Wire into `destination/[slug].tsx`**

Add the same import. Insert immediately after the existing `<Button label="Plan Your Visit" .../>` (after line 107), still inside the main `ScrollView`, before `<SectionHeader title="Stories from this place" />`:

```tsx
<ShareButton url={`villagefireside://destination/${destination.slug}`} />
```

- [ ] **Step 4: Wire into `now-playing-overlay.tsx` (episode-level sharing)**

There is no dedicated episode detail screen (`/episode/[id]` is a
silent deep-link redirect, confirmed during planning) — episode
sharing goes on the Now Playing overlay's existing action row instead,
sharing whichever episode is currently loaded. Add the same import. In
`actionsRow` (lines 242-258), add a third entry after the existing
sleep-timer `Pressable` (after line 257):

```tsx
<ShareButton url={`villagefireside://episode/${currentEpisode.id}`} />
```

- [ ] **Step 5: Add the known-gap entry to `docs/known-issues.md`**

Append under the `## Mobile` heading, following the file's established
per-entry format (heading, description, fix shape, severity):

```markdown
### Share links only work for recipients who already have the app

`ShareButton` (`apps/mobile/src/components/ui/share-button.tsx`) shares
a `villagefireside://...` deep link via React Native's `Share.share()`.
`app.json` has no `associatedDomains` (iOS) or `intentFilters`
(Android) for HTTPS universal links, and no hosted domain exists
anywhere in this project's configuration — confirmed by grepping the
whole repo. For a recipient without the app installed, a shared link is
inert text or a "no app found" error.

**Fix shape:** register a real domain, host
`.well-known/apple-app-site-association` and `assetlinks.json`, add
`associatedDomains`/`intentFilters` to `app.json`, and build a simple
"get the app" landing/redirect page for non-users — likely alongside a
future marketing-site effort.

**Severity:** Sharing works today for app-to-app use (an existing user
sharing with another existing user). Non-user recipients get a dead
link until the domain infrastructure above exists.
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/components/ui/share-button.tsx apps/mobile/src/app/\(app\)/series/\[id\].tsx apps/mobile/src/app/\(app\)/destination/\[slug\].tsx apps/mobile/src/components/now-playing-overlay.tsx docs/known-issues.md
git commit -m "Prompt 13: add share buttons for series, destination, and now-playing episode"
```

---

### Task 12: Haptics

**Files:**

- Modify: `apps/mobile/package.json`, `apps/mobile/pnpm-lock.yaml` (via `npx expo install expo-haptics`)
- Modify: `apps/mobile/src/components/ui/mini-player.tsx:70`
- Modify: `apps/mobile/src/components/now-playing-overlay.tsx:214`
- Modify: `apps/mobile/src/app/(app)/series/[id].tsx:78-86` (favorite toggle)
- Modify: `apps/mobile/src/components/now-playing-overlay.tsx:146-153` (bookmark save)
- Modify: `apps/mobile/src/app/(app)/learn/join-class.tsx:21-34`
- Modify: `apps/mobile/src/app/(app)/learn/teacher-request.tsx:31-49`
- Modify: `apps/mobile/src/app/(app)/destination/[slug]/inquire.tsx:63-79`

**Interfaces:**

- None new — this task only adds `Haptics` calls at existing call sites, no new exports.

- [ ] **Step 1: Add `expo-haptics`**

```bash
cd apps/mobile && npx expo install expo-haptics
```

- [ ] **Step 2: Play/pause — light impact at both UI call sites**

Called directly at each `Pressable`'s `onPress`, not inside the shared
`player-store.ts` action (per the spec's "no wrapper module" framing —
each site wraps the existing store action):

`mini-player.tsx:70` — add `import * as Haptics from "expo-haptics";`, change:

```tsx
        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            playPause();
          }}
          hitSlop={Spacing.two}
        >
```

`now-playing-overlay.tsx:214` — add the same import, change:

```tsx
            <Pressable
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                playPause();
              }}
            >
```

- [ ] **Step 3: Favorite toggle — light impact**

`series/[id].tsx`'s `handleFavorite` (lines 78-86) — add the same import, change:

```tsx
const handleFavorite = () => {
  requireAuth(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggle({ seriesId: series.id }, isFavorited).catch(() => {});
  });
};
```

- [ ] **Step 4: Bookmark save — light impact**

`now-playing-overlay.tsx`'s `handleBookmarkSave` (lines 146-153) — change:

```tsx
const handleBookmarkSave = (note: string | null) => {
  setBookmarkSheetVisible(false);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  void createBookmark({
    episodeId: currentEpisode.id,
    positionSeconds: status.currentTime,
    note,
  }).catch(() => {});
};
```

- [ ] **Step 5: Join class — success/error notification haptics**

`join-class.tsx`'s `onJoin` — add `import * as Haptics from "expo-haptics";`. Insert `void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);` immediately before the success line (`setJoinedClassName(result.className);`, line 29), and `void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);` in the sibling error branch above it.

- [ ] **Step 6: Teacher request — success/error notification haptics**

`teacher-request.tsx`'s `onSubmit` — add the same import. Insert the Success haptic immediately before the success line (`setSubmitted(true);`, line 48), and the Error haptic in the sibling `if (error)` branch.

- [ ] **Step 7: Booking inquiry — success/error notification haptics**

`destination/[slug]/inquire.tsx`'s `onSubmit` — add the same import. Insert the Success haptic immediately before the success line (`setSubmitted(true);`, line 78), and the Error haptic in the sibling `if (error)` branch.

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/package.json apps/mobile/pnpm-lock.yaml apps/mobile/src/components/ui/mini-player.tsx apps/mobile/src/components/now-playing-overlay.tsx apps/mobile/src/app/\(app\)/series/\[id\].tsx apps/mobile/src/app/\(app\)/learn/join-class.tsx apps/mobile/src/app/\(app\)/learn/teacher-request.tsx apps/mobile/src/app/\(app\)/destination/\[slug\]/inquire.tsx
git commit -m "Prompt 13: add haptics on play/pause, favorite, bookmark, and form submissions"
```

---

### Task 13: Accessibility — auth screens

**Files:**

- Modify: `apps/mobile/src/app/(auth)/welcome.tsx:21,27,31`
- Modify: `apps/mobile/src/app/(auth)/sign-in.tsx:73,83,87`
- Modify: `apps/mobile/src/app/(auth)/phone-sign-in.tsx:57,91`
- Modify: `apps/mobile/src/app/(auth)/otp-verify.tsx:104,114`
- Modify: `apps/mobile/src/app/(auth)/reset-password.tsx:86`
- Modify: `apps/mobile/src/app/(auth)/forgot-password.tsx:73`
- Modify: `apps/mobile/src/app/(auth)/sign-up.tsx:105`

**Interfaces:** None — prop additions only.

Every entry below adds `accessibilityRole="button"` and the given
`accessibilityLabel` to the `Pressable` at that line. None of these
currently have `hitSlop`; add `hitSlop={Spacing.two}` (importing
`Spacing` from `@/constants/theme` in any file that doesn't already)
alongside the accessibility props, matching this codebase's one
already-compliant file (`back-button.tsx`).

- [ ] **Step 1: `welcome.tsx`**

| Line | `accessibilityLabel`  |
| ---- | --------------------- |
| 21   | `"Sign In"`           |
| 27   | `"Create Account"`    |
| 31   | `"Continue as Guest"` |

- [ ] **Step 2: `sign-in.tsx`**

| Line | `accessibilityLabel`           |
| ---- | ------------------------------ |
| 73   | `"Sign In"`                    |
| 83   | `"Sign in with phone instead"` |
| 87   | `"Forgot Password"`            |

- [ ] **Step 3: `phone-sign-in.tsx`**

| Line | `accessibilityLabel`                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------- |
| 57   | `` `Select ${country.name}` `` (inside the `COUNTRY_CODES.map` loop — use the loop's `country.name`) |
| 91   | `"Send Code"`                                                                                        |

- [ ] **Step 4: `otp-verify.tsx`**

| Line | `accessibilityLabel`                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 104  | `"Verify"`                                                                                                                          |
| 114  | `"Resend code"` (this one is conditionally `disabled` during cooldown — also add `accessibilityState={{ disabled: cooldown > 0 }}`) |

- [ ] **Step 5: `reset-password.tsx`, `forgot-password.tsx`, `sign-up.tsx`**

| File:Line                | `accessibilityLabel` |
| ------------------------ | -------------------- |
| `reset-password.tsx:86`  | `"Reset Password"`   |
| `forgot-password.tsx:73` | `"Send Reset Email"` |
| `sign-up.tsx:105`        | `"Create Account"`   |

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/app/\(auth\)/
git commit -m "Prompt 13: add accessibility labels and touch targets to auth screens"
```

---

### Task 14: Accessibility — app screens (tabs/library, learn, and other detail screens)

**Files:**

- Modify: `apps/mobile/src/app/(app)/(tabs)/library.tsx:68,111,118,127`
- Modify: `apps/mobile/src/app/(app)/learn/teacher/index.tsx:70`
- Modify: `apps/mobile/src/app/(app)/settings.tsx:60`
- Modify: `apps/mobile/src/app/(app)/coins.tsx:151`
- Modify: `apps/mobile/src/app/(app)/series/[id].tsx:117,122`
- Modify: `apps/mobile/src/app/(app)/destination/[slug].tsx:71`
- Modify: `apps/mobile/src/app/(app)/destination/[slug]/inquire.tsx:147`
- Modify: `apps/mobile/src/app/(app)/contributor/[id].tsx:63`

**Interfaces:** None — prop additions only.

Same treatment as Task 13: `accessibilityRole="button"` +
`accessibilityLabel` + `hitSlop={Spacing.two}` at each line (none of
these have `hitSlop` today either).

- [ ] **Step 1: `library.tsx`**

| Line | `accessibilityLabel`          |
| ---- | ----------------------------- |
| 68   | `"Open saved bookmark"`       |
| 111  | `"Delete downloaded episode"` |
| 118  | `"Retry download"`            |
| 127  | `"Cancel download"`           |

- [ ] **Step 2: `learn/teacher/index.tsx`**

| Line | `accessibilityLabel`                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 70   | `` `Open class ${classItem.name}` `` (`classItem` is the row's own loop variable, confirmed against the file: `query.data.map((classItem) => (...))`) |

- [ ] **Step 3: `settings.tsx`, `coins.tsx`**

| File:Line         | `accessibilityLabel`                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `settings.tsx:60` | `` `Select ${country.name}` `` (already `country.name` is in scope inside the map loop, per Prompt 12's country-picker addition) |
| `coins.tsx:151`   | `"Restore Purchases"`                                                                                                            |

- [ ] **Step 4: `series/[id].tsx`**

| Line | `accessibilityLabel`                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 117  | `isFavorited ? "Remove from favorites" : "Add to favorites"` (dynamic — matches the existing conditional label text already rendered there) |
| 122  | `"Download entire series"`                                                                                                                  |

- [ ] **Step 5: `destination/[slug].tsx`, `destination/[slug]/inquire.tsx`**

| File:Line                            | `accessibilityLabel`            |
| ------------------------------------ | ------------------------------- |
| `destination/[slug].tsx:71`          | `"Play video"`                  |
| `destination/[slug]/inquire.tsx:147` | `"Select preferred visit date"` |

- [ ] **Step 6: `contributor/[id].tsx`**

| Line | `accessibilityLabel`                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 63   | `` `Open series ${episode.seriesTitle}` `` (`episode` is the row's own loop variable, confirmed against the file: `contributor.episodes.map((episode) => (...))`, which renders `episode.seriesTitle` two lines below the `Pressable`) |

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/app/\(app\)/\(tabs\)/library.tsx apps/mobile/src/app/\(app\)/learn/teacher/index.tsx apps/mobile/src/app/\(app\)/settings.tsx apps/mobile/src/app/\(app\)/coins.tsx apps/mobile/src/app/\(app\)/series/\[id\].tsx apps/mobile/src/app/\(app\)/destination/\[slug\].tsx apps/mobile/src/app/\(app\)/destination/\[slug\]/inquire.tsx apps/mobile/src/app/\(app\)/contributor/\[id\].tsx
git commit -m "Prompt 13: add accessibility labels and touch targets to app screens"
```

---

### Task 15: Accessibility — shared general UI components (+ dead-code deletion)

**Files:**

- Modify: `apps/mobile/src/components/video-modal.tsx:27`
- Modify: `apps/mobile/src/components/sign-in-prompt-sheet.tsx:20,26,31`
- Modify: `apps/mobile/src/components/ui/series-card.tsx:23`
- Modify: `apps/mobile/src/components/ui/button.tsx:23`
- Modify: `apps/mobile/src/components/ui/section-header.tsx:22`
- Modify: `apps/mobile/src/components/ui/episode-row.tsx:62,84`
- Modify: `apps/mobile/src/components/ui/chip.tsx:21`
- Modify: `apps/mobile/src/components/ui/destination-card.tsx:21`
- Delete: `apps/mobile/src/components/ui/collapsible.tsx`

**Interfaces:** None — prop additions only, plus one dead-code deletion.

`ui/button.tsx` is the highest-leverage file here: it's the shared
primitive nearly every screen's primary/secondary/ghost actions route
through. Fixing it here retrofits accessibility onto every one of its
call sites for free, without touching each of them individually.

- [ ] **Step 1: `ui/button.tsx` — accept and default an accessibility label**

At line 23, add `accessibilityRole="button"` and
`accessibilityLabel={accessibilityLabel ?? label}` where `label` is
the button's existing visible-text prop and `accessibilityLabel` is a
new optional prop on `Button`'s props type (so a call site can override
it when the visible label alone doesn't fully describe the action;
none need to for now).

- [ ] **Step 2: `video-modal.tsx`, `sign-in-prompt-sheet.tsx`**

| File:Line                     | `accessibilityLabel` |
| ----------------------------- | -------------------- |
| `video-modal.tsx:27`          | `"Close video"`      |
| `sign-in-prompt-sheet.tsx:20` | `"Dismiss"`          |
| `sign-in-prompt-sheet.tsx:26` | `"Sign In"`          |
| `sign-in-prompt-sheet.tsx:31` | `"Create Account"`   |

Add `accessibilityRole="button"` + the label + `hitSlop={Spacing.two}` to each (importing `Spacing` where not already imported).

- [ ] **Step 3: `series-card.tsx`, `destination-card.tsx`**

These are generic reusable cards navigated via a `title`/`name` prop
already passed by every call site — add `accessibilityRole="button"`
and `accessibilityLabel={title}` (`series-card.tsx:23`) /
`accessibilityLabel={name}` (`destination-card.tsx:21`), reusing the
existing prop rather than adding a new one.

- [ ] **Step 4: `section-header.tsx`**

Line 22's optional action link (e.g. "Delete All", also reused by Task 5's "Clear" recent-searches action) — add `accessibilityRole="button"` and `accessibilityLabel={actionLabel}` (reusing the existing `actionLabel` prop text).

- [ ] **Step 5: `episode-row.tsx`**

| Line | Change                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 62   | Add `accessibilityRole="button"` and `accessibilityLabel={\`Play ${title}\`}`(reusing the row's existing`title` prop)                                                                      |
| 84   | Standardize the existing raw `hitSlop={8}` to `hitSlop={Spacing.two}` (importing `Spacing` if not already), and add `accessibilityRole="button"` + `accessibilityLabel="Download episode"` |

- [ ] **Step 6: `chip.tsx`**

Line 21 — add `accessibilityRole="button"` and `accessibilityLabel={label}` (reusing the chip's existing `label` prop) and `accessibilityState={{ selected }}` (reusing the existing `selected` prop, since a chip's selected/unselected state is exactly what `accessibilityState.selected` communicates).

- [ ] **Step 7: Delete confirmed-dead `collapsible.tsx`**

Confirmed unreferenced anywhere in the app during planning (a leftover
Expo Router starter-template component). Re-confirm before deleting:

```bash
grep -rn "Collapsible" apps/mobile/src --include="*.tsx" --include="*.ts" | grep -v "components/ui/collapsible.tsx"
```

Expected: no output. Then:

```bash
git rm apps/mobile/src/components/ui/collapsible.tsx
```

- [ ] **Step 8: Typecheck and lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: 0 errors on both.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/components/video-modal.tsx apps/mobile/src/components/sign-in-prompt-sheet.tsx apps/mobile/src/components/ui/series-card.tsx apps/mobile/src/components/ui/button.tsx apps/mobile/src/components/ui/section-header.tsx apps/mobile/src/components/ui/episode-row.tsx apps/mobile/src/components/ui/chip.tsx apps/mobile/src/components/ui/destination-card.tsx
git commit -m "Prompt 13: add accessibility labels to shared UI components, remove dead Collapsible"
```

(The `collapsible.tsx` deletion in Step 7 is already staged via `git rm`; it's included in this same commit.)

---

### Task 16: Accessibility — player-related components

**Files:**

- Modify: `apps/mobile/src/components/now-playing-overlay.tsx:158,204,209,214,219,224,243,248`
- Modify: `apps/mobile/src/components/unlock-sheet.tsx:79`
- Modify: `apps/mobile/src/components/bookmark-sheet.tsx:30`
- Modify: `apps/mobile/src/components/ui/mini-player.tsx:53,60`

**Interfaces:** None — prop additions only. (`now-playing-overlay.tsx:214` and `mini-player.tsx:70` already gained their `onPress` haptic wrapping in Task 12; this task adds accessibility props to those same two `Pressable`s in addition, plus all the sibling player controls Task 12 didn't touch.)

- [ ] **Step 1: `now-playing-overlay.tsx`**

| Line | `accessibilityLabel`                                                             |
| ---- | -------------------------------------------------------------------------------- |
| 158  | `"Collapse player"`                                                              |
| 204  | `"Previous track"`                                                               |
| 209  | `"Seek back 15 seconds"`                                                         |
| 214  | `status.playing ? "Pause" : "Play"` (dynamic, matches the icon it already swaps) |
| 219  | `"Seek forward 15 seconds"`                                                      |
| 224  | `"Next track"`                                                                   |
| 243  | `"Open bookmark"`                                                                |
| 248  | `"Sleep timer"`                                                                  |

Add `accessibilityRole="button"` + the label to each; none of these have `hitSlop` today — add `hitSlop={Spacing.two}` to each as well (already imported in this file).

- [ ] **Step 2: `unlock-sheet.tsx`, `bookmark-sheet.tsx`**

| File:Line               | `accessibilityLabel` |
| ----------------------- | -------------------- |
| `unlock-sheet.tsx:79`   | `"Dismiss"`          |
| `bookmark-sheet.tsx:30` | `"Dismiss"`          |

Add `accessibilityRole="button"` + the label + `hitSlop={Spacing.two}` to each (importing `Spacing` if not already imported in either file).

- [ ] **Step 3: `mini-player.tsx`**

| Line | `accessibilityLabel`                                                          |
| ---- | ----------------------------------------------------------------------------- |
| 53   | `"Expand player"` (the outer `Pressable` wrapping the whole mini-player card) |
| 60   | `"Seek"`                                                                      |

Add `accessibilityRole="button"` + the label + `hitSlop={Spacing.two}` to each (already imported in this file; line 70's play/pause `Pressable` already has `hitSlop={Spacing.two}` from before this plan — just add its accessibility props here, `accessibilityLabel` matching the same dynamic Play/Pause text as `now-playing-overlay.tsx:214` above).

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/now-playing-overlay.tsx apps/mobile/src/components/unlock-sheet.tsx apps/mobile/src/components/bookmark-sheet.tsx apps/mobile/src/components/ui/mini-player.tsx
git commit -m "Prompt 13: add accessibility labels and touch targets to player components"
```

---

### Task 17: App icon / splash — dead-asset cleanup

**Files:**

- Delete: `apps/mobile/src/components/web-badge.tsx`
- Delete: `apps/mobile/assets/images/react-logo.png`
- Delete: `apps/mobile/assets/images/react-logo@2x.png`
- Delete: `apps/mobile/assets/images/react-logo@3x.png`
- Delete: `apps/mobile/assets/images/tutorial-web.png`
- Delete: `apps/mobile/assets/images/expo-badge.png`
- Delete: `apps/mobile/assets/images/expo-badge-white.png`
- Delete: `apps/mobile/assets/images/logo-glow.png`
- Modify: `apps/mobile/src/components/animated-icon.tsx`
- Modify: `apps/mobile/src/components/animated-icon.web.tsx`

**Interfaces:** None — `AnimatedSplashOverlay`'s existing signature and behavior are unchanged; only the unused sibling `AnimatedIcon` export is removed from the same two files.

`animated-icon.tsx`/`.web.tsx` themselves are **not** deleted —
`AnimatedSplashOverlay` is live production code (the app's actual
native-splash-to-app transition, imported by
`apps/mobile/src/app/_layout.tsx`). Only `web-badge.tsx` (a "Made with
Expo" version badge, confirmed unreferenced anywhere) and the two
files' dead `AnimatedIcon` export (confirmed unreferenced anywhere,
in either file variant) are removed.

- [ ] **Step 1: Re-confirm before deleting anything**

```bash
grep -rn "web-badge\|WebBadge" apps/mobile/src --include="*.tsx" --include="*.ts"
grep -rn "AnimatedIcon\b" apps/mobile/src --include="*.tsx" --include="*.ts" | grep -v "components/animated-icon"
grep -rn "react-logo\|tutorial-web\|expo-badge\|logo-glow" apps/mobile --include="*.tsx" --include="*.ts" --include="*.json"
```

Expected: the first command shows only `web-badge.tsx`'s own
definition; the second shows nothing; the third shows nothing (all
four filename patterns unreferenced). If anything unexpected shows up,
stop and re-investigate rather than deleting.

- [ ] **Step 2: Delete `web-badge.tsx` and its two exclusive images**

```bash
git rm apps/mobile/src/components/web-badge.tsx
git rm apps/mobile/assets/images/expo-badge.png apps/mobile/assets/images/expo-badge-white.png
```

- [ ] **Step 3: Delete the unreferenced starter-template images**

```bash
git rm apps/mobile/assets/images/react-logo.png apps/mobile/assets/images/react-logo@2x.png apps/mobile/assets/images/react-logo@3x.png apps/mobile/assets/images/tutorial-web.png
```

- [ ] **Step 4: Remove the dead `AnimatedIcon` export from `animated-icon.tsx`**

Delete the `AnimatedIcon` function (the second exported function in
the file, after `AnimatedSplashOverlay`) and the three keyframes used
only by it (`keyframe`, `logoKeyframe`, `glowKeyframe` — **not**
`splashKeyframe`, which `AnimatedSplashOverlay` uses). In the
`styles` object, remove `imageContainer`, `glow`, `iconContainer`, and
`background` (used only by the deleted function) — keep `image` (used
by both) and `splashOverlay` (used by `AnimatedSplashOverlay`). Also
remove the now-unused `INITIAL_SCALE_FACTOR` constant and the
`Dimensions` import if nothing else in the file uses them (confirm
before removing).

- [ ] **Step 5: Same removal in `animated-icon.web.tsx`**

Same shape: delete the file's own `AnimatedIcon` function and the
keyframes/styles used only by it, keeping `AnimatedSplashOverlay`
(which in this `.web.tsx` variant is a no-op returning `null`, per its
existing content) untouched.

- [ ] **Step 6: Delete `logo-glow.png`**

```bash
git rm apps/mobile/assets/images/logo-glow.png
```

- [ ] **Step 7: Typecheck, lint, and confirm the app still builds/typechecks with the splash overlay intact**

```bash
pnpm typecheck
pnpm lint
```

Expected: 0 errors on both — in particular, no "cannot find module" error for any of the deleted images from `animated-icon.tsx`/`.web.tsx`, confirming `AnimatedSplashOverlay`'s own `expo-logo.png` reference is untouched.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/components/animated-icon.tsx apps/mobile/src/components/animated-icon.web.tsx
git commit -m "Prompt 13: remove unused Expo starter-template assets and dead AnimatedIcon export"
```

---

## Final verification (whole-branch, after all 17 tasks)

- [ ] Run `pnpm typecheck` and `pnpm lint` from the repo root — both clean.
- [ ] Run `cd apps/mobile && npx jest` — all existing suites still pass (this plan adds no new automated tests, per the Global Constraints, but must not break any existing ones).
- [ ] Confirm Task 1's `enable_seqscan=off` verification output was captured and is genuinely an index scan, not a residual sequential scan.
- [ ] Confirm Task 8's manual device-verification step was either performed or explicitly recorded as deferred (no device available) — not silently skipped.
