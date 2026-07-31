# Explore Tab (Prompt 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Explore tab — a list/map browser over `destinations` with country/category filters, a destination detail screen (gallery, description, linked stories, local contributors, booking entry point), a guest-usable Booking Inquiry form, and deep links for destinations/series/episodes.

**Architecture:** Two new TanStack Query hooks (`use-destinations.ts`, `use-destination-detail.ts`) follow this codebase's established `use-cultural-group-detail.ts` pattern exactly. The Explore screen replaces its Prompt 6 mock stub with real data behind a list/map toggle; map view uses `react-native-map-clustering` (a drop-in wrapper around the already-installed `react-native-maps`). The destination detail screen mirrors `cultural-group/[id].tsx`'s skeleton. Deep links to destinations/series work automatically via expo-router's file-based routing (no linking config needed); an episode deep link resolves through a thin new route into the existing series detail screen and player queue.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, TanStack Query, Zustand, react-hook-form + zod, Jest + `@testing-library/react-native`, TypeScript.

## Global Constraints

- **Read the exact versioned Expo docs before writing code.** `apps/mobile/AGENTS.md` requires checking https://docs.expo.dev/versions/v57.0.0/ before writing any code — this plan's `expo-video` usage (Task 7) was verified against that version while writing this plan.
- **`react-native-map-clustering` is a drop-in replacement for `react-native-maps`'s `MapView`** — same `Marker` children, same props, verified against the package's own README. No hand-rolled clustering.
- **Filtering is client-side.** `useDestinations()` fetches the full published-destinations list once; country/category filtering happens in-memory via a pure predicate function, not query parameters.
- **No `useRequireAuth` gate on the Booking Inquiry form.** `booking_inquiries_insert_anyone`'s RLS policy (`WITH CHECK (true)`) already allows a direct anon/authenticated insert — guests submit exactly like signed-in users, with `user_id: null`.
- **The episode deep link never builds a standalone episode screen.** It resolves into the existing series detail screen and player queue (confirmed decision, not this plan's to revisit).
- **Category filtering has no `destinations.category` column** — a destination's filterable categories are derived from `series.category` for every series linked to it via `series.destination_id`. No migration in this plan.
- **The Google Maps Android API key is a literal placeholder string directly in `app.json`**, not an env var — this repo has no `app.config.js`, and a build-time-only key can't be read from `.env` without one. See Task 1.
- **Every task must leave `pnpm typecheck` clean.** Where a change (e.g. extending a shared type) would otherwise break an existing consumer, that consumer's fix is folded into the same task rather than deferred — see Task 2.
- **Commit after every task**, following this repo's convention: `git commit -m "Prompt 11: <description>"`.
- Full spec: `docs/superpowers/specs/2026-07-31-explore-tab-design.md`. Read it if any task below is unclear about intent.

---

### Task 1: Dependencies + `react-native-maps` config plugin

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.json`

**Interfaces:**

- Produces: `react-native-map-clustering`, `@react-native-community/datetimepicker`, `expo-video`, importable by later tasks.

- [ ] **Step 1: Install the packages**

```bash
cd apps/mobile && npx expo install react-native-map-clustering @react-native-community/datetimepicker expo-video
```

Expected: `apps/mobile/package.json` gains all three under `dependencies`, versions chosen by `expo install` to match Expo SDK 57. `react-native-maps` itself is already installed (Prompt 6) — do not reinstall it.

- [ ] **Step 2: Add the `react-native-maps` config plugin**

In `apps/mobile/app.json`, add a new entry to the existing `"plugins"` array (after `"expo-audio"`'s config block):

```jsonc
[
  "react-native-maps",
  {
    "androidGoogleMapsApiKey": "your-android-google-maps-api-key",
  },
]
```

No `iosGoogleMapsApiKey` — iOS defaults to Apple's native MapKit provider with no key needed. `"your-android-google-maps-api-key"` is a literal placeholder (per Global Constraints) that a maintainer replaces directly in this file once a real Google Cloud key exists — `docs/maps.md` (Task 11) documents that setup.

- [ ] **Step 3: Confirm the lockfile change and commit**

```bash
git status
```

Confirm the root `pnpm-lock.yaml` changed (this is a pnpm workspace with one root lockfile — the recurring lesson from every prior prompt's Task 1).

```bash
pnpm typecheck
git add apps/mobile/package.json apps/mobile/app.json pnpm-lock.yaml
git commit -m "Prompt 11: install map/video/date-picker dependencies and configure react-native-maps"
```

---

### Task 2: Destinations data layer + filter predicate (TDD) + Explore list screen

**Files:**

- Modify: `apps/mobile/src/types/content.ts`
- Create: `apps/mobile/src/hooks/queries/use-destinations.ts`
- Create: `apps/mobile/src/lib/destination-filter.ts`
- Test: `apps/mobile/src/lib/destination-filter.test.ts`
- Modify: `apps/mobile/src/app/(app)/(tabs)/explore.tsx` (full rewrite, replacing the Prompt 6 mock stub)
- Delete: `apps/mobile/src/mocks/content.ts`

**Interfaces:**

- Produces: extended `Destination` type (`slug`, `district`, `country`, `latitude`, `longitude`, `categories`), `useDestinations()`, `matchesDestinationFilters(destination, selectedCountries, selectedCategories): boolean`. Consumed by Task 3 (map view, same screen file) and Task 4 (`use-destination-detail.ts` reuses the `Destination` type via `DestinationDetail`).

This task is a single unit specifically because extending the shared
`Destination` type breaks `explore.tsx`'s existing mock-based code no
matter which file changes first — per Global Constraints, the type
change and its only consumer's fix land together, never in a state
where `pnpm typecheck` fails in between.

- [ ] **Step 1: Extend the `Destination` type**

In `apps/mobile/src/types/content.ts`, replace:

```ts
export type Destination = {
  id: string;
  name: string;
  region: string | null;
  coverImageUrl: string | null;
};
```

with:

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

- [ ] **Step 2: Write the failing tests for the filter predicate**

```ts
// apps/mobile/src/lib/destination-filter.test.ts
import { matchesDestinationFilters } from "./destination-filter";
import type { Destination } from "@/types/content";

const destination: Destination = {
  id: "d1",
  name: "Lake Bunyonyi",
  slug: "lake-bunyonyi",
  region: "Kigezi",
  district: "Kabale",
  country: "Uganda",
  coverImageUrl: null,
  latitude: -1.27,
  longitude: 29.9,
  categories: ["lakes", "hidden_africa"],
};

describe("matchesDestinationFilters", () => {
  it("matches everything when no filters are selected", () => {
    expect(matchesDestinationFilters(destination, [], [])).toBe(true);
  });

  it("matches when the destination's country is selected", () => {
    expect(matchesDestinationFilters(destination, ["Uganda"], [])).toBe(true);
  });

  it("does not match when a different country is selected", () => {
    expect(matchesDestinationFilters(destination, ["Rwanda"], [])).toBe(false);
  });

  it("matches when at least one selected category overlaps", () => {
    expect(matchesDestinationFilters(destination, [], ["forests", "lakes"])).toBe(true);
  });

  it("does not match when no selected category overlaps", () => {
    expect(matchesDestinationFilters(destination, [], ["forests"])).toBe(false);
  });

  it("ANDs country and category — both must pass", () => {
    expect(matchesDestinationFilters(destination, ["Uganda"], ["forests"])).toBe(false);
    expect(matchesDestinationFilters(destination, ["Uganda"], ["lakes"])).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest destination-filter
```

Expected: FAIL — `Cannot find module './destination-filter'`.

- [ ] **Step 4: Implement the filter predicate**

```ts
// apps/mobile/src/lib/destination-filter.ts
import type { Destination } from "@/types/content";

export function matchesDestinationFilters(
  destination: Destination,
  selectedCountries: string[],
  selectedCategories: string[],
): boolean {
  const countryOk =
    selectedCountries.length === 0 ||
    (destination.country !== null && selectedCountries.includes(destination.country));
  const categoryOk =
    selectedCategories.length === 0 ||
    destination.categories.some((category) => selectedCategories.includes(category));
  return countryOk && categoryOk;
}
```

- [ ] **Step 5: Run it to confirm it passes**

```bash
cd apps/mobile && npx jest destination-filter
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Write `use-destinations.ts`**

```ts
// apps/mobile/src/hooks/queries/use-destinations.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { Destination } from "@/types/content";

type DestinationRow = {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  district: string | null;
  country: string | null;
  cover_image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  series: { category: string | null }[];
};

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
        .order("name", { ascending: true })
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
          ...new Set(row.series.map((s) => s.category).filter((c): c is string => c !== null)),
        ],
      }));
    },
  });
}
```

`series(category)` is a to-many embed on the FK `series.destination_id → destinations.id` — the same direct one-to-many embed shape `use-series-detail.ts` already uses for `episodes(...)`. RLS on `series` (`series_select_published`, gated on `is_published = true`) already excludes unpublished series from the embed with no extra filter needed — confirmed in `docs/rls-policies.md`. No test for this hook — matches this codebase's established precedent of not unit-testing `use-*-detail.ts`/`use-*.ts` query hooks (`use-cultural-group-detail.ts`, `use-contributor-detail.ts`, `use-home-sections.ts` all have no test files).

- [ ] **Step 7: Delete the now-unused mock file**

```bash
rm apps/mobile/src/mocks/content.ts
```

- [ ] **Step 8: Rewrite the Explore screen**

```tsx
// apps/mobile/src/app/(app)/(tabs)/explore.tsx
import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/chip";
import { DestinationCard } from "@/components/ui/destination-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { matchesDestinationFilters } from "@/lib/destination-filter";
import { useDestinations } from "@/hooks/queries/use-destinations";

export default function ExploreScreen() {
  const router = useRouter();
  const query = useDestinations();
  const [view, setView] = useState<"list" | "map">("list");
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const destinations = query.data ?? [];

  const countries = useMemo(
    () => [...new Set(destinations.map((d) => d.country).filter((c): c is string => c !== null))],
    [destinations],
  );
  const categories = useMemo(
    () => [...new Set(destinations.flatMap((d) => d.categories))],
    [destinations],
  );

  const filtered = destinations.filter((d) =>
    matchesDestinationFilters(d, selectedCountries, selectedCategories),
  );

  const toggleSelection = (value: string, list: string[], setList: (next: string[]) => void) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader title="Explore" />

      <View style={styles.toggleRow}>
        <Chip label="List" selected={view === "list"} onPress={() => setView("list")} />
        <Chip label="Map" selected={view === "map"} onPress={() => setView("map")} />
      </View>

      {countries.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {countries.map((country) => (
            <Chip
              key={country}
              label={country}
              selected={selectedCountries.includes(country)}
              onPress={() => toggleSelection(country, selectedCountries, setSelectedCountries)}
            />
          ))}
        </ScrollView>
      ) : null}

      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {categories.map((category) => (
            <Chip
              key={category}
              label={category}
              selected={selectedCategories.includes(category)}
              onPress={() => toggleSelection(category, selectedCategories, setSelectedCategories)}
            />
          ))}
        </ScrollView>
      ) : null}

      {query.isLoading ? (
        <Skeleton width="100%" height={200} />
      ) : view === "list" ? (
        <ScrollView contentContainerStyle={styles.content}>
          {filtered.length === 0 ? (
            <EmptyState title="No destinations found" body="Try adjusting your filters." />
          ) : (
            <View style={styles.grid}>
              {filtered.map((destination) => (
                <DestinationCard
                  key={destination.id}
                  name={destination.name}
                  region={destination.region}
                  coverImageUrl={destination.coverImageUrl}
                  onPress={() => router.push(`/destination/${destination.slug}`)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  toggleRow: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  chipRow: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
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

The `view === "map" ? null` branch is deliberate — Task 3 fills it in.
Running the app at this point shows an empty screen when "Map" is
tapped, which is expected mid-plan, not a bug. `/destination/${slug}`
doesn't exist as a route yet either (Task 6) — navigating there before
then 404s in-app, also expected mid-plan.

- [ ] **Step 9: Typecheck, run the filter test again, and commit**

```bash
pnpm typecheck
cd apps/mobile && npx jest destination-filter
```

Expected: both clean — this fully resolves the `Destination` type
extension with no consumer left broken.

```bash
git add apps/mobile/src/types/content.ts apps/mobile/src/hooks/queries/use-destinations.ts apps/mobile/src/lib/destination-filter.ts apps/mobile/src/lib/destination-filter.test.ts "apps/mobile/src/app/(app)/(tabs)/explore.tsx"
git rm apps/mobile/src/mocks/content.ts
git commit -m "Prompt 11: extend Destination type, add useDestinations, and rebuild the Explore list screen"
```

---

### Task 3: Explore screen — map view

**Files:**

- Modify: `apps/mobile/src/app/(app)/(tabs)/explore.tsx`

**Interfaces:**

- Consumes: `react-native-map-clustering` (Task 1), `react-native-maps`'s `Marker` (pre-existing dependency).

No test — native map rendering is manual/device verification (Global Constraints).

- [ ] **Step 1: Add the map view**

Add the import:

```ts
import MapView from "react-native-map-clustering";
import { Marker } from "react-native-maps";
```

Replace the `view === "map" ? null` branch with:

```tsx
) : (
  <MapView
    style={styles.map}
    initialRegion={{
      // Roughly centered over Uganda/Rwanda/Kenya — a fixed default,
      // not derived from device location (no location-permission flow
      // exists anywhere in this app).
      latitude: 0.5,
      longitude: 32.5,
      latitudeDelta: 8,
      longitudeDelta: 8,
    }}
  >
    {filtered
      .filter((d) => d.latitude !== null && d.longitude !== null)
      .map((destination) => (
        <Marker
          key={destination.id}
          coordinate={{ latitude: destination.latitude!, longitude: destination.longitude! }}
          title={destination.name}
          onPress={() => router.push(`/destination/${destination.slug}`)}
        />
      ))}
  </MapView>
)}
```

Add the style:

```ts
map: {
  flex: 1,
},
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add "apps/mobile/src/app/(app)/(tabs)/explore.tsx"
git commit -m "Prompt 11: add map view with clustering to the Explore tab"
```

---

### Task 4: `use-destination-detail.ts`

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-destination-detail.ts`

**Interfaces:**

- Consumes: `Destination` (Task 2), `PublicContributor` (pre-existing, `types/content.ts`).
- Produces: `DestinationDetail` type, `useDestinationDetail(slug)`. Consumed by Task 7 (destination detail screen) and Task 9 (Booking Inquiry screen).

No test — same precedent as Task 2's `use-destinations.ts`.

- [ ] **Step 1: Write the hook**

```ts
// apps/mobile/src/hooks/queries/use-destination-detail.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { Destination, PublicContributor } from "@/types/content";

export type DestinationMedia = {
  id: string;
  url: string;
  type: "image" | "video";
  caption: string | null;
};

export type DestinationDetail = Destination & {
  description: string | null;
  bestTimeToVisit: string | null;
  entryFeeNotes: string | null;
  safetyNotes: string | null;
  conservationNotes: string | null;
  media: DestinationMedia[];
  series: { id: string; title: string; coverImageUrl: string | null; episodeCount: number }[];
  contributors: PublicContributor[];
};

type DestinationRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  region: string | null;
  district: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  cover_image_url: string | null;
  best_time_to_visit: string | null;
  entry_fee_notes: string | null;
  safety_notes: string | null;
  conservation_notes: string | null;
};

type MediaRow = {
  id: string;
  media_url: string;
  media_type: string;
  caption: string | null;
};

type SeriesLinkRow = {
  id: string;
  title: string;
  cover_image_url: string | null;
  episodes: { count: number }[];
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

export function useDestinationDetail(slug: string) {
  return useQuery({
    queryKey: ["destination-detail", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<DestinationDetail> => {
      const { data: destination, error: destinationError } = await supabase
        .from("destinations")
        .select(
          "id, name, slug, description, region, district, country, latitude, longitude, cover_image_url, best_time_to_visit, entry_fee_notes, safety_notes, conservation_notes",
        )
        .eq("slug", slug)
        .eq("is_published", true)
        .single()
        .returns<DestinationRow>();
      if (destinationError) {
        throw destinationError;
      }

      const { data: mediaRows, error: mediaError } = await supabase
        .from("destination_media")
        .select("id, media_url, media_type, caption")
        .eq("destination_id", destination.id)
        .order("sort_order", { ascending: true })
        .returns<MediaRow[]>();
      if (mediaError) {
        throw mediaError;
      }

      const { data: seriesRows, error: seriesError } = await supabase
        .from("series")
        .select("id, title, cover_image_url, episodes(count)")
        .eq("destination_id", destination.id)
        .eq("is_published", true)
        .returns<SeriesLinkRow[]>();
      if (seriesError) {
        throw seriesError;
      }

      // A destination's district is free text and often blank — matching
      // contributors against a null district would incorrectly match
      // every contributor with a null district too, so this is skipped
      // entirely rather than run with a loose filter.
      let contributors: PublicContributor[] = [];
      if (destination.district) {
        const { data: contributorRows, error: contributorsError } = await supabase
          .from("public_contributors")
          .select("id, display_name, contributor_type, bio, photo_url, district, country")
          .eq("district", destination.district)
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
        id: destination.id,
        name: destination.name,
        slug: destination.slug,
        description: destination.description,
        region: destination.region,
        district: destination.district,
        country: destination.country,
        latitude: destination.latitude,
        longitude: destination.longitude,
        coverImageUrl: destination.cover_image_url,
        bestTimeToVisit: destination.best_time_to_visit,
        entryFeeNotes: destination.entry_fee_notes,
        safetyNotes: destination.safety_notes,
        conservationNotes: destination.conservation_notes,
        categories: [],
        media: mediaRows.map((row) => ({
          id: row.id,
          url: row.media_url,
          type: row.media_type === "video" ? "video" : "image",
          caption: row.caption,
        })),
        series: seriesRows.map((row) => ({
          id: row.id,
          title: row.title,
          coverImageUrl: row.cover_image_url,
          episodeCount: row.episodes[0]?.count ?? 0,
        })),
        contributors,
      };
    },
  });
}
```

`categories: []` on the returned `DestinationDetail` — the detail screen doesn't need per-destination category tags (that's an Explore-list-only filtering concern), but `DestinationDetail extends Destination`, so the field must be present; an empty array is honest (this query never populates it) rather than re-deriving it redundantly.

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add apps/mobile/src/hooks/queries/use-destination-detail.ts
git commit -m "Prompt 11: add useDestinationDetail"
```

---

### Task 5: `bookingInquirySchema` (TDD)

**Files:**

- Modify: `apps/mobile/src/lib/validation.ts`
- Test: `apps/mobile/src/lib/validation.test.ts` (pre-existing — add to it, don't replace it)

**Interfaces:**

- Produces: `bookingInquirySchema`, `BookingInquiryInput` type. Consumed by Task 9 (Booking Inquiry screen).

- [ ] **Step 1: Read the existing test file first**

```bash
cat apps/mobile/src/lib/validation.test.ts
```

Match its existing `describe`/`it` structure and assertion style exactly for the new schema's tests (this file already has tests for `signUpSchema`, `phoneSignInSchema`, etc. — follow that same pattern, don't invent a new one).

- [ ] **Step 2: Write the failing tests**

Add to `apps/mobile/src/lib/validation.test.ts`:

```ts
describe("bookingInquirySchema", () => {
  const valid = {
    name: "Amina Nakato",
    phone: "0772123456",
    email: "amina@example.com",
    preferredDate: "2026-08-15",
    message: "We'd like a 3-day trip for a family of four.",
  };

  it("accepts a fully filled valid inquiry", () => {
    expect(bookingInquirySchema.safeParse(valid).success).toBe(true);
  });

  it("accepts email and preferredDate omitted", () => {
    const { email, preferredDate, ...rest } = valid;
    expect(bookingInquirySchema.safeParse(rest).success).toBe(true);
  });

  it("rejects a missing name", () => {
    const result = bookingInquirySchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing phone", () => {
    const result = bookingInquirySchema.safeParse({ ...valid, phone: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing message", () => {
    const result = bookingInquirySchema.safeParse({ ...valid, message: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = bookingInquirySchema.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
  });
});
```

Add the import at the top of the test file: `bookingInquirySchema` alongside whatever's already imported from `./validation`.

- [ ] **Step 3: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest validation
```

Expected: FAIL — `bookingInquirySchema` is not exported.

- [ ] **Step 4: Implement**

Add to `apps/mobile/src/lib/validation.ts`:

```ts
export const bookingInquirySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().min(1, "Phone number is required"),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  preferredDate: z.string().optional(),
  message: z.string().trim().min(1, "Tell us a bit about your trip"),
});
export type BookingInquiryInput = z.infer<typeof bookingInquirySchema>;
```

- [ ] **Step 5: Run it to confirm it passes**

```bash
cd apps/mobile && npx jest validation
```

Expected: PASS, all `bookingInquirySchema` tests plus every pre-existing test in the file.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/validation.ts apps/mobile/src/lib/validation.test.ts
git commit -m "Prompt 11: add bookingInquirySchema"
```

---

### Task 6: Episode deep-link resolver logic (TDD)

**Files:**

- Create: `apps/mobile/src/lib/resolve-episode-for-deep-link.ts`
- Test: `apps/mobile/src/lib/resolve-episode-for-deep-link.test.ts`

**Interfaces:**

- Produces: `resolveEpisodeForDeepLink(episodeId): Promise<QueueEpisode | null>`. Consumed by Task 10 (episode deep-link screen).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/lib/resolve-episode-for-deep-link.test.ts
import { supabase } from "@/lib/supabase";

import { resolveEpisodeForDeepLink } from "./resolve-episode-for-deep-link";

jest.mock("@/lib/supabase", () => ({
  supabase: { from: jest.fn() },
}));

function mockSingleResult(data: unknown, error: unknown = null) {
  const single = jest.fn().mockResolvedValue({ data, error });
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq });
  (supabase.from as jest.Mock).mockReturnValue({ select });
}

describe("resolveEpisodeForDeepLink", () => {
  it("builds a QueueEpisode when the episode resolves", async () => {
    mockSingleResult({
      id: "ep-1",
      title: "The Fisherman's Tale",
      episode_number: 3,
      duration_seconds: 500,
      access_tier: "free",
      coin_price: 0,
      content_source: "elder_testimony",
      series_id: "series-1",
      series: { title: "Lake Bunyonyi Stories", cover_image_url: "https://example.com/cover.jpg" },
    });

    const result = await resolveEpisodeForDeepLink("ep-1");

    expect(result).toEqual({
      id: "ep-1",
      title: "The Fisherman's Tale",
      episodeNumber: 3,
      durationSeconds: 500,
      accessTier: "free",
      coinPrice: 0,
      contentSource: "elder_testimony",
      resumePositionSeconds: null,
      seriesId: "series-1",
      seriesTitle: "Lake Bunyonyi Stories",
      coverImageUrl: "https://example.com/cover.jpg",
    });
  });

  it("returns null when the episode isn't found or isn't accessible", async () => {
    mockSingleResult(null, { message: "not found" });

    expect(await resolveEpisodeForDeepLink("missing")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest resolve-episode-for-deep-link
```

Expected: FAIL — `Cannot find module './resolve-episode-for-deep-link'`.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/lib/resolve-episode-for-deep-link.ts
import { supabase } from "@/lib/supabase";
import type { QueueEpisode } from "@/stores/player-store";

type EpisodeRow = {
  id: string;
  title: string;
  episode_number: number;
  duration_seconds: number | null;
  access_tier: QueueEpisode["accessTier"];
  coin_price: number;
  content_source: QueueEpisode["contentSource"];
  series_id: string;
  series: { title: string; cover_image_url: string | null };
};

export async function resolveEpisodeForDeepLink(episodeId: string): Promise<QueueEpisode | null> {
  const { data, error } = await supabase
    .from("episodes")
    .select(
      "id, title, episode_number, duration_seconds, access_tier, coin_price, content_source, series_id, series(title, cover_image_url)",
    )
    .eq("id", episodeId)
    .single()
    .returns<EpisodeRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    title: data.title,
    episodeNumber: data.episode_number,
    durationSeconds: data.duration_seconds,
    accessTier: data.access_tier,
    coinPrice: data.coin_price,
    contentSource: data.content_source,
    resumePositionSeconds: null,
    seriesId: data.series_id,
    seriesTitle: data.series.title,
    coverImageUrl: data.series.cover_image_url,
  };
}
```

`resumePositionSeconds: null` — a deep link is a fresh entry point, not a resume of prior listening progress; `player-store.ts`'s own resume logic (`resolveResumePosition`) still applies once playback loads, reading actual progress at that point, so this isn't lying about anything, just not pre-empting it here.

- [ ] **Step 4: Run it to confirm it passes**

```bash
cd apps/mobile && npx jest resolve-episode-for-deep-link
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add apps/mobile/src/lib/resolve-episode-for-deep-link.ts apps/mobile/src/lib/resolve-episode-for-deep-link.test.ts
git commit -m "Prompt 11: add resolveEpisodeForDeepLink"
```

---

### Task 7: Destination detail screen

**Files:**

- Create: `apps/mobile/src/app/(app)/destination/[slug].tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx` (register the route)

**Interfaces:**

- Consumes: `useDestinationDetail` (Task 4).
- Produces: the `/destination/[slug]` route. Consumed by Task 3 (map marker taps) and Task 2 (list card taps) — both already point at this URL; this task is what makes it resolve instead of 404. Also extended in place by Task 8 (gallery) and its own "Plan Your Visit" button is the navigation target Task 9 makes resolve.

No test — screen-level UI, matches convention. Gallery/video deferred to Task 8 — this task builds description, stories, contributors, and the "Plan Your Visit" button.

- [ ] **Step 1: Write the screen**

```tsx
// apps/mobile/src/app/(app)/destination/[slug].tsx
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { DestinationCard } from "@/components/ui/destination-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { SeriesCard } from "@/components/ui/series-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useDestinationDetail } from "@/hooks/queries/use-destination-detail";

export default function DestinationDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const query = useDestinationDetail(slug);

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <Skeleton width="100%" height={200} />
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <EmptyState title="Not found" body="This destination isn't available right now." />
      </SafeAreaView>
    );
  }

  const destination = query.data;

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <ScrollView contentContainerStyle={styles.content}>
        {destination.coverImageUrl ? (
          <Image
            source={{ uri: destination.coverImageUrl }}
            style={styles.cover}
            contentFit="cover"
          />
        ) : null}
        <ThemedText type="title">{destination.name}</ThemedText>
        {destination.region || destination.country ? (
          <ThemedText type="small" themeColor="textSecondary">
            {[destination.region, destination.country].filter(Boolean).join(", ")}
          </ThemedText>
        ) : null}
        {destination.description ? (
          <ThemedText type="default">{destination.description}</ThemedText>
        ) : null}
        {destination.bestTimeToVisit ? (
          <ThemedText type="default">Best time to visit: {destination.bestTimeToVisit}</ThemedText>
        ) : null}
        {destination.entryFeeNotes ? (
          <ThemedText type="default">Entry fees: {destination.entryFeeNotes}</ThemedText>
        ) : null}
        {destination.safetyNotes ? (
          <ThemedText type="default">Safety notes: {destination.safetyNotes}</ThemedText>
        ) : null}
        {destination.conservationNotes ? (
          <ThemedText type="default">Conservation: {destination.conservationNotes}</ThemedText>
        ) : null}

        <Button
          label="Plan Your Visit"
          onPress={() => router.push(`/destination/${destination.slug}/inquire`)}
        />

        <SectionHeader title="Stories from this place" />
        {destination.series.length === 0 ? (
          <EmptyState title="No stories yet" body="Stories from this place will appear here." />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {destination.series.map((series) => (
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

        <SectionHeader title="Local contributors" />
        {destination.contributors.length === 0 ? (
          <EmptyState
            title="No contributors yet"
            body="Local storytellers and guides will appear here."
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {destination.contributors.map((contributor) => (
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
  cover: {
    width: "100%",
    height: 200,
    borderRadius: Spacing.two,
  },
  row: {
    gap: Spacing.three,
  },
});
```

- [ ] **Step 2: Register the route**

In `apps/mobile/src/app/(app)/_layout.tsx`, add a new `Stack.Screen` next to `cultural-group/[id]`:

```tsx
<Stack.Screen name="cultural-group/[id]" options={{ headerShown: false }} />
<Stack.Screen name="destination/[slug]" options={{ headerShown: false }} />
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add "apps/mobile/src/app/(app)/destination/[slug].tsx" "apps/mobile/src/app/(app)/_layout.tsx"
git commit -m "Prompt 11: add destination detail screen"
```

---

### Task 8: Destination detail — gallery + video modal

**Files:**

- Modify: `apps/mobile/src/app/(app)/destination/[slug].tsx`
- Create: `apps/mobile/src/components/video-modal.tsx`

**Interfaces:**

- Consumes: `expo-video` (Task 1), `DestinationMedia` (Task 4).

No test — native video playback is manual/device verification (Global Constraints), matching Prompt 8's audio-playback carve-out.

- [ ] **Step 1: Write the video modal**

```tsx
// apps/mobile/src/components/video-modal.tsx
import { useVideoPlayer, VideoView } from "expo-video";
import { Modal, Pressable, StyleSheet } from "react-native";

export function VideoModal({ url, onClose }: { url: string; onClose: () => void }) {
  const player = useVideoPlayer(url, (p) => p.play());

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <VideoView player={player} style={styles.video} nativeControls />
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    justifyContent: "center",
  },
  video: {
    width: "100%",
    height: 300,
  },
});
```

Mounted only while a video is selected (Step 2) — `useVideoPlayer`'s source is fixed at mount, so this component must fully unmount/remount per video rather than staying mounted with a changing `url` prop.

- [ ] **Step 2: Add the gallery to the destination detail screen**

In `apps/mobile/src/app/(app)/destination/[slug].tsx`, add imports:

```ts
import { useState } from "react";
import { Pressable, View } from "react-native";
```

(merge `Pressable`/`View` into the existing `react-native` import line; add the `useState` import.)

```ts
import { VideoModal } from "@/components/video-modal";
```

Inside the component, add state and the gallery section (after the cover `Image`, before `ThemedText type="title"`):

```tsx
const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
```

```tsx
{
  destination.media.length > 0 ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {destination.media.map((item) =>
        item.type === "image" ? (
          <Image
            key={item.id}
            source={{ uri: item.url }}
            style={styles.galleryImage}
            contentFit="cover"
          />
        ) : (
          <Pressable key={item.id} onPress={() => setActiveVideoUrl(item.url)}>
            <View style={[styles.galleryImage, styles.videoThumbnail]}>
              <ThemedText type="default" themeColor="background">
                ▶ Play
              </ThemedText>
            </View>
          </Pressable>
        ),
      )}
    </ScrollView>
  ) : null;
}
```

At the end of the returned JSX (as a sibling of the outer `SafeAreaView`'s `ScrollView`, after it closes):

```tsx
{
  activeVideoUrl ? (
    <VideoModal url={activeVideoUrl} onClose={() => setActiveVideoUrl(null)} />
  ) : null;
}
```

Add the styles:

```ts
galleryImage: {
  width: 160,
  height: 120,
  borderRadius: Spacing.two,
},
videoThumbnail: {
  backgroundColor: "rgba(0, 0, 0, 0.6)",
  alignItems: "center",
  justifyContent: "center",
},
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add "apps/mobile/src/app/(app)/destination/[slug].tsx" apps/mobile/src/components/video-modal.tsx
git commit -m "Prompt 11: add destination media gallery with video playback"
```

---

### Task 9: Booking Inquiry screen

**Files:**

- Create: `apps/mobile/src/app/(app)/destination/[slug]/inquire.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx` (register the route)

**Interfaces:**

- Consumes: `bookingInquirySchema`/`BookingInquiryInput` (Task 5), `useDestinationDetail` (Task 4, to resolve `slug` → `destination.id` and show the destination's name), `useAuthStore` (pre-existing, for `session?.user.id`).
- Produces: the `/destination/[slug]/inquire` route — Task 7's "Plan Your Visit" button already points at this URL; this task is what makes it resolve instead of 404.

No test — screen-level UI/form wiring, matches convention (form _validation_ is tested in Task 5; the screen composing it is not, same as `sign-up.tsx` having no test).

- [ ] **Step 1: Write the screen**

```tsx
// apps/mobile/src/app/(app)/destination/[slug]/inquire.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useDestinationDetail } from "@/hooks/queries/use-destination-detail";
import { type BookingInquiryInput, bookingInquirySchema } from "@/lib/validation";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export default function BookingInquiryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const destinationQuery = useDestinationDetail(slug);
  const session = useAuthStore((state) => state.session);
  const [apiError, setApiError] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);
  const [preferredDate, setPreferredDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BookingInquiryInput>({
    resolver: zodResolver(bookingInquirySchema),
    defaultValues: { name: "", phone: "", email: "", preferredDate: "", message: "" },
  });

  if (destinationQuery.isLoading || !destinationQuery.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <Skeleton width="100%" height={100} />
      </SafeAreaView>
    );
  }

  const destination = destinationQuery.data;

  const onSubmit = async (values: BookingInquiryInput) => {
    setApiError(undefined);
    const { error } = await supabase.from("booking_inquiries").insert({
      destination_id: destination.id,
      user_id: session?.user.id ?? null,
      name: values.name,
      phone: values.phone,
      email: values.email || null,
      preferred_date: values.preferredDate || null,
      message: values.message,
    });
    if (error) {
      setApiError(error.message);
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <BackButton />
          <ThemedText type="title">Inquiry sent</ThemedText>
          <ThemedText type="default">A local guide partner will contact you.</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <ThemedText type="title">Plan Your Visit</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          {destination.name}
        </ThemedText>

        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Your name"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.name?.message} />

        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Phone number"
              keyboardType="phone-pad"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.phone?.message} />

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Email (optional)"
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.email?.message} />

        <Pressable style={styles.input} onPress={() => setShowDatePicker(true)}>
          <ThemedText type="default">
            {preferredDate ? preferredDate.toISOString().slice(0, 10) : "Preferred date (optional)"}
          </ThemedText>
        </Pressable>
        {showDatePicker ? (
          <DateTimePicker
            value={preferredDate ?? new Date()}
            mode="date"
            display="default"
            onChange={(_event, date) => {
              setShowDatePicker(false);
              if (date) {
                setPreferredDate(date);
                setValue("preferredDate", date.toISOString().slice(0, 10));
              }
            }}
          />
        ) : null}

        <Controller
          control={control}
          name="message"
          render={({ field }) => (
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Tell us about your trip"
              multiline
              numberOfLines={4}
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.message?.message} />
        <FormError message={apiError} />

        <Button
          label={isSubmitting ? "Sending…" : "Send Inquiry"}
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
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
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
  },
  multiline: {
    minHeight: 100,
    textAlignVertical: "top",
  },
});
```

- [ ] **Step 2: Register the route**

In `apps/mobile/src/app/(app)/_layout.tsx`, add a new `Stack.Screen` next to `destination/[slug]`:

```tsx
<Stack.Screen name="destination/[slug]" options={{ headerShown: false }} />
<Stack.Screen name="destination/[slug]/inquire" options={{ headerShown: false }} />
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add "apps/mobile/src/app/(app)/destination/[slug]/inquire.tsx" "apps/mobile/src/app/(app)/_layout.tsx"
git commit -m "Prompt 11: add guest-usable Booking Inquiry form"
```

---

### Task 10: Episode deep-link resolver screen

**Files:**

- Create: `apps/mobile/src/app/(app)/episode/[id].tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx` (register the route)

**Interfaces:**

- Consumes: `resolveEpisodeForDeepLink` (Task 6), `usePlayerStore` (pre-existing).

No test — screen-level effect/navigation wiring; the resolver logic it calls is already unit-tested in Task 6.

- [ ] **Step 1: Write the screen**

```tsx
// apps/mobile/src/app/(app)/episode/[id].tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import { Skeleton } from "@/components/ui/skeleton";
import { resolveEpisodeForDeepLink } from "@/lib/resolve-episode-for-deep-link";
import { usePlayerStore } from "@/stores/player-store";

export default function EpisodeDeepLinkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const playQueue = usePlayerStore((state) => state.playQueue);
  const expand = usePlayerStore((state) => state.expand);

  useEffect(() => {
    let cancelled = false;
    resolveEpisodeForDeepLink(id)
      .then((episode) => {
        if (cancelled) {
          return;
        }
        if (episode) {
          void playQueue([episode], 0).then(expand);
          router.replace(`/series/${episode.seriesId}`);
        } else {
          router.replace("/");
        }
      })
      .catch(() => {
        if (!cancelled) {
          router.replace("/");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Skeleton width="100%" height={200} />
    </SafeAreaView>
  );
}
```

`router.replace` (not `push`) both on success and on failure — a bare loading/error screen should never sit in the back-navigation history.

- [ ] **Step 2: Register the route**

In `apps/mobile/src/app/(app)/_layout.tsx`, add a new `Stack.Screen` next to `destination/[slug]/inquire`:

```tsx
<Stack.Screen name="destination/[slug]/inquire" options={{ headerShown: false }} />
<Stack.Screen name="episode/[id]" options={{ headerShown: false }} />
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add "apps/mobile/src/app/(app)/episode/[id].tsx" "apps/mobile/src/app/(app)/_layout.tsx"
git commit -m "Prompt 11: add episode deep-link resolver"
```

---

### Task 11: `docs/maps.md`

**Files:**

- Create: `docs/maps.md`

- [ ] **Step 1: Write the document**

```markdown
# Maps Setup

Village Fireside's Explore tab uses `react-native-maps` (via
`react-native-map-clustering` for pin clustering).

## iOS

No setup needed — iOS uses Apple's native MapKit provider by default,
which requires no API key or account.

## Android

Android requires a real Google Maps API key before release. The
`app.json` `plugins` entry for `react-native-maps` currently holds a
placeholder string (`"your-android-google-maps-api-key"`) — replace it
directly in that file once a real key exists:

1. Create (or reuse) a project in the
   [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the "Maps SDK for Android" API for that project.
3. Create an API key under "Credentials," and restrict it to the Maps
   SDK for Android and this app's Android package name/SHA-1
   certificate fingerprint (do not ship an unrestricted key).
4. Replace `"your-android-google-maps-api-key"` in `apps/mobile/app.json`'s
   `react-native-maps` plugin config with the real key.
5. Run `npx expo prebuild --clean` (or rebuild via EAS) so the key gets
   baked into `AndroidManifest.xml`.

Until a real key is set, the Android map still renders but shows a
"for development purposes only" watermark — expected, not a bug, for
any build using the placeholder.

## Why iOS and Android differ

`react-native-maps`' Expo config plugin only sets `GMSApiKey` on iOS
(forcing Google Maps there) when an `iosGoogleMapsApiKey` is explicitly
provided. This app deliberately omits it, so iOS always uses Apple's
built-in provider — one less credential to manage, and no
development-mode watermark on iOS regardless of the Android key's state.
```

- [ ] **Step 2: Commit**

```bash
git add docs/maps.md
git commit -m "Prompt 11: add docs/maps.md"
```

---

### Task 12: Whole-repo verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck, lint, and test run**

```bash
pnpm typecheck
pnpm lint
cd apps/mobile && npx jest
```

Expected: all green — every workspace package typechecks and lints
clean, and every test file (including this feature's
`destination-filter.test.ts`, `resolve-episode-for-deep-link.test.ts`,
the `bookingInquirySchema` additions to `validation.test.ts`, plus
every pre-existing test) passes.

- [ ] **Step 2: Confirm no stray references to the deleted mock file remain**

```bash
grep -rn "mocks/content\|mockDestinations" apps/mobile/src
```

Expected: no matches.

- [ ] **Step 3: Confirm every new route resolves**

```bash
grep -n "Stack.Screen" "apps/mobile/src/app/(app)/_layout.tsx"
```

Expected: `destination/[slug]`, `destination/[slug]/inquire`, and
`episode/[id]` all present alongside the pre-existing screens.

- [ ] **Step 4: Manual device/simulator verification**

Native map rendering, clustering behavior, video playback, and the
native date picker cannot be exercised in this environment (matches
the carve-out Prompt 8 made for real audio playback). Verify by hand on
a device or simulator with a dev client build:

- Explore tab opens to List view by default; toggling to Map renders
  pins for destinations with coordinates, clustering when zoomed out.
- Tapping a country/category chip filters both the list and the map;
  combining a country and a category narrows further (AND, not OR).
- Tapping a destination card or map pin opens its detail screen.
- The detail screen's gallery scrolls; tapping a video thumbnail opens
  the video modal and plays with native controls; backdrop tap closes it.
- "Plan Your Visit" opens the Booking Inquiry form as a guest (no
  sign-in prompt); submitting with valid data shows the confirmation
  message; a row appears in `booking_inquiries` (verify via Supabase
  dashboard or SQL).
- `villagefireside://destination/{slug}` and `villagefireside://series/{id}`
  (test via `xcrun simctl openurl booted <url>` on iOS or
  `adb shell am start -a android.intent.action.VIEW -d <url>` on
  Android) open the correct screen.
- `villagefireside://episode/{id}` opens the series detail screen with
  that specific episode already playing.

- [ ] **Step 5: Final commit if anything was fixed during verification**

Only if Steps 1–3 required a fix:

```bash
git add -A
git commit -m "Prompt 11: verification fixes"
```
