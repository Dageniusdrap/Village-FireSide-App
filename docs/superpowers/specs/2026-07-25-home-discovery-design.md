# Home & Discovery (Prompt 7) — Design Spec

## Scope

Build the mobile app's Home tab with real Supabase data, plus three
drill-down detail screens, per `docs/PROMPT_PACK.md`'s Prompt 7:

- Home tab (`(app)/(tabs)/index.tsx`), rebuilt from Prompt 6's mock-data
  scaffold into 6 real-data, horizontally-scrollable sections
- Series detail screen (new)
- Contributor profile screen (new)
- Cultural Group detail screen (new — implied by the Home pack text's
  "Peoples & Kingdoms" rail linking to "a group screen")
- Favorite toggle, gated for guest-mode users via Prompt 5's
  `useRequireAuth`/`SignInPromptSheet` (built inert, adopted here for
  the first time)
- A small migration adding `series.is_featured`
- TanStack Query as the data-fetching layer (new dependency), with
  loading skeletons, pull-to-refresh, and empty states throughout

**Non-goals (explicitly out of scope for this prompt):**

- The per-country `app_settings`-driven visibility toggle for cultural
  groups — `app_settings` doesn't exist until Prompt 9. The "Peoples &
  Kingdoms" rail shows every published `cultural_groups` row regardless
  of country. `docs/schema.md`'s existing note on this (from Prompt 3B)
  already documents the deferral; this prompt doesn't change that note,
  just implements the "show everything" interim behavior it anticipated.
- Real audio playback — tapping a free episode or "Play All" calls the
  existing (Prompt 6) `usePlayerStore.play()` stub, which updates state
  and makes the `MiniPlayer` visible for the first time in this app's
  history, but produces no sound. Prompt 8 replaces the stub's internals.
- Coins/premium purchase flow — locked episodes show a price or
  "Premium" badge only; tapping one does nothing yet (no Unlock Sheet).
  Prompt 9's job.
- Explore, Learn, Library tabs — untouched, still on Prompt 6's mock
  data. Their real-data wiring is Prompts 11, 12, 10 respectively.
- Destination detail screen — a series's `destination_id` link renders
  as disabled/inert (no screen exists yet); Prompt 11 builds it.
- Offline downloads, search, notifications.

## Database change

`series` gets one new column:

```sql
alter table series add column is_featured boolean not null default false;
```

Single-file migration, non-idempotent, applied by hand to the real
project (matching every prior prompt's convention — no Docker, no
Supabase CLI in this environment). `docs/schema.md`'s `series` table
section gets this column added to its existing row list.

## New dependency: TanStack Query

`@tanstack/react-query` — a `QueryClientProvider` wraps the app in
`apps/mobile/src/app/_layout.tsx`, alongside the existing auth-listener/
font-loading providers. Query hooks live in a new
`apps/mobile/src/hooks/queries/` directory, one hook per data need, each
a thin wrapper around a direct `supabase.from(...)`/`.select(...)` call
— no repository or service-layer abstraction, consistent with how
`apps/mobile/src/lib/supabase.ts` is used everywhere else in this
codebase.

Hooks needed: `useFeaturedSeries()`, `useElderVoicesSeries()`,
`useContinueListening()`, `useCategoryRail(category: string)`,
`useCulturalGroups()`, `useStorytellers()`, `useSeriesDetail(id: string)`,
`useContributorDetail(id: string)`, `useCulturalGroupDetail(id: string)`,
`useToggleFavorite()`.

All Home-section query keys share a `["home", ...]` prefix so pull-to-
refresh can invalidate them together via one
`queryClient.invalidateQueries({ queryKey: ["home"] })` call.

## Content types

`apps/mobile/src/types/content.ts` (Prompt 6, currently hand-written
schema-shaped types for mock data) gains `CulturalGroup` and
`PublicContributor` types, matching `cultural_groups` and
`public_contributors`' real columns. The existing `Episode`/`Series`/
`Destination` types are reused as query result shapes — no restructuring
needed, since Prompt 6 deliberately mirrored the real schema for exactly
this handoff.

`apps/mobile/src/mocks/content.ts`'s `mockEpisodes` and `mockSeries` are
deleted (Home no longer uses them). `mockDestinations` stays — Explore
is out of scope for this prompt (see Non-goals) and keeps using it
unchanged until Prompt 11.

## Home screen (`(app)/(tabs)/index.tsx`)

Six sections, in the prompt's stated order, each independently loading/
refreshable/empty-stateable:

1. **Hero** — `useFeaturedSeries()` (`series.is_featured = true`),
   larger `SeriesCard`-style presentation.
2. **Voices of Our Elders** — `useElderVoicesSeries()`
   (`series.category = 'elder_history'`), visually distinct via
   `theme.gold` accent (Prompt 6's palette).
3. **Continue Listening** — `useContinueListening()` (joins
   `listening_progress` → `episodes`, current user only via RLS, most
   recent first), rendered as `EpisodeRow`s. Empty for guests/new users
   — friendly copy, not an error.
4. **Category rails** — one `useCategoryRail(category)` call per
   `lakes`, `forests`, `wildlife`, `hidden_africa`, `children` (the
   `series.category` example values from `docs/schema.md`), each its
   own `SectionHeader` + horizontal `SeriesCard` row.
5. **Peoples & Kingdoms** — `useCulturalGroups()` (all published, no
   country filter — see Non-goals), card per group (cover + name),
   tapping navigates to the Cultural Group detail screen.
6. **Meet the Storytellers** — `useStorytellers()` (from
   `public_contributors`), card per contributor (photo, `display_name`,
   `district`), tapping navigates to Contributor profile.

Pull-to-refresh via `RefreshControl` on the outer `ScrollView`,
invalidating the shared `["home"]` query-key prefix.

## Detail screens

Navigation: `(app)/_layout.tsx` changes from a bare `<Slot />` wrapper
into a `<Stack>` containing the `(tabs)` group as one screen plus the
three new detail screens as siblings — standard Expo Router pattern for
"tab shell with drill-down screens that cover the tab bar." Back
navigation returns to Home. `MiniPlayer` stays rendered as a `<Stack>`-
level sibling overlay (unchanged from Prompt 6's positioning approach,
just now overlaying a `<Stack>` instead of a `<Slot>`).

**Series detail** (`apps/mobile/src/app/(app)/series/[id].tsx`):
`useSeriesDetail(id)` — cover, title, description, category, destination
link (disabled/inert — see Non-goals). Episode list via `EpisodeRow`:
free episodes tappable → `usePlayerStore.play(episode)`; locked episodes
(`accessTier !== "free"`) show coin price or a "Premium" badge, not
tappable. "Play All / Resume" button always calls `play(...)` directly,
with no `useRequireAuth` gate — it's not a gated action, it's a
degraded-for-guests one: the resume-position lookup (part of
`useSeriesDetail`'s own data, not a separate gate) simply finds no
`listening_progress` row for a guest (no `user_id` to query against),
so the button falls back to starting from episode 1. A signed-in user
with a saved position gets "Resume at 12:34" label text instead of
"Play All." Favorite toggle: heart icon,
`requireAuth(() => toggleFavorite({ seriesId: id }))` — this one IS a
true gated action (favoriting has no sensible degraded-for-guests
behavior), unlike Play All.

**Contributor profile**
(`apps/mobile/src/app/(app)/contributor/[id].tsx`): `useContributorDetail(id)`
reads exclusively through `public_contributors` (never the base
`contributors` table), so `is_anonymous` masking is enforced at the
query level, not just in the UI — a contributor with `is_anonymous`
already has no `photo_url`/`bio`/`district`/`country` in that view's
result at all, so the screen doesn't need its own masking logic. Photo
(if present), `display_name`, `bio`, `district`/`country`. Episode list
via `episode_contributors`, each row navigable to that episode's parent
series (not a per-episode screen — episodes aren't independently
routable, only reachable through their series).

**Cultural Group detail**
(`apps/mobile/src/app/(app)/cultural-group/[id].tsx`):
`useCulturalGroupDetail(id)` — cover, name, description, country/region.
Linked series (via `series_cultural_groups`) as a `SeriesCard` grid.
Linked contributors (via `contributor_cultural_groups` joined through
to `public_contributors`) as contributor cards, same shape as the Home
"Meet the Storytellers" section's cards.

All three detail screens: loading skeleton while fetching; a "not
found" empty state if the row doesn't exist or isn't published (RLS
already hides unpublished rows from the query, so this state also
covers "row is unpublished," not just "row doesn't exist" — the two
are indistinguishable from the client's perspective, which is correct:
an unpublished cultural group should look exactly like a nonexistent
one to a non-admin visitor, never leak a "found but hidden" signal).

## Design system additions

- **`Skeleton`** (`apps/mobile/src/components/ui/skeleton.tsx`) — a
  shimmering placeholder block (fixed width/height props), used
  wherever a section/screen is in its `isLoading` state.
- **`EmptyState`** (`apps/mobile/src/components/ui/empty-state.tsx`) —
  `title` + `body` text, no icon/illustration (keeping scope
  reasonable), reused across every empty/no-results/not-found case
  listed above.

## Favorites

`useToggleFavorite()`: a TanStack Query mutation that upserts or deletes
a `favorites` row. Exactly one of `episode_id`/`series_id`/
`destination_id` is set per call (matching the schema's CHECK
constraint) — the hook takes a discriminated-union argument
(`{ episodeId: string } | { seriesId: string } | { destinationId: string }`)
so a caller can't accidentally set more than one. Optimistic update:
the heart icon flips immediately on tap, rolling back if the mutation
errors. Every call site wraps the toggle in `requireAuth(...)` — guests
see `SignInPromptSheet` instead of the mutation running.

## Testing

Following this codebase's established precedent: query hooks and
screens are not unit-tested (no live Supabase project, no device
runtime in this environment) — verified by `pnpm typecheck` +
`pnpm lint`. Any new pure logic gets a real Jest unit test, mirroring
Prompt 6's `SourceBadge` pattern:

- The favorite-target discriminated-union → `{episode_id, series_id,
destination_id}` row-shape resolution logic (pure function, easy to
  get wrong, easy to test exhaustively).
- Any duration/resume-position formatting helper introduced for
  "Continue Listening"/"Play All. Resume at 12:34" copy, if one turns
  out to be needed beyond what Prompt 6's `EpisodeRow` already has.

## Docs

`docs/schema.md`'s `series` table section gets the new `is_featured`
column added to its existing row list. No other doc changes required —
this prompt doesn't touch RLS, add tables, or change any policy.
