# Search, Notifications & Polish (Prompt 13) — Design Spec

## Scope

Per `docs/PROMPT_PACK.md`'s Prompt 13 — three areas, built as one spec
and one plan (matching Prompt 12's precedent: this project treats one
`PROMPT_PACK.md` prompt as one design/plan/implementation unit, even
when it spans multiple subsystems):

- **Global search** across series titles, episode titles, destinations,
  and public contributor display names, via Postgres full-text search.
  Recent searches stored locally; results grouped by type.
- **Push notification infrastructure**: permission request (deferred
  until the user finishes their first episode), Expo push token
  storage, and client-side registration/deep-link handling.
- **Polish pass**: share buttons, error/retry states plus one top-level
  error boundary, haptics on key actions, an accessibility retrofit
  across the whole app, and an app-icon/splash asset cleanup.

**Non-goals (explicitly deferred):**

- **The push-notification send trigger.** Prompt 13's own spec text
  attributes sending to "an admin dashboard action (Prompt 15) via
  edge function." Prompt 15 (`apps/admin`'s content-management
  dashboard) does not exist yet — confirmed: `apps/admin/src` today has
  only auth scaffolding and the `teacher-requests` route built out of
  numeric order as part of Prompt 12. This prompt builds `push_tokens` and
  populates it; nothing sends to it until Prompt 15 exists. This is a
  forward dependency per `docs/PROMPT_PACK.md`'s own dependency-check
  rule, not a gap in this prompt.
- **Universal/HTTPS share links.** See "Share buttons" below — building
  these needs a real hosted domain, which doesn't exist in this
  project yet. Documented as a known gap, not silently shipped as if
  it worked for non-users.
- **A settings toggle to re-enable notifications after a Deny.** iOS
  only shows the native permission prompt once per install; there is
  no in-app "ask again" flow in this design (see "Push notifications"
  below). A user who denies must go to system Settings themselves.

## New dependencies

- **`expo-haptics`** — added as a justified exception to the "no new
  npm dependencies" norm this project established in Prompt 12: there
  is no dependency-free equivalent, and it's the standard Expo SDK
  package for this.
- **`expo-updates`** — also not currently installed; also a justified
  exception, needed specifically so the error boundary's "Restart"
  action (see "Error/retry states" below) can call
  `Updates.reloadAsync()` for a real full-JS-context reload. Without
  it, the only reload mechanism available is React Native's
  `DevSettings.reload()`, which is dev/debug-build only and does
  nothing in a production release build — not viable for a
  production error-recovery path.
- **No `expo-sharing`.** React Native's core `Share.share()` API needs
  no new package and is sufficient for a text/URL share sheet.
- **No new search or notification library.** `expo-notifications` is
  already a dependency (`apps/mobile/package.json`); full-text search
  is pure Postgres (`tsvector`/`to_tsvector`/GIN), no client library.

## Data layer

### New migration(s)

Following this schema's existing tables-then-indexes-then-RLS split.

**Search — generated `tsvector` columns + GIN indexes**, on the three
tables that hold their own searchable text directly:

```sql
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
```

Title/name is weighted `'A'` (highest), description `'B'`, so a match
in the title ranks above a match only in the description via
`ts_rank`.

**Contributors** are searched through the existing `public_contributors`
view (`supabase/migrations/20260721160300_public_contributors_view.sql`),
which already filters by consent (`is_anonymous`) and by "has at least
one published episode." The `tsvector` column goes on the base
`contributors` table (so it can be a real generated+indexed column),
and the view is extended to expose it:

```sql
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

`create or replace view` is valid here because the change only appends
a column to the end of the `select` list — Postgres rejects `replace`
only when it would remove or reorder existing output columns.

**Documented decision, not an assumption to re-derive later:** search
inherits the existing consent/anonymity filter automatically, because
it queries `public_contributors` (the view) and never the base
`contributors` table directly. The view's own `case when is_anonymous`
masking and its published-episode `exists (...)` gate apply to every
search result exactly as they do to every other consumer of this view
today. No new consent logic exists or is needed for search.

**Verification task (goes into the implementation plan as an explicit
step, not left to be assumed):** after this migration is applied, run
`EXPLAIN` (not `ANALYZE`, and with `enable_seqscan` forced off) on a
representative search query against `public_contributors` and confirm
the plan references `contributors_search_vector_idx`. **This needs the
non-obvious `enable_seqscan` step, checked live, not assumed:** this
project's content tables are currently empty (confirmed:
`contributors`/`series`/`episodes`/`destinations` all 0 rows on the
live project). Postgres's planner costs a sequential scan as cheaper
than an index scan on a table with few or zero rows regardless of
whether a usable index exists — so a plain `explain analyze` here
would show `Seq Scan` (or a zero-row `Result`) even with a perfectly
working index, for a reason that has nothing to do with whether
pushdown through the view actually reaches the indexed expression.
The real question — can this predicate structurally use the index at
all — is answered by forcing the planner's hand:

```sql
set local enable_seqscan = off;
explain select * from public_contributors
where search_vector @@ websearch_to_tsquery('english', 'test');
```

If the plan still shows a sequential scan even with `enable_seqscan`
off, that's a real finding (the pushdown genuinely isn't reaching the
indexed column — the exact risk this check exists to catch, per the
`where exists` subquery reasoning below). If it shows an `Index Scan`/
`Bitmap Index Scan` on `contributors_search_vector_idx`, pushdown
works structurally, and the planner's own preference for a sequential
scan at low row counts becomes irrelevant to production behavior once
real content exists. Report the actual plan output either way — a
view with a `where exists` subquery is exactly the shape where
predicate pushdown could plausibly fail to reach the indexed
expression, so this needs a real check, not an assumption that
indexing "the underlying table" is automatically sufficient.

### `push_tokens`

```sql
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

One combined `for all` (select/insert/update/delete) owner-only policy
— unlike Prompt 12's `class_members`, there's no second actor here
needing a different rule (no admin/service-role read policy yet;
Prompt 15's sender adds its own access when it exists), so a single
policy is the simpler, equally correct choice.

`unique (user_id, expo_push_token)` makes re-registering the same
device idempotent via `upsert` (`on_conflict`), rather than
accumulating duplicate rows across every cold start.

### Type/hook changes

None to existing shared types. Search and push tokens are additive,
new query hooks — no existing `Episode`/`Series`/`Destination` type
needs a new field.

## RLS summary

| Table         | Policy | Rule                                                                                                                                                   |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `push_tokens` | all    | `user_id = auth.uid()` — owner-only, no other actor yet                                                                                                |
| _(search)_    | —      | no new RLS; relies entirely on `series`/`episodes`/`destinations`' existing published-only policies and `public_contributors`' existing consent filter |

## Global search

- **Entry point:** a new shared `TabHeader` component
  (`apps/mobile/src/components/ui/tab-header.tsx`) — a title slot plus
  a magnifier icon — added to the top of each tab screen's existing
  scroll view. `(tabs)/_layout.tsx`'s `headerShown: false` is
  unchanged; this follows the existing "each screen builds its own top
  content" convention rather than reversing that choice.
- **Search screen** (`apps/mobile/src/app/(app)/search.tsx`, pushed
  from the magnifier icon): a text input, debounced 300ms, and result
  sections grouped by type (Series, Episodes, Destinations,
  Contributors), each capped (e.g. top 5) with a "see all N" affordance
  deferred as out of scope (YAGNI — no screen exists yet that lists
  all-of-one-type search results; add it if real usage shows the cap
  is too tight). Tapping a result navigates via that type's existing
  detail route (`/episode/[id]`'s deep-link resolver,
  `/destination/[slug]`, etc. — no new navigation targets).
- **Query hook:** `useGlobalSearch(query: string)`
  (`apps/mobile/src/hooks/queries/use-global-search.ts`) — fires 4
  independent Supabase `.textSearch()` queries in parallel via
  `Promise.all` (one per type, each `limit(5)`), relying on each
  table's/view's existing RLS to filter correctly — no new privileged
  function, matching this codebase's established "hooks lean on RLS"
  convention (see e.g. `use-subject-episodes.ts`).
- **Query volume:** with the 300ms debounce, a typical search fires
  roughly 2-4 debounced requests per search session (most keystrokes
  during continuous typing collapse into one fire), each being 4
  parallel indexed queries with a small `limit`, sub-10ms Postgres-side
  and a few KB of JSON. Not a backend/free-tier load concern at this
  project's expected early scale. The more relevant angle given this
  app already treats mobile data as precious (the existing
  wifi-only-downloads setting) is client-side request count — but at a
  few KB per fire this is negligible next to an audio download, so no
  design change is made for this now. If profiling ever shows this
  needs collapsing to one round trip, the alternative considered and
  rejected here — a single `SECURITY DEFINER` search function unifying
  all 4 sources server-side — is the documented fallback.
- **Recent searches:** stored locally via a small file-based module,
  `apps/mobile/src/lib/search-history.ts`, mirroring the _actual_
  established local-persistence pattern in this codebase —
  `lib/settings.ts`'s `readSettings()`/`writeSettings()` pair
  (`expo-file-system`'s `File` API, a `try/catch` around `JSON.parse`
  falling back to an empty list on any corruption) — **not** zustand's
  `persist` middleware, which this codebase does not actually use
  anywhere (`settings-store.ts` calls `readSettings()` as its own
  initializer; `auth-store.ts` has no persistence of its own at all,
  relying on Supabase's own `secure-store-adapter.ts`;
  `download-queue-store.ts` isn't persist-middleware either). A plain
  Zustand store (`useSearchHistoryStore`) wraps this file-based
  module the same way `useSettingsStore` wraps `settings.ts`. Last ~10
  queries kept, shown when the search input is empty.

## Push notifications

- **Permission timing:** requested once, the first time any episode's
  listening progress reaches "finished" — checked against a local
  one-shot flag (same `search-history.ts`-style file-based module,
  a `hasPromptedForNotifications` boolean) so it fires exactly once
  regardless of how many episodes get finished afterward. Chosen over
  first-launch because it's a real signal of engagement rather than a
  guess, and over "ask on every relevant screen" because iOS's native
  prompt can only ever be shown once per install anyway (see below) —
  asking at the moment engagement is proven maximizes the chance of a
  real "Allow."
- **The iOS single-prompt constraint, stated explicitly:** iOS shows
  its native permission dialog exactly once per install; a Deny means
  no notifications for that user unless they manually re-enable
  notifications for the app via system Settings. This design has **no**
  in-app "ask again later" flow — there is no settings-screen toggle
  that re-triggers the native prompt (tapping such a toggle after a
  Deny would silently do nothing on iOS, which would be a worse UX
  than not having the toggle at all). This is a deliberate scope
  boundary for Prompt 13, not an oversight.
- **Registration:** on permission grant, call
  `Notifications.getExpoPushTokenAsync()` and upsert the result into
  `push_tokens` on `(user_id, expo_push_token)`. Also re-registers
  (upserts) on every cold app start when a session exists and
  permission is already granted, so a token rotation (reinstall,
  OS-level change) self-heals without user action. **This is a
  deliberate low-cost decision at current scale, not an unexamined
  default** — same reasoning as the search query-volume note above: an
  extra upsert call once per cold start, against a table keyed to make
  re-registration idempotent, is negligible load; if this project ever
  reaches a scale where that stops being true, the fix is to only
  re-register when the token actually changed (Expo does not push
  token-rotation events to the app directly, so this would need
  comparing against the last-known token locally), not to remove
  re-registration entirely.
- **Client-side handling:** a foreground listener
  (`Notifications.addNotificationReceivedListener`) and a tap listener
  (`addNotificationResponseReceivedListener`) that deep-link using the
  existing Prompt 11 episode deep-link resolver, so tapping a
  notification about a favorited series' new episode lands directly on
  that episode.

  **Teacher-assignment notifications also deep-link to `/episode/[id]`,
  not a class screen — this is a real cross-prompt dependency check,
  not a stylistic choice.** Prompt 12's final-review fix round
  confirmed no student-facing class screen was ever built (the
  `classes_member_select` RLS policy exists for one, but nothing
  consumes it — see that plan's ledger). The only class-detail screen
  that exists, `/learn/teacher/class/[id]`, is gated on
  `profile.role === 'teacher'` and would be the wrong destination for
  a student tapping this notification. Deep-linking straight to the
  assigned episode needs no new screen and matches how the favorited-series
  notification already works. If a student-facing class screen is ever
  built, this deep-link target should be revisited.

- **Explicitly out of scope:** the edge function and the admin-side
  trigger. See "Non-goals" above.

## Polish pass

### Share buttons

A `ShareButton` component (`apps/mobile/src/components/ui/share-button.tsx`)
building a `villagefireside://episode/{id}` (or `/series/{id}`,
`/destination/{id}`) URL via the existing deep-link scheme and passing
it to React Native's core `Share.share({ message })`.

**Correction found during planning, not assumed away:** the original
"episode/series/destination detail screens" framing assumed an episode
detail screen exists. It doesn't — `/episode/[id]` is a silent
deep-link-resolver redirect with no rendered UI at all, confirmed by
reading the file in full. Episode-level sharing instead goes on the
Now Playing overlay (`apps/mobile/src/components/now-playing-overlay.tsx`,
which already has an action row for the currently-playing episode —
bookmark, sleep-timer — the closest real analog to "viewing an
episode"), sharing whichever episode is currently loaded. Series and
destination sharing go on their actual detail screens
(`series/[id].tsx`'s existing actions row; `destination/[slug].tsx`,
after its "Plan Your Visit" button) as originally planned.

**Documented gap, not a silent assumption:** this only works for a
recipient who already has the app installed. `app.json` has no
`associatedDomains` (iOS) or `intentFilters` (Android) for HTTPS
universal links, and no hosted domain exists anywhere in this project's
configuration — confirmed by grepping the whole repo for any
`https://village...`/marketing-domain reference; none exists. For
anyone without the app, a shared `villagefireside://...` link is inert
text or a "no app found" error. Building real "works for anyone"
sharing needs a registered domain, hosted
`.well-known/apple-app-site-association` and `assetlinks.json` files,
and a landing/redirect page for non-users — infrastructure that goes
beyond a polish pass and isn't built here. Tracked as a `docs/known-issues.md`
entry (added alongside this prompt's implementation), likely to be
picked up alongside a future marketing-site effort.

### Error/retry states + error boundary

- `apps/mobile/src/components/ui/empty-state.tsx` gains an optional
  `onRetry?: () => void` prop — when present, renders a small "Try
  again" button calling it. Every screen's existing `query.isError`
  branch (currently reusing `EmptyState` with no retry affordance —
  see `learn/[subject].tsx`, `learn/teacher/index.tsx`) gets
  `onRetry={() => query.refetch()}` added; this is retrofitted across
  every data screen in the app, not just Prompt 13's new ones.
- One top-level React error boundary
  (`apps/mobile/src/components/error-boundary.tsx`, a class component
  — `componentDidCatch` requires it) wraps the `(app)` layout, catching
  render-time crashes `isError` can't reach (a bad data shape, a null
  deref). Shows a generic "Something went wrong" screen with a
  "Restart" button.
- **"Restart" mechanically means `Updates.reloadAsync()`** (a full
  JS-context reload from `expo-updates`), not a mere re-mount of the
  `(app)` component tree. This distinction matters and is deliberate:
  Zustand stores are module-level singletons that live outside React's
  tree, so remounting alone would not reset any of them — a genuine
  state-corruption bug would immediately re-crash. A full reload does
  reset all in-memory store state.
- **Corrupted-persisted-state risk, addressed by an existing
  convention, with one caveat stated rather than assumed away:** this
  codebase's real local-persistence pattern (`settings.ts`'s
  `readSettings()`, and `search-history.ts` above, following it)
  already wraps every read in `try/catch`, falling back to a safe
  default on any parse failure — so a reload is very unlikely to
  immediately repeat-crash from corrupted _persisted_ data, because
  the existing convention already absorbs that case. The one part of
  this not independently verified: Supabase's own session storage
  (`secure-store-adapter.ts`) is `supabase-js` internal, not one of
  this codebase's own guarded reads. Standard `supabase-js` behavior
  treats a malformed stored session as "no session" rather than
  throwing, but this has not been verified here against a real
  corrupted blob — stated as an assumption, not a confirmed guarantee.

### Haptics

`expo-haptics` added (see "New dependencies"). `Haptics.impactAsync(Light)`
on primary actions — episode play/pause, join-class submit, favorite
toggle, bookmark toggle — and `Haptics.notificationAsync(Success/Error)`
on submit outcomes (teacher request submitted, class joined, booking
inquiry sent). Scoped to actions that already show some confirmation
today, not a blanket "every button" pass. Called directly at each site
(no wrapper module) — there's no shared logic beyond the library call
itself, so a wrapper would be an unneeded layer.

**Documented note:** haptics is a graceful-degradation feature. Some
Android devices have weak or no haptic engines; `expo-haptics` no-ops
silently on hardware that can't comply. This is expected and
acceptable — not a bug requiring device-by-device testing before
shipping.

### Accessibility (repo-wide retrofit)

Every `Pressable`/`TouchableOpacity` across the app gets
`accessibilityRole="button"` plus a descriptive `accessibilityLabel`,
and any control smaller than 44×44pt gets `hitSlop` (or padding) to
reach that minimum — standardizing today's inconsistent
`hitSlop={Spacing.two}` vs. raw `hitSlop={8}` (see `episode-row.tsx`)
onto `Spacing.two` everywhere. Only 1 file in the app
(`back-button.tsx`) uses `accessibilityLabel`/`accessibilityRole`
today, so this touches most existing screens; the implementation plan
organizes it as one task per screen-group (tabs, auth, learn, explore,
player) rather than one large diff, to keep each task's review
reasonable.

### App icon / splash cleanup

Icon and splash are already properly branded (`app.json` — Village
Fireside name/colors/adaptive-icon layers, not Expo defaults); this
item is a dead-asset cleanup, not new branding work.

**Correction found during planning, not assumed:** an earlier pass of
this check used a grep exclusion pattern that accidentally hid a real
usage — `apps/mobile/src/components/animated-icon.tsx`'s
`AnimatedSplashOverlay` export is **not** dead code. It's imported and
rendered by `apps/mobile/src/app/_layout.tsx` (the actual root
layout) as the real native-splash-to-app transition overlay, styled
with the app's actual brand color (`#208AEF`, matching
`app.json`'s splash config). Re-verified properly (checking for the
exact imported name, not just the filename, and without an exclusion
pattern that could hide a real cross-file reference):

- `react-logo.png`/`react-logo@2x.png`/`react-logo@3x.png` and
  `tutorial-web.png` — genuinely unreferenced anywhere. Safe to delete.
- `web-badge.tsx` (a "Made with Expo" version-badge component) is
  genuinely dead — confirmed not imported anywhere. Its two
  exclusively-referenced images, `expo-badge.png`/`expo-badge-white.png`,
  are safe to delete alongside it.
- `animated-icon.tsx`/`.web.tsx` themselves must **not** be deleted —
  `AnimatedSplashOverlay` is live. But each file's _second_ export,
  `AnimatedIcon`, is itself genuinely dead (confirmed unreferenced
  anywhere, in either the `.tsx` or `.web.tsx` variant) — a leftover
  from the same starter template, coexisting in the same file as the
  real splash component. Removing just that unused function (and the
  keyframes/styles used only by it, not the ones `AnimatedSplashOverlay`
  shares, like `styles.image`) frees up `logo-glow.png`, which is
  referenced only inside `AnimatedIcon` in both file variants —
  confirmed via a dedicated grep for that filename.

Net cleanup: delete `web-badge.tsx` and 6 image files
(`react-logo.png`/`@2x`/`@3x`, `tutorial-web.png`,
`expo-badge.png`/`expo-badge-white.png`); edit (not delete)
`animated-icon.tsx`/`.web.tsx` to remove only the dead `AnimatedIcon`
function, its two files' worth of keyframes/styles used exclusively by
it, and the `logo-glow.png` file that function alone referenced.
`expo-logo.png` stays — `AnimatedSplashOverlay` needs it.

## Known limitations

- **No "ask again" path for a denied notification permission** — see
  "Push notifications" above. A user who denies must use system
  Settings; revisit only if user feedback shows this is a real problem
  in practice.
- **Share links are dead for non-users** — see "Share buttons" above;
  tracked in `docs/known-issues.md`, needs a real domain to fix.
- **Search result caps (top 5 per type, no "see all")** — acceptable
  for v1 result density; add a full-list view per type if usage shows
  the cap is too tight.

## Testing

- `search-history.ts`'s read/write functions: untested, matching its
  actual precedent — confirmed no `settings.test.ts` exists for the
  file-based module it mirrors, despite `settings.ts` also being a
  small, unit-testable pure-ish module. This codebase's real dividing
  line for TDD is pure predicates/schemas (`matchesLearnFilters`,
  `teacherRequestSchema`), not file-I/O wrapper modules — followed
  here rather than the aspirational-but-unapplied "unit-testable"
  framing.
- `matchesLearnFilters`-style predicates: N/A here — search relies on
  Postgres `.textSearch()`, not a client-side pure-predicate filter, so
  there's no equivalent unit to TDD the same way Prompt 12's filters
  were.
- Query/mutation hooks and screens: untested, matching this codebase's
  established precedent (no test file exists for any `use-*.ts` query
  hook or screen component anywhere in this app).
- **Required verification step, not optional:** the `EXPLAIN ANALYZE`
  check against `public_contributors` described in "Data layer" above
  — must be run against the live project and its actual plan output
  reported before this task is considered done.

## Documentation

`docs/known-issues.md` gains one new entry: share links are inert for
recipients without the app installed, needs a real domain + universal
links to fix. No new `docs/*.md` file is needed beyond that — search
and notifications are thin enough (a query hook, a token table, a
registration flow) that they don't need their own doc file the way
`docs/education.md` did for Prompt 12's much larger surface area.
