# Admin Dashboard Core: Content Management (Prompt 14) — Design Spec

## Scope

Per `docs/PROMPT_PACK.md`'s Prompt 14 — the admin dashboard's first real
content-management surface, built as one spec and one plan (matching
this project's own precedent of treating one `PROMPT_PACK.md` prompt as
one design/plan/implementation unit even when it spans multiple
subsystems, e.g. Prompt 13B):

- **Layout** — sidebar navigation and a top bar, wrapping every
  authenticated admin page.
- **Series management** — full CRUD with search/filter, cover image
  upload, featured/publish toggles.
- **Episode management** — full CRUD including audio upload with
  client-detected duration, contributor linking, and a publish-time
  validation guard (audio present, elder-testimony consent, title/
  description present).
- **Destination management** — full CRUD including a click-to-set map
  pin picker and a reorderable media gallery.
- **`admin_actions` audit log** — every create/update/publish/delete
  across the three entities above is recorded.

**Non-goals (explicitly deferred to Prompt 15 or later, confirmed by
reading `apps/admin/src`, which currently has only auth scaffolding —
`sign-in`, `not-authorized`, `proxy.ts`, and the `teacher-requests`
route — nothing else):**

- **Contributors, Consents, Source Materials, Inquiries full
  CRUD.** These are explicitly Prompt 15's scope per
  `docs/PROMPT_PACK.md`. This prompt's Episode form references existing
  `contributors`/`source_materials` rows (read-only selects) but does
  not build pages to create/edit them. Their sidebar links go to simple
  "Coming in Prompt 15" placeholder pages so navigation doesn't dead-end.
- **Users and Settings pages.** Unscoped in both Prompt 14 and Prompt
  15's text. Sidebar links go to simple "Coming soon" placeholder pages.
- **Video support in the destination media gallery.** The schema's
  `destination_media.media_type` supports `'video'`, but video upload/
  preview is meaningfully more UI work than images (no free inline
  preview) and the prompt text only says "media gallery upload" without
  calling out video specifically. Deferred; tracked in
  `docs/known-issues.md`.
- **Any richer "Dashboard" landing page than basic counts.** Neither
  prompt specifies dashboard content beyond it existing as a sidebar
  item; building more than a minimal overview would be inventing scope.

## New dependencies

- **`leaflet` + `react-leaflet`** — the destination form's map pin
  picker. Chosen over Mapbox GL / Google Maps because neither requires
  an API key or billing account to be configured before the feature
  works at all; OpenStreetMap tiles are free. Leaflet touches `window`
  at import time, so its map component is a client component, loaded
  via `next/dynamic` with `ssr: false`.

No other new dependencies. The media-gallery reorder UI uses plain
move-up/move-down buttons (no drag-and-drop library) — simpler, no new
dependency, and consistent with this codebase's YAGNI-leaning
conventions elsewhere (e.g. no data-grid library for tables; plain
client-side array filtering is used instead, matching
`use-global-search.ts`'s "fetch everything unfiltered at this content
scale" precedent). Audio duration is read client-side via a native
`<audio>` element's `loadedmetadata` event — no server-side
audio-processing library needed.

## Existing patterns this spec extends (read before implementing)

**Server actions:** `apps/admin/src/app/teacher-requests/actions.ts`
already establishes the pattern every new action follows: a
`requireAdmin()` check against the caller's own cookie-scoped session
(a Server Action is its own callable endpoint and gets no protection
from `proxy.ts`'s route matcher, which only guards page navigation),
then a `createServiceRoleClient()` for the actual write, returning an
`ActionResult = { ok: true } | { ok: false; message: string }`.
`requireAdmin()` is currently defined inline in that one file — this
prompt extracts it to `apps/admin/src/lib/require-admin.ts` so every new
action file imports the same one rather than re-implementing it.

**Storage buckets:** `images` (public read, admin read/write/delete) and
`audio-episodes` (admin-only, no public read) already exist with RLS
policies gating on `is_admin()`
(`supabase/migrations/20260722120000_storage_buckets.sql`). No new
bucket migration needed — uploads go through the service-role client in
server actions, which bypasses RLS entirely, but the existing policies
remain correct defense-in-depth if that ever changes.

**Publish-gating rule — source of truth:** `docs/schema.md`'s `consents`
section states this explicitly and this spec treats it as binding: _"an
episode with `content_source = 'elder_testimony'` must have at least one
linked elder contributor (via `episode_contributors`) with a `granted`
`story_recording` consent... enforced in the admin dashboard's publish
action (Prompt 14) — the database does not itself block publishing an
under-consented episode."_ Confirmed with the user: the check requires
`consent_status = 'granted'` specifically, not `granted_with_conditions`
— a conditional grant needs human verification that the conditions are
actually being honored, which an automated check can't do.

## Data model: `admin_actions`

```sql
-- supabase/migrations/<next-timestamp>_admin_actions.sql

create table admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table admin_actions enable row level security;

create policy admin_actions_admin_select
  on admin_actions for select
  using (is_admin());
```

- `entity_id` is a plain `uuid`, **not** a foreign key — it points at
  different tables depending on `entity_type` (`'series'`, `'episode'`,
  `'destination'`), and a single column can't be an FK to more than one
  table. The tradeoff (no referential-integrity checking on this column)
  is accepted deliberately: an audit trail needs to survive the entity
  it describes being deleted later (e.g. an episode's publish history
  stays queryable after the episode itself is gone), so a cascading FK
  would be actively wrong here even if it were possible.
- `admin_id` **is** a real FK to `profiles`, since every action always
  has one real, currently-existing admin actor — no reason not to get
  referential integrity for that column.
- No insert policy: every insert happens exclusively through
  `logAdminAction()`'s service-role client (server actions only, never
  a direct client-side write), so RLS only needs to gate reading the log.
- `action` is free text (`'create'`, `'update'`, `'publish'`,
  `'unpublish'`, `'delete'`), not an enum — matches the schema's own
  precedent of using free text for open-ended categorization fields
  (`series.category`, `episode_contributors.role`) rather than adding an
  enum for every small closed-ish set.

## Audit logging: `logAdminAction()`

A shared helper (`apps/admin/src/lib/log-admin-action.ts`), called by
every create/update/publish/unpublish/delete action right after its
real write succeeds:

```ts
export async function logAdminAction(
  adminId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from("admin_actions")
      .insert({ admin_id: adminId, action, entity_type: entityType, entity_id: entityId, details });
    if (error) {
      console.error("logAdminAction failed:", error);
    }
  } catch (err) {
    console.error("logAdminAction threw:", err);
  }
}
```

**Design decision (confirmed with the user): logging is best-effort and
never fails or rolls back the real write.** `logAdminAction()` swallows
its own errors internally (`console.error`, never throws), so every
caller is simply `await write(); await logAdminAction(...); return {
ok: true };` — no try/catch needed around the logging call itself. If
the real write (e.g. publishing an episode) succeeds but the audit-log
insert fails, the admin still sees success; the gap is only visible via
server logs. This is the standard pattern for audit/observability logs
generally (best-effort relative to the primary operation, not a
two-phase commit with it) — `admin_actions` here is a record-keeping/
accountability trail, not data the app depends on to function, so
failing a real content-management operation over an unrelated logging
table hiccup would be worse UX for no real integrity benefit. The
accepted tradeoff is that a failed log write is a silent gap unless
someone is watching server logs; if `admin_actions` later needs a
stronger guarantee, that would mean a dedicated Postgres RPC per entity
type wrapping both writes in one transaction, not this shared JS helper.

## Layout

`apps/admin/src/app/(dashboard)/` route group holds every authenticated
page; its `layout.tsx` renders the sidebar + top bar around `children`.
`sign-in` and `not-authorized` stay outside this group (already are) —
they shouldn't show the authenticated chrome, and `proxy.ts` already
keeps non-admins off everything else, so this layout doesn't need its
own separate auth check, only a fetch of the current admin's
name/email for the top bar display (via the existing cookie-session
`createClient()`).

Sidebar items and where they go:

| Item             | Route               | This prompt                                           |
| ---------------- | ------------------- | ----------------------------------------------------- |
| Dashboard        | `/`                 | Minimal overview: counts of series/episodes by status |
| Series           | `/series`           | Full CRUD                                             |
| Episodes         | `/episodes`         | Full CRUD                                             |
| Destinations     | `/destinations`     | Full CRUD                                             |
| Contributors     | `/contributors`     | Placeholder: "Coming in Prompt 15"                    |
| Consents         | `/consents`         | Placeholder: "Coming in Prompt 15"                    |
| Source Materials | `/source-materials` | Placeholder: "Coming in Prompt 15"                    |
| Inquiries        | `/inquiries`        | Placeholder: "Coming in Prompt 15"                    |
| Teachers         | `/teacher-requests` | Already exists — added to sidebar                     |
| Users            | `/users`            | Placeholder: "Coming soon"                            |
| Settings         | `/settings`         | Placeholder: "Coming soon"                            |

Top bar: admin's display name/email (right-aligned), sign-out button
(`supabase.auth.signOut()` client-side, then redirect to `/sign-in`).

## Shared UI primitives

`apps/admin/src/components/` — small styling wrappers, not a design
system, introduced because building three full CRUD sections on raw
Tailwind-on-native-elements (the sign-in page's current pattern) would
mean heavy duplication: `Button` (primary/secondary/danger variants,
extending the existing `#1F3B2C` brand color), `TextInput`, `Textarea`,
`Select`, `Checkbox`/`Toggle`, and a `DataTable` shell (headless —
takes columns + rows + a search predicate, renders the table markup;
search/filter state lives in the page that uses it, not the component).

## Series management

- `/series`: server component fetches all series, passes to a client
  `SeriesTable` with a text input filtering on `title`/`category`/
  `slug` client-side (no server round-trip per keystroke — matches this
  app's "fetch everything, filter client-side" precedent at this
  content scale).
- `/series/new`, `/series/[id]/edit`: one shared `SeriesForm` (react-
  hook-form + zod, matching `sign-in`'s pattern):
  - `title` (required)
  - `slug` — auto-generated from `title` via a new `slugify()` util in
    `packages/shared` (kebab-case, strip non-alphanumerics); auto-fills
    on title change until the admin manually edits slug themselves,
    then stops auto-following. Uniqueness is enforced by the DB's
    existing `unique` constraint; a violation surfaces as a form error.
  - `description` (optional textarea)
  - `category` (free text, per the schema's own "free text so new
    categories don't require a migration" design)
  - `destination_id` (optional select, populated from existing
    destinations)
  - cover image upload to `images` — client picks a file; the server
    action uploads it via the service-role client and stores the
    returned public URL in `cover_image_url`
  - `is_featured`, `is_published` toggles
  - `sort_order` is **not** a form field — the prompt's own field list
    for Series doesn't mention it, and the DB default of `0` for every
    row keeps sorting predictable with no admin input needed. If a later
    prompt needs admin-controlled series ordering, that's a small,
    additive form-field change, not something this spec needs to
    pre-build.
- Server actions: `createSeries`, `updateSeries`, `deleteSeries`,
  `toggleSeriesPublish` — publish/unpublish is a dedicated action
  (rather than folded into a general update) since it's the one
  mutation type the audit log most needs to distinguish, matching the
  prompt's explicit "log every create/update/publish/delete." Each logs
  to `admin_actions` with `entity_type: 'series'`.

## Episode management

- `/episodes`: same table+filter pattern, filtering on `title`/
  `series`/`status`.
- `/episodes/new`, `/episodes/[id]/edit`: one shared `EpisodeForm`:
  - `series_id` (required select), `episode_number` (required number —
    the DB's unique constraint on `(series_id, episode_number,
language)` surfaces as a form error on violation, same pattern as
    slug)
  - `title`, `description`
  - `language` (select, `content_language` enum)
  - `access_tier` (select, `access_tier` enum) + `coin_price` (number,
    shown only when `access_tier = 'coins'`)
  - `content_source` (select, `content_source` enum)
  - `subject_area`, `grade_level` (optional selects from their enums),
    `syllabus_topic` (free text)
  - `source_material_id` (optional select from existing source
    materials) — if the selected one has `public_domain_verified =
false`, an inline warning appears under the field ("This source
    material is not yet verified"), per `docs/schema.md`'s "Prompt 14
    warns when an episode links an unverified source." This is a
    non-blocking warning, not a publish gate — unlike the elder-
    testimony/consent rule, the schema doc doesn't say this one blocks
    publishing.
  - Audio upload to `audio-episodes`: duration is read client-side via
    an `<audio>` element's `loadedmetadata` event before upload; the
    server action then uploads via the service-role client and stores
    both `audio_url` and `duration_seconds`.
  - **Contributor linking:** a searchable multi-select against existing
    `contributors` rows (read-only reference — full contributor CRUD is
    Prompt 15's job), each selected contributor paired with a free-text
    `role` input. Saved as a full replace of `episode_contributors` rows
    for this episode (delete existing links, insert the current set) —
    simpler and safe since it's a pure junction table with no other data
    hanging off a link row.
- **Publishing guard:** the Publish button first calls
  `validateEpisodeForPublish` (read-only — checks, writes nothing):
  1. `audio_url` is set
  2. if `content_source = 'elder_testimony'`: at least one linked
     contributor has `contributor_type = 'elder'` **and** a `consents`
     row with `consent_type = 'story_recording'` and `consent_status =
'granted'` (exactly `'granted'`, per the confirmed decision above)
  3. `title` and `description` are both non-empty

  Results render in a confirmation panel — every check shown with a
  pass/fail state and, for failures, a human-readable reason. Only when
  all checks pass does a "Confirm Publish" button appear, calling the
  real `publishEpisode` action (`status = 'published'`, `published_at =
now()`, logged). If any check fails, no publish button is shown at
  all — matching "block with a clear explanation," not just a warning.

- Server actions: `createEpisode`, `updateEpisode`, `deleteEpisode`,
  `validateEpisodeForPublish` (read-only, no log entry — it doesn't
  mutate anything), `publishEpisode`, `unpublishEpisode`.

## Destination management

- `/destinations`: same table+filter pattern.
- `/destinations/new`, `/destinations/[id]/edit`: one shared
  `DestinationForm`. The prompt's own description of this section is
  terser than Series/Episode's explicit field lists ("create/edit with
  map pin picker... media gallery upload... publish toggle"), calling
  out only the harder, non-obvious UI pieces. The form still needs the
  schema's other columns to be editable somewhere, since the admin
  dashboard is the only place they're ever written — including them
  here isn't scope creep, it's the minimum needed for `destinations` to
  be a fully manageable table at all:
  - `name`, `slug` (auto-generated, same `slugify()` util as Series),
    `description`
  - `region`, `district`, `country` (free text)
  - `best_time_to_visit`, `entry_fee_notes`, `safety_notes`,
    `conservation_notes` (free-text textareas)
  - cover image upload to `images`, stored in `cover_image_url` — same
    single-image pattern as Series' cover upload, and genuinely distinct
    from the media gallery below: `cover_image_url` is what the mobile
    app's destinations list and detail-screen header actually render
    (confirmed via `use-destinations.ts`/`use-destination-detail.ts`),
    while `destination_media` rows populate a separate photo gallery.
    Missing this field in an earlier draft of this spec was caught
    during self-review — noting it here since it's an easy field to
    overlook (the prompt text only says "media gallery upload" and
    doesn't call out the cover image separately, but the schema and the
    mobile app both already treat it as its own thing).
  - **Map pin picker:** a Leaflet map (client component, `next/dynamic`
    with `ssr: false`), defaulting to a reasonable center (e.g. Uganda,
    given the app's stated geographic focus) or the destination's
    existing `latitude`/`longitude` when editing. Clicking the map
    places/moves a marker and updates two read-only numeric fields
    driven by the click — not free-typed lat/lng inputs — matching
    "click map to set lat/lng" literally.
  - `is_published` toggle
  - **Media gallery:** upload multiple images to `images`, each
    becoming a `destination_media` row (`media_type = 'image'`,
    optional per-item `caption`, `sort_order` set by position).
    Reordering via move-up/move-down buttons per item updates
    `sort_order` for the affected rows. Per-item delete removes both the
    storage object and the row. (Video deferred — see Non-goals.)
- Server actions: `createDestination`, `updateDestination`,
  `deleteDestination`, `toggleDestinationPublish`,
  `addDestinationMedia`, `reorderDestinationMedia`,
  `deleteDestinationMedia`.

## Global constraints

- Every write goes through a server action using the service-role
  client — never exposed client-side, matching the prompt's explicit
  requirement and the existing `teacher-requests` precedent.
- Every server action checks `requireAdmin()` against the caller's own
  cookie session before touching anything, regardless of what `proxy.ts`
  already does for page navigation (a Server Action is its own callable
  endpoint).
- Every create/update/publish/unpublish/delete action calls
  `logAdminAction()` after a successful write; `validateEpisodeForPublish`
  does not (it mutates nothing).
- Every task must leave `pnpm typecheck` clean.
- New npm dependencies are limited to `leaflet` + `react-leaflet` —
  nothing else.
- Slug generation (`slugify()` in `packages/shared`) is shared between
  Series and Destinations rather than duplicated per form.
