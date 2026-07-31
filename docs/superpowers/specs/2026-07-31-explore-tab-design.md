# Explore Tab (Prompt 11) — Design Spec

## Scope

The Explore tab, per `docs/PROMPT_PACK.md`'s Prompt 11:

- A list/map toggle over the `destinations` table, list as the default
  view. Map view uses `react-native-maps` (already installed since
  Prompt 6, unused until now) with pin clustering.
- Filter chips by country and category, both multi-select, ANDed
  together.
- A destination detail screen: image/video gallery, description and
  visitor-guidance fields, linked series ("Stories from this place"),
  local contributors, and a "Plan Your Visit" entry point.
- A guest-usable Booking Inquiry form that writes to
  `booking_inquiries`, with an in-place confirmation state.
- Deep links for destinations, series, and episodes under the
  `villagefireside://` scheme already configured in `app.json`.

**Non-goals (explicitly deferred):**

- **Admin management of destinations/media/categories.** Prompt 14's
  job — this prompt only reads `is_published` rows, the same boundary
  every other public-content screen in this app already respects.
- **A real Google Maps API key.** No Google Cloud project exists yet.
  This prompt wires the `react-native-maps` config plugin against
  placeholder env vars, the same "complete code path, real credentials
  later" pattern Prompt 9 used for RevenueCat.
- **Server-side/paginated filtering.** The destinations table is small
  (a curated set of places, not user-generated content at scale);
  filtering happens client-side over one `useDestinations()` fetch.
  Revisit if the catalog grows large enough for this to matter.
- **A standalone single-episode screen.** The episode deep link
  resolves into the existing series detail screen and starts playback
  there (confirmed with the user) — no new UI surface for viewing one
  episode in isolation.
- **Remembering a deep-link destination through the sign-in/guest
  gate.** `resolveAuthRedirect` already sends any unauthenticated,
  non-guest user on an `(app)` route to `/welcome`, discarding whatever
  route they were headed to — true today for every existing `(app)`
  screen (series, cultural group, contributor), not something this
  prompt changes or is asked to fix.
- **Editorial/curated "category" field on destinations.** Confirmed
  with the user: category filtering is derived from the categories of
  series linked to a destination (`series.category`), not a new
  `destinations.category` column — no migration, no backfill, no
  admin UI dependency.

## New dependencies

- `react-native-map-clustering` — a drop-in wrapper around
  `react-native-maps`'s `MapView` (confirmed against its README:
  identical usage, `Marker` children unchanged, no extra native config
  beyond `react-native-maps` itself, Expo-compatible). Handles
  clustering math and cluster-tap-to-zoom; nothing hand-rolled.
- `@react-native-community/datetimepicker` — native date picker for the
  Booking Inquiry form's "preferred date" field. No existing date-input
  pattern anywhere in this app to reuse.
- `expo-video` — plays `destination_media`'s video clips. No video
  playback exists anywhere in this app yet (audio-only until now); this
  is the minimal addition needed for the gallery's video items.

## `app.json` — `react-native-maps` config plugin

```jsonc
[
  "react-native-maps",
  {
    "androidGoogleMapsApiKey": "your-android-google-maps-api-key",
    // iOS deliberately omits iosGoogleMapsApiKey — react-native-maps
    // defaults to Apple's native MapKit provider on iOS when no Google
    // key is supplied, which needs no API key/account at all. Only
    // Android requires a real Google Maps key before release.
  },
]
```

This is a literal placeholder string edited directly in `app.json`, not
an env var. Every other placeholder credential in this codebase
(RevenueCat's keys, Supabase's) is read via `process.env.EXPO_PUBLIC_*`
at JS runtime inside a hook/component — but a Google Maps key has to be
baked into native config (`AndroidManifest.xml` meta-data) by the
`react-native-maps` config plugin at `expo prebuild` time, which is a
build-time step with no access to `.env`. This repo has no
`app.config.js`/`.ts` (only a static `app.json`), and adding one just
to thread an env var through prebuild would be a structural change out
of scope for "add maps" — so the placeholder lives directly in
`app.json`, the same "obviously fake until someone deliberately swaps
it" convention `.env.example`'s placeholders use, just in the one file
that can actually hold it given this repo's current config shape.

`docs/maps.md` (new) documents: creating a Google Cloud project,
enabling the Maps SDK for Android, restricting the key, and where the
real value goes — mirroring `docs/monetization.md`'s "what to set up
before this goes live" section.

## Data layer

### `apps/mobile/src/types/content.ts` — `Destination` extended

```ts
export type Destination = {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  district: string | null;
  country: string | null;
  coverImageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  categories: string[];
};
```

`categories` is a deduplicated list of `series.category` values across
every series linked to this destination (see the query below) — it's
how the Explore screen's category chips filter destinations without a
dedicated `destinations.category` column.

### `apps/mobile/src/hooks/queries/use-destinations.ts` (new)

Mirrors `useCulturalGroups`'s exact shape (`use-home-sections.ts:143-166`):

```ts
export function useDestinations() {
  return useQuery({
    queryKey: ["destinations"],
    queryFn: async (): Promise<Destination[]> => {
      const { data, error } = await supabase
        .from("destinations")
        .select(
          "id, name, slug, region, district, country, cover_image_url, latitude, longitude, series(category)",
        )
        .eq("is_published", true)
        .returns<DestinationRow[]>();
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        region: row.region,
        district: row.district,
        country: row.country,
        coverImageUrl: row.cover_image_url,
        latitude: row.latitude,
        longitude: row.longitude,
        categories: [
          ...new Set(
            row.series
              .map((s) => s.category)
              .filter((category): category is string => category !== null),
          ),
        ],
      }));
    },
  });
}
```

`series(category)` is a to-many embed — every published-or-not series
linked to this destination comes back (RLS on `series` still applies
per-row, same as every other embedded query in this codebase; an
unpublished series simply won't appear in the array, which is fine
since its category shouldn't count as "available" for filtering
anyway).

### `apps/mobile/src/hooks/queries/use-destination-detail.ts` (new)

Same shape as `use-cultural-group-detail.ts` — sequential queries, not
a single mega-join, matching that file's own reasoning (independent
RLS-gated pieces, clearer error attribution per query):

1. `destinations` row by `slug` (not `id` — the deep link and the
   spec's own URL pattern are slug-based).
2. `destination_media` where `destination_id = destination.id`, ordered
   by `sort_order`.
3. `series` where `destination_id = destination.id` and
   `is_published = true`, with `episodes(count)` — same
   `SeriesLinkRow`-style shape as the cultural group hook, for "Stories
   from this place."
4. `public_contributors` where `district = destination.district` — a
   literal free-text match, per the spec's own wording ("Local
   contributors from this district"). Skipped entirely
   (`contributors: []`) when `destination.district` is `null`, since
   matching everything against a null district would be wrong, not
   permissive.

```ts
export type DestinationDetail = Destination & {
  description: string | null;
  bestTimeToVisit: string | null;
  entryFeeNotes: string | null;
  safetyNotes: string | null;
  conservationNotes: string | null;
  media: { id: string; url: string; type: "image" | "video"; caption: string | null }[];
  series: { id: string; title: string; coverImageUrl: string | null; episodeCount: number }[];
  contributors: PublicContributor[];
};
```

### `apps/mobile/src/lib/validation.ts` — `bookingInquirySchema` (new)

```ts
export const bookingInquirySchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone number is required"),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  preferredDate: z.string().optional(),
  message: z.string().min(1, "Tell us a bit about your trip"),
});
```

`preferredDate` is a plain string here (ISO `yyyy-mm-dd`, produced by
the date picker) — validated/typed as a string at the form boundary,
converted to whatever shape `booking_inquiries.preferred_date`
(Postgres `date`) needs at the insert call, matching how this codebase
already handles date-shaped Postgres columns elsewhere (no shared
date-formatting utility exists yet; a one-line `toISOString().slice(0, 10)`-
style conversion at the insert call site is enough, not a new lib
module).

## Mobile: Explore screen (`(tabs)/explore.tsx`, replacing the Prompt 6 stub)

- Local `view: "list" | "map"` state, default `"list"` (confirmed with
  the user — matches every other tab's default of "scrollable content,
  no permission prompts").
- List view: the existing `DestinationCard` grid, now driven by
  `useDestinations()` + the active filters instead of `mockDestinations`.
- Map view: `react-native-map-clustering`'s `MapView`
  (`import MapView from "react-native-map-clustering"`), initial region
  centered on East Africa (a fixed reasonable default — e.g. roughly
  Uganda/Rwanda/Kenya's shared region — not derived from device
  location, since there's no location-permission flow anywhere in this
  app and this prompt doesn't add one). One `Marker` per filtered
  destination with valid `latitude`/`longitude` (destinations missing
  coordinates simply don't get a pin — still show up in list view).
  Tapping a marker navigates directly to `/destination/${slug}`, no
  callout step.
- Filter chips: two horizontal `Chip` rows (country values, category
  values — both derived from the fetched destination list, not a
  separate query), each multi-select; a destination passes the filter
  when (no country chips selected OR its country is selected) AND (no
  category chips selected OR at least one of its categories is
  selected). This filtering function is pure and unit-tested directly.
- Toggle control between list/map: two `Chip` components side by side
  ("List" / "Map"), `selected` bound to the active `view` state — no
  new component needed, reuses `Chip` exactly as the filter rows do.

## Mobile: Destination detail (`app/(app)/destination/[slug].tsx`, new)

Same skeleton as `cultural-group/[id].tsx`: `useLocalSearchParams<{slug}>()`
→ `useDestinationDetail(slug)` → `BackButton` + loading (`Skeleton`) /
error (`EmptyState`) / data states → `ScrollView`.

- Gallery: horizontal `ScrollView` of `media` entries. Images render via
  `expo-image`. A video entry renders as its first frame/a placeholder
  thumbnail with a play affordance; tapping opens a `Modal` containing
  `expo-video`'s `VideoView` with native controls, dismissed by
  backdrop tap (same `Modal`/backdrop-`Pressable` pattern
  `unlock-sheet.tsx` already uses).
- Description, best time to visit, entry fees, safety notes,
  conservation notes — `ThemedText` blocks, each rendered only when its
  field is non-null (matching `series/[id].tsx`'s conditional-field
  pattern for `description`/`category`).
- "Stories from this place" — a `SectionHeader` + horizontal
  `SeriesCard` rail (same component Home's rails already use),
  `onPress` → `router.push(`/series/${id}`)`.
- "Local contributors" — a `SectionHeader` + horizontal rail; reuses
  whatever contributor-card presentation `cultural-group/[id].tsx`
  already established for its own contributor rail (read that file's
  exact JSX at implementation time rather than inventing a new
  contributor-card shape).
- "Plan Your Visit" — a `Button` that does
  `router.push(`/destination/${slug}/inquire`)`. No `useRequireAuth`
  gate — guests can proceed directly, per the spec's explicit "works
  for guests" requirement and the table's own RLS policy.

## Mobile: Booking Inquiry (`app/(app)/destination/[slug]/inquire.tsx`, new)

- `react-hook-form` + `zodResolver(bookingInquirySchema)`, fields as
  plain `TextInput`s wrapped in `Controller` + `FormError` underneath
  each — the exact shape `sign-up.tsx` already established. The
  "preferred date" field uses `@react-native-community/datetimepicker`
  (`display="default"`, platform-native picker UI) instead of a
  `TextInput`.
- On submit:
  ```ts
  const { error } = await supabase.from("booking_inquiries").insert({
    destination_id: destination.id,
    user_id: session?.user.id ?? null,
    name: values.name,
    phone: values.phone,
    email: values.email || null,
    preferred_date: values.preferredDate || null,
    message: values.message,
  });
  ```
  No edge function — `booking_inquiries_insert_anyone`'s
  `WITH CHECK (true)` policy (confirmed in
  `supabase/migrations/20260721150500_rls_policies.sql`) already allows
  a direct anon/authenticated insert; only `SELECT`/`UPDATE` are
  admin-only.
- On success: the screen swaps to an in-place confirmation view ("A
  local guide partner will contact you.") rather than navigating to a
  separate confirmation route — a one-line success message doesn't
  warrant its own screen/history entry, and this mirrors how other
  single-message confirmations in this app (e.g. a completed unlock)
  resolve in place rather than pushing new navigation state.
- On failure: a toast-style inline error above the submit button (reuse
  `FormError`'s presentation for a form-level error, not a per-field
  one), submit stays enabled for retry.

## Mobile: episode deep-link resolver (`app/(app)/episode/[id].tsx`, new)

Confirmed with the user: resolves into the existing series detail
screen rather than a new standalone episode UI.

```ts
export default function EpisodeRedirectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const expand = usePlayerStore((s) => s.expand);

  useEffect(() => {
    let cancelled = false;
    resolveEpisodeForDeepLink(id).then((result) => {
      if (cancelled) return;
      if (result) {
        void playQueue([result.episode], 0).then(expand);
        router.replace(`/series/${result.episode.seriesId}`);
      } else {
        router.replace("/");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return <Skeleton width="100%" height={200} />; // brief loading state while resolving
}
```

`resolveEpisodeForDeepLink` (a small new query function, not a
`useQuery` hook — this is a one-shot imperative fetch on mount, not
something a component re-renders against) fetches the episode plus
enough series data to build a `QueueEpisode` (title, episode_number,
duration_seconds, access_tier, coin_price, content_source, seriesId,
seriesTitle, coverImageUrl) — the same shape `series/[id].tsx`'s
`buildQueue()` already constructs. `router.replace` (not `push`) so
back-navigation from the series screen doesn't return to a bare loading
route. If the episode doesn't exist or isn't accessible-enough to
resolve (RLS/publication state), falls back to `router.replace("/")`
rather than showing a dead-end error screen for what's fundamentally a
shared-link edge case.

`villagefireside://destination/{slug}` and `villagefireside://series/{id}`
need no equivalent resolver — expo-router's file-based routing already
maps a scheme URL matching an existing route path
(`app/(app)/destination/[slug].tsx`, the pre-existing
`app/(app)/series/[id].tsx`) automatically, the same way this app's
`scheme: "villagefireside"` config in `app.json` already makes every
other `(app)` route deep-linkable with zero custom linking config —
confirmed by grepping for any existing `linking` config or
`Linking.createURL` usage in this codebase and finding none outside the
password-recovery flow, which is special-cased for an unrelated reason
(Supabase's reset-password URL doesn't match any app route at all, so
it needs manual parsing before it can redirect into one).

## Testing approach

Following this codebase's established convention: pure logic gets unit
tests, screens and native-rendering code (map tiles, clustering,
`VideoView` playback, the native date picker) are manual/device
verification, same carve-out as Prompt 8's audio playback and Prompt
10's filesystem downloads.

- The Explore screen's country+category filter predicate — a pure
  function taking `(destination, selectedCountries, selectedCategories)`
  → `boolean`, extracted the same way `shouldPauseForWifi` was in
  Prompt 10, tested against all four selection-state combinations (no
  filters, country only, category only, both).
- `bookingInquirySchema` — valid input passes; missing name/phone/message,
  and a malformed email, each fail with the expected message.
- `resolveEpisodeForDeepLink`'s two branches (episode resolves vs. not
  found/inaccessible) — mocked Supabase client, following the existing
  `resolve-episode-source.test.ts`-style mocking convention.
- `use-destinations.ts`/`use-destination-detail.ts` are not unit-tested
  directly, matching `use-cultural-group-detail.ts`/
  `use-contributor-detail.ts`'s existing precedent (no test file for
  either) — their query-shaping logic is straightforward enough that
  the established pattern in this codebase treats them as
  integration-verified by the screens that use them, not unit-tested in
  isolation.
