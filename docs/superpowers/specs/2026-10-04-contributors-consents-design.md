# Contributors & Consents (Prompt 15A) — Design Spec

## Scope

`docs/PROMPT_PACK.md`'s Prompt 15 is split in two, each with its own spec,
plan and PR. This spec covers **15A**; 15B (inquiries, teacher-request
logging, dashboard home stats and chart, notification composer) gets its
own spec later.

15A delivers:

- **Contributors**: list, create/edit (all fields, photo upload, anonymous
  toggle), detail page with linked episodes and consent history.
- **Consents**: append-only consent records with signed-agreement upload,
  revoke, and void; every consent write re-checks and hides affected
  published episodes in one transaction.
- **Source materials**: CRUD, with a publish-time acknowledgement when an
  episode links an unverified source.
- **Contributor photos** in a private bucket, served to the app only through
  short-lived signed links that re-check consent on every request.
- **Publishing integrity**: one SQL publish check, publish and unpublish as
  database functions, and triggers that stop any other write from leaving a
  published episode that fails the check.
- **Fixes carried from Prompt 14 QA**: orphaned storage files, `published_at`
  semantics, dashboard counts shown as "0" on error, the raw error when
  linking the same contributor twice.
- **Test infrastructure**: local Supabase in Docker with pgTAP, plus a Node
  integration-test package, both running in CI.

Prerequisites already done on branch `admin-operations`: EAS project linked
(`@dradriga/village-fireside`); `docs/known-issues.md` records the CDN
decision and the offline-download consent gap.

### Non-goals (15A)

- Removing downloaded episodes after a revocation (sized below, not built).
- Guest rate limiting on the photo function (deferred to Prompt 18).
- Push delivery testing (needs a development build and Firebase).
- Everything in 15B.
- A sweep for orphaned files created before 15A (storage is empty today).

## Decisions (agreed during brainstorming, 2026-10-04)

| #   | Decision                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Revoking or otherwise invalidating consent **hides** affected published episodes immediately (status `review`), rather than flagging them while they stay live.                                                                                                                                                                                        |
| D2  | The consent write and the episode hide happen in **one database transaction**; if any part fails, nothing applies.                                                                                                                                                                                                                                     |
| D3  | Consents are **append-only**. A revocation is a new `revoked` row; the original `granted` row is never touched.                                                                                                                                                                                                                                        |
| D4  | A revoked row records a **reason** and **who** revoked it.                                                                                                                                                                                                                                                                                             |
| D5  | Admins cannot edit or delete consent rows. Mistakes are corrected by **voiding**: a record in a separate `consent_voids` table, with a required reason, who, and when. Voided rows stay visible, crossed out, and every check ignores them.                                                                                                            |
| D6  | A void can never make consent more permissive. A `revoked` row can never be voided. A `declined` row can't be voided if the most recent counted row of that type would then be `granted` or `granted_with_conditions`. Restoring consent always needs a new `granted` row with a new signed document.                                                  |
| D7  | Every consent write (add, revoke, void) goes through database functions that share one internal routine for re-check, hide, and audit logging.                                                                                                                                                                                                         |
| D8  | One SQL publish check, used by every caller. The TypeScript copy is removed.                                                                                                                                                                                                                                                                           |
| D9  | Consent functions only hide, never re-publish. Re-publishing is a manual admin action through the publish check.                                                                                                                                                                                                                                       |
| D10 | `published_at` means "currently published since": cleared on unpublish and on consent-triggered hides, set fresh on every publish.                                                                                                                                                                                                                     |
| D11 | Contributor photos live in a private bucket and are served through signed links. A photo is shown only if the contributor isn't anonymous and their most recent counted `photo` consent is exactly `granted`, for every contributor type. `granted_with_conditions` never counts automatically (same rule as the publish check, decided in Prompt 14). |
| D12 | The photo function runs its check on every call, with no caching; guests may call it.                                                                                                                                                                                                                                                                  |
| D13 | Series covers, destination covers and gallery photos stay in the public `images` bucket with one-hour CDN caching.                                                                                                                                                                                                                                     |
| D14 | Database tests run against local Supabase (Docker) with pgTAP, in CI.                                                                                                                                                                                                                                                                                  |
| D15 | A migration-drift check against the live project runs on pushes to `main` and weekly, not on pull requests, with a scoped read-only token if Supabase allows it.                                                                                                                                                                                       |

## Existing patterns this spec extends

- **Server actions with the admin's cookie session**
  (`apps/admin/src/lib/supabase/server.ts`), `requireAdmin()` and
  `logAdminAction()` from Prompt 14. Consent and publish writes move into
  database functions called with the admin's own session (never the
  service-role key), so `auth.uid()` identifies the real admin.
- **`get-episode-audio`**: the model for the photo function (an edge
  function that mints short-lived signed URLs after an access check, and
  accepts guests for free content).
- **Security-definer functions with explicit grants**, including the lesson
  in `known-issues.md` that `revoke ... from public` does not remove `anon`'s
  execute privilege. Every new function revokes from **both** `public` and
  `anon`.
- **`public_contributors` view**: the public projection of contributors,
  filtering anonymous fields and contributors with no published episodes.
- **`DataTable`, `PlaceholderPage`, form primitives** from Prompt 14.

## Data model

All changes are new migrations; nothing edits an applied migration.

### `consents` (existing table, now append-only)

New columns:

| Column                  | Type                                 | Notes                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seq`                   | `bigint`, identity, not null, unique | Recording order. "Most recent" always means highest `seq`, never `created_at` (two rows in one transaction share `created_at`) and never `signed_date` (paper forms can be entered late). Existing rows are backfilled in `created_at, id` order before the identity starts; the live project has 0 rows today. |
| `reason`                | `text`                               | Required when `consent_status = 'revoked'`. Length 1–1000 after trimming when present.                                                                                                                                                                                                                          |
| `recorded_by`           | `uuid` → `profiles`                  | The admin who recorded the row. Required for every row written by the consent function.                                                                                                                                                                                                                         |
| `document_sha256`       | `text`                               | SHA-256 of the stored agreement, computed **server-side** by the admin server action after upload.                                                                                                                                                                                                              |
| `document_storage_etag` | `text`                               | Copied by `record_consent` from `storage.objects.metadata` at record time; written by Supabase storage, so the caller cannot forge it.                                                                                                                                                                          |
| `document_size_bytes`   | `bigint`                             | Copied from `storage.objects` the same way.                                                                                                                                                                                                                                                                     |

`document_url` now holds the object's **path** in the private
`consent-documents` bucket, never a URL.

Append-only enforcement, three layers:

1. The `consents_admin_all` policy is replaced by an admin **select** policy
   only. No role has insert, update or delete through RLS; all writes go
   through the consent functions (security definer).
2. A trigger rejects every `UPDATE` and `DELETE` on `consents`, for all
   roles.
3. `consents.contributor_id` has no cascade, so a contributor with consent
   rows can't be deleted.

### `consent_voids` (new, append-only)

| Column       | Type                            | Notes                             |
| ------------ | ------------------------------- | --------------------------------- |
| `id`         | `uuid` PK                       |                                   |
| `consent_id` | `uuid` → `consents`, **unique** | A consent can be voided once.     |
| `reason`     | `text`, not null                | 1–1000 characters after trimming. |
| `voided_by`  | `uuid` → `profiles`, not null   |                                   |
| `created_at` | `timestamptz`, not null         |                                   |

Same three layers: admin select only, a trigger blocking update and delete,
no cascade. A void is not a consent row, so it can't itself be voided and
never counts as a consent of any type.

### `contributors`

- `photo_url` is renamed to `photo_path`: the object's path in the new
  `contributor-photos` bucket (`contributors/<contributor-id>/<random-id>.<ext>`).
  No existing rows have photos.
- `public_contributors` is recreated **without** any photo column. Its other
  columns and filters are unchanged.

### `episodes`

New columns:

| Column                        | Type                     | Notes                                                      |
| ----------------------------- | ------------------------ | ---------------------------------------------------------- |
| `hidden_by_consent_at`        | `timestamptz`            | Set only by the consent routine when it hides the episode. |
| `hidden_by_consent_action_id` | `uuid` → `admin_actions` | The audit entry for that hide.                             |

Check constraint: both may be non-null only while `status = 'review'`.
`publish_episode` and `unpublish_episode` clear them.

### `storage_cleanup_queue` (new)

| Column                                   | Type                       | Notes                                          |
| ---------------------------------------- | -------------------------- | ---------------------------------------------- |
| `id`                                     | `uuid` PK                  |                                                |
| `bucket_id`                              | `text`, not null           | Check constraint: never `'consent-documents'`. |
| `object_path`                            | `text`, not null           |                                                |
| `source_entity_type`, `source_entity_id` | `text`, `uuid`             | What the file belonged to.                     |
| `last_error`                             | `text`                     |                                                |
| `attempts`                               | `int`, not null, default 1 |                                                |
| `created_at`, `resolved_at`              | `timestamptz`              |                                                |

Admin-only RLS (select, insert, update). Rows are resolved, not deleted.

### Storage

- New private bucket **`contributor-photos`**: admin select, insert and
  delete policies, scoped to the `authenticated` role; no public or `anon`
  access.
- **`consent-documents`** (existing, private): the single
  `consent_documents_admin_all` policy, which applies to every role
  including `anon` and allows every action, is replaced by two policies
  scoped to `authenticated`: admin **select** and admin **insert**. There is
  no update or delete policy, so uploaded agreements are **write-once**:
  the storage API refuses overwrites and deletes. Each upload uses a unique
  path.

### Unchanged

`source_materials`, `admin_actions` (new action names only),
`episode_contributors` (new trigger, see "Publishing integrity").

## Consent writes

### Entry points

```
record_consent(
  p_contributor_id uuid,
  p_consent_type consent_type,
  p_consent_status consent_status,
  p_reason text default null,
  p_conditions text default null,
  p_signed_date date default null,
  p_document_path text default null,
  p_document_sha256 text default null,
  p_witness_name text default null,
  p_session_fee_amount bigint default null,
  p_session_fee_currency text default null,
  p_fee_paid_date date default null
) returns jsonb   -- { consent_id, hidden_episode_ids[] }

void_consent(p_consent_id uuid, p_reason text) returns jsonb
                  -- { void_id, hidden_episode_ids[] }
```

A revoke is `record_consent(..., 'revoked', p_reason => ...)`; the admin
screen's Revoke button calls it. Both functions are `security definer` with
`set search_path = public`, and both call one internal routine,
`apply_consent_change(p_contributor_id, p_action, p_details)`, which does
the re-check, hide and audit. Execute on all three is revoked from `public`
and `anon`; the two entry points are granted to `authenticated`; the
internal routine is granted to nobody.

A read-only companion, `preview_consent_change(...)`, takes the same inputs
and returns the episodes that would be hidden, without writing anything. The
revoke and void dialogs use it. It is security definer and admin-only (the
same `is_admin()` check as step 1), with execute revoked from `public` and
`anon` and granted to `authenticated`.

### Steps (one transaction)

1. **Admin check.** `is_admin()` for `auth.uid()`; otherwise raise. Admin
   screens call these with the admin's session, never the service-role key.
2. **Lock** the contributor row (`select ... for update`). All consent writes
   for one contributor are serialized.
3. **Validate.**
   - `revoked` requires a reason; reasons are 1–1000 characters.
   - `granted` and `granted_with_conditions` require a document.
   - A document path must exist in `consent-documents` (read from
     `storage.objects`); its etag and size are copied onto the row.
   - Void: the target must exist and not already be voided; a `revoked`
     target is refused; a `declined` target is refused if, without it, the
     most recent counted row of that type would be `granted` or
     `granted_with_conditions` (D6).
4. **Write** the consent or void row, with `recorded_by` / `voided_by` =
   `auth.uid()`.
5. **Re-check and hide.** Lock every published episode linked to this
   contributor (`for update`), run `episode_publish_check` on each, and set
   any that now fail to `status = 'review'`, `published_at = null`,
   `hidden_by_consent_at = now()`, `hidden_by_consent_action_id` = the audit
   entry from step 6.
6. **Audit.** One `admin_actions` entry: `consent_add`, `consent_revoke` or
   `consent_void`, with details `{ contributor_id, consent_id | void_id,
consent_type, consent_status, hidden_episode_ids }`. Reasons, witness
   names and fees stay on the row and are not copied into the log.
7. **Return** the new ID and the hidden episode IDs.

Any error raises and rolls back the whole transaction. The routine never
re-publishes (D9).

**Lock order** everywhere: contributors (ascending id), then episodes. This
is what lets the consent functions and `publish_episode` run concurrently
without deadlocking.

## The shared publish check

```
episode_publish_check(p_episode_id uuid)
  returns table(key text, label text, passed boolean, blocking boolean, reason text)
```

The only implementation. Called by `publish_episode`, by
`apply_consent_change`, by the protective triggers, and by the admin's
publish panel (through `publish-actions.ts`). `checkPublishRequirements`
and its TypeScript tests are deleted; their cases move to pgTAP.

| Key                 | Passes when                                                                                                                                               | Blocking         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `audio`             | `audio_url` is non-blank                                                                                                                                  | Yes              |
| `title_description` | title and description are non-blank after trimming                                                                                                        | Yes              |
| `elder_consent`     | `content_source <> 'elder_testimony'`, or at least one linked contributor of type `elder` has `latest_counted_consent(id, 'story_recording') = 'granted'` | Yes              |
| `source_material`   | no source material, or it is `public_domain_verified`                                                                                                     | **No** (warning) |

Shared helper: `latest_counted_consent(p_contributor_id, p_type) returns
consent_status`, the status of the highest-`seq` non-voided row, or null.
Both the publish check and the photo check use it.

The check runs with the caller's permissions (`security invoker`). Admins
can read everything; anyone else can't read consents, so the elder check
fails for them. Execute is revoked from `public` and `anon`.

## Publishing integrity

### `publish_episode(p_episode_id uuid, p_acknowledge_unverified_source boolean default false)`

Security definer, admin-only, one transaction:

1. Lock the episode's linked contributors (ascending id), then the episode.
2. Run `episode_publish_check`. Any failing blocking check, refuse with the
   failures.
3. If the `source_material` warning fails and the flag is false, refuse with
   a dedicated error code; the admin screen shows "[title] isn't verified as
   public domain. Publish anyway?" and retries with the flag on.
4. Set a transaction-local flag (`set_config('app.publishing_episode', id,
true)`), then `status = 'published'`, `published_at = now()`, and clear
   `hidden_by_consent_*`.
5. Audit `publish`, including `acknowledged_unverified_source` and the
   source material ID when acknowledged.

### `unpublish_episode(p_episode_id uuid)`

Security definer, admin-only: `status = 'draft'`, `published_at = null`,
clear `hidden_by_consent_*`, audit `unpublish`. Works from `published` and
from `review`.

### Protective triggers

| Write                                                                                 | Rule                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Any update or insert making `status = 'published'`                                    | Refused unless `app.publishing_episode` matches the row (only `publish_episode` sets it). Closes today's gap where any admin session could set `published` directly through the `episodes_admin_all` policy. |
| Update on a published episode (`content_source`, `title`, `description`, `audio_url`) | After the change, re-run the check; refuse if any blocking check fails.                                                                                                                                      |
| `audio_url` change on a published `elder_testimony` episode                           | Always refused: new audio may not be covered by existing consent. Unpublish first.                                                                                                                           |
| Delete or update on `episode_contributors` for a published episode                    | Lock the episode row, re-run the check, refuse if it fails.                                                                                                                                                  |
| `contributors.contributor_type` change                                                | Re-check every published episode linked to the contributor; refuse if any fails.                                                                                                                             |

Refusal message: "This change would make a published episode fail its
publish check. Unpublish it first." Consent writes are the exception: they
hide instead of refusing (D1).

**Seed data (Prompt 19)** must publish through `publish_episode`; the
trigger refuses anything else.

## Contributor photos

### Visibility

`contributor_photo_status(p_contributor_id) returns text`: `visible`,
`anonymous`, `no_photo`, `no_consent`, `consent_revoked`,
`conditions_unverified`, or `consent_declined`. A photo is visible only
when the contributor isn't anonymous, `photo_path` is set, and
`latest_counted_consent(id, 'photo') = 'granted'`. Admin-only; drives the
admin badges.

`contributor_photo_paths(p_ids uuid[]) returns table(contributor_id uuid,
photo_path text)`: one row per **visible** contributor, evaluated fresh per
id on every call. Execute revoked from `public`, `anon` and
`authenticated`, and granted only to `service_role`; only the photo
function calls it.

### `get-contributor-photos` edge function

- `POST { contributorIds: string[] }`.
- Validation: 1 to `MAX_IDS = 50` ids, each a UUID, de-duplicated; otherwise 400.
- Calls `contributor_photo_paths`, then `createSignedUrls` with
  `PHOTO_LINK_TTL_SECONDS = 3600` (a single constant).
- Response `{ photos: { [contributorId]: { url, cacheKey } } }`. Contributors
  that fail are absent; no reason is given. `cacheKey` is derived from the
  photo's random file id and reveals neither the contributor nor the path.
- `Cache-Control: no-store`. No caching anywhere in the function.
- **Guests may call it.** Guests already browse contributors in guest mode,
  and `public_contributors` is readable by `anon`. The function only returns
  links that passed the consent check, which may be shown to anyone using
  the app. Abuse is bounded by the id cap and the link lifetime; rate
  limiting is deferred to Prompt 18 (shared mobile-carrier IPs in Uganda
  make per-IP limits block real listeners).

### Admin

- Upload resizes to at most 512 px wide before uploading.
- Replacing a photo: save the new path, then delete the old file; a failed
  delete goes to `storage_cleanup_queue`.
- Deleting a contributor deletes the photo file (queued on failure).
- Admin screens show photos to admins through short-lived links made with
  the admin's own session, with the visibility badge:
  - "Hidden from app: contributor is anonymous"
  - "Hidden from app: no photo consent recorded"
  - "Hidden from app: the photo consent was revoked"
  - "Hidden from app: the photo consent was declined"
  - "Hidden from app: consent was granted with conditions. The photo stays
    hidden until someone verifies the conditions and records a plain granted
    consent."

### Mobile

- `useContributorPhotos(ids)`: one batched request per screen; refetches on
  screen focus, when the app returns to the foreground, and before the
  hour runs out.
- A photo renders **only if the current response includes a link** for that
  contributor; otherwise the existing placeholder, even if an image is in
  memory.
- `expo-image` with `cachePolicy="memory"` and the returned `cacheKey`, so
  contributor photos are never written to disk. (`expo-image` 57 has no
  single-entry eviction, only whole-cache clears, so keeping photos off
  disk is the reliable option.)
- Screens changed: contributor detail, Home contributors section, cultural
  group detail, destination detail. `PublicContributor.photoUrl` is replaced
  by the hook's result.

### Every query that touches contributors

| Where                                                    | Query                                                                  | Change                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| Mobile `use-contributor-detail`                          | `public_contributors` (incl. photo), `episode_contributors → episodes` | Photo via hook          |
| Mobile `use-cultural-group-detail`                       | `contributor_cultural_groups → public_contributors` (incl. photo)      | Photo via hook          |
| Mobile `use-destination-detail`                          | `public_contributors` (incl. photo)                                    | Photo via hook          |
| Mobile `use-home-sections`                               | `public_contributors` (incl. photo)                                    | Photo via hook          |
| Mobile `use-global-search`                               | `public_contributors (id, display_name)`                               | None                    |
| Mobile `use-episode-contributor` (Now Playing "Told by") | `episode_contributors → public_contributors (display_name)`            | None                    |
| Mobile `types/content.ts`                                | `PublicContributor.photoUrl`                                           | Replaced                |
| Admin `load-episode-form-options`                        | `contributors (id, display_name, contributor_type)`                    | None (admin only)       |
| Admin `publish-actions.ts`                               | `episode_contributors`, `contributors`, `consents`                     | Replaced by SQL check   |
| Admin `episodes/actions.ts`, `episodes/[id]/edit`        | `episode_contributors` reads and writes                                | Duplicate-link handling |

Database paths: `contributors` is admin-only by RLS; `public_contributors`
(readable by `anon` and `authenticated`, runs as its owner) loses its photo
column; `episode_contributors` and `contributor_cultural_groups` expose only
published-content rows and have no photo column.

## Admin screens

All writes are logged in `admin_actions`, by the database functions or by
`logAdminAction`.

### Audit redaction

Contributor create and edit entries record `changed_fields` (names). Values
are recorded only for non-sensitive fields. **`full_name`, `phone`,
`approximate_birth_year` and `village` are always name-only**, regardless of
anonymity. `display_name` keeps its value.

### Contributors (`/contributors`)

- **List**: search by name, filter by type; columns for display and full
  name, type, anonymous badge, photo visibility badge, latest
  `story_recording` and `photo` status, linked-episode count.
- **Create/edit**: all fields (full and display name, type, anonymous, bio,
  village, district, country, approximate birth year, phone, deceased) and
  photo upload.
- **Detail** (`/contributors/[id]`): profile, photo with badge, linked
  episodes with status (hidden-by-consent episodes say so), consent
  history.
- **Delete**: only with no consent rows and no linked episodes. Each blocked
  case explains why ("This contributor has consent records, which are
  permanent." / "Unlink this contributor from its episodes first.").

### Consent history (contributor page)

- Grouped by type, in `seq` order: status, conditions, signed date, witness,
  fee, document with verification state, recorded by, reason.
- Voided rows crossed out with void reason, admin and time.
- Document verification on open: the server downloads the file, recomputes
  SHA-256 and compares it with `document_sha256` and the storage snapshot:
  "Verified", "File has changed since it was recorded", or "File missing".

### Consent actions

- **Add consent**: type, status, conditions, signed date, witness, fee
  amount and currency, fee paid date, document (required for `granted` and
  `granted_with_conditions`). The form states "Uploaded agreements can't be
  replaced or deleted." A `granted_with_conditions` **photo** consent shows:
  "This photo will stay hidden in the app until someone verifies these
  conditions and records a plain granted consent."
- **Revoke**: offered when the latest counted row of a type is `granted` or
  `granted_with_conditions`. Reason required; the dialog previews the
  published episodes that will be hidden (`preview_consent_change`); the
  result says how many were hidden.
- **Void**: offered only on rows the database would allow (never revoked
  rows; declined rows only when D6 permits). Reason required, effect
  previewed.

### Consents (`/consents`)

All consent rows, linking to their contributor. **Default: full history**,
including voided and superseded rows; "Latest per contributor only" is an
opt-in filter. Filters: type, status. Revoke and void reasons are shown
(long ones truncated with expand). Voided rows crossed out.

### Source materials (`/source-materials`)

List and create/edit: title, author, year, verified checkbox, verification
notes, source URL. Delete warns how many episodes link to it (those links
are set to null by the existing foreign key).

### Episodes

- The source dropdown marks unverified sources; publishing shows the
  acknowledgement dialog.
- **"Hidden because consent changed" banner**: shown only when `status =
'review'` and `hidden_by_consent_at` is set, with the date, a link to the
  contributor, and the **live publish checklist** from
  `episode_publish_check`, so the admin sees what's still missing. Episodes
  in review for any other reason don't show it.

### Settings (`/settings`)

**Storage cleanup** panel: pending `storage_cleanup_queue` entries with
**Retry** (logged). A retry that finds the file already gone marks the entry
resolved.

## Fixes

- **Orphaned files**: `deleteEpisode`, `deleteSeries` and `deleteDestination`
  collect file paths (audio; series cover; destination cover plus every
  gallery photo, public URLs converted to paths), delete the row, then
  delete the files. Failed file deletes go to `storage_cleanup_queue`. Rows
  are deleted first because a row pointing at a missing file is worse than
  an orphaned file. Replacing a series or destination cover or episode audio
  deletes the old file the same way.
- **`published_at`**: per D10, implemented by `publish_episode`,
  `unpublish_episode` and the consent routine.
- **Dashboard counts**: each of the four counts checks its own error and
  shows "—" with "Couldn't load" instead of 0. Minimal, since 15B rebuilds
  the dashboard.
- **Linking a contributor twice**: the linker refuses a contributor and role
  pair already in the list ("[name] is already linked as [role]."); the
  server action maps Postgres `23505` to the same message.

## Offline downloads after a revocation (sized, not built)

Recorded as PRIORITY in `known-issues.md`. What the app could do at next
sync:

1. On app start, return to the foreground, and connectivity returning
   (throttled, e.g. at most once an hour), read the downloaded episode ids
   from `downloads.db`.
2. Query `episodes` for those ids. RLS already returns only published rows,
   so no backend change is needed.
3. Only on a **successful** response, remove every downloaded id the server
   didn't return, using `download-queue-store`'s existing `remove()`. A
   failed request or offline device removes nothing.
4. Stop playback if the removed episode is playing, and show a short notice.

Size: mobile only, about 4–6 plan tasks and about 200 lines plus tests. It
doesn't change Prompt 10's rule that premium downloads keep playing after a
subscription lapses, because a lapse doesn't change an episode's status. A
phone that never comes back online keeps the file; that can't be closed
without DRM.

## Testing

### Harness first

The first implementation task sets up the harness alone, with one trivial
passing pgTAP test, so setup problems surface separately from consent logic:
`supabase/tests/`, `supabase test db` locally, and the CI job.

### pgTAP (`supabase/tests/`)

- **Consent functions**: add, revoke, void; D6 permissiveness rules
  (revoked void refused; declined void refused when it would restore a
  grant, allowed otherwise); reason length (1000 passes, 1001 fails, blank
  fails); document required for grants; document path must exist; storage
  snapshot copied; append-only triggers on both tables; hiding sets
  `review`, clears `published_at`, sets `hidden_by_consent_*`, writes one
  audit entry listing the hidden episodes; never re-publishes.
- **Publish check**: the five Prompt 14 browser scenarios (no contributor;
  elder without consent; wrong-type and declined consents; `granted`; newer
  `revoked`), void of the only `granted` row (fails), void of a newer
  `declined` restoring an older `granted` (passes), two rows in one
  transaction (`seq` decides), unverified source (warning, not blocking).
- **Publishing integrity**: `publish_episode` including the acknowledgement
  flow and its audit detail; direct update to `published` refused; insert as
  `published` refused; `unpublish_episode`; the `hidden_by_consent_*` check
  constraint; each protective trigger in the table above.
- **Photo visibility**: granted then newer revoked; anonymous; no photo
  consent; `granted_with_conditions` only; voided consent; plus the visible
  case.
- **Access**, as `anon` and as an authenticated non-admin: every new function
  refused (`anon` gets "permission denied"); no `photo_path` readable through
  any table, view or function (including a catalogue scan of executable
  functions); no listing of `contributor-photos`; `consent-documents`
  select, insert, update and delete all refused; admin select and insert
  allowed, admin update and delete refused.
- **Audit redaction**: creating and editing a contributor leaves no
  `full_name`, `phone`, `approximate_birth_year` or `village` value in any
  `admin_actions.details`.
- **Cleanup queue**: an entry for `consent-documents` is refused.

### Migration on existing data

CI resets the local database to the last pre-15A migration
(`20260926100000`), loads fixtures shaped like the live project (three test
accounts with admin, teacher and listener roles; `admin_actions` entries of
each existing type; a published `elder_testimony` episode with no consent),
applies the 15A migrations, and asserts: no rows lost or changed; new
constraints and triggers hold; the legacy episode was **not** hidden or
altered (migrations never hide retroactively). A follow-up query lists
published episodes that would fail the check, for an admin to handle.

### Integration tests (`packages/db-integration-tests`, Vitest, local stack)

- **Concurrency**: publish vs revoke forced in both orders (one holds its
  locks while the other starts); publish vs unlink; and a stress run of
  exactly **50 rounds** firing publish and revoke together. Every round must
  satisfy the invariant (never `published` while the latest counted
  `story_recording` is not `granted`) and must not fail with `40P01`
  (deadlock), whatever the interleaving. No timing assertions: the only
  limits are hang guards (30 s statement timeout, 5 min test timeout), so
  slow CI takes longer but cannot fail for being slow. A failure names the
  round and order and is treated as a real race, never retried.
- **Photo function, end to end**: the five photo cases, 51 ids → 400,
  malformed UUIDs → 400, a guest call succeeding, `Cache-Control: no-store`.
- **Agreement fingerprints**: upload and record, both fingerprints match;
  overwrite the file with the service role, verification reports "changed";
  remove it, verification reports "missing".

### Admin unit tests (Vitest)

Duplicate-link message (UI and `23505` mapping); audit redaction helper;
cleanup retry (already-gone counts as resolved); dashboard counts showing
"—" on error.

### Mobile tests (Jest)

`useContributorPhotos`: renders a photo only when the current response has
its link; refetches on focus and on return to foreground.

### Manual checks (development-build session, not 15A)

- **Photos never reach disk**: open several contributor pages on a debug
  build, list the app's image cache directory (`adb shell run-as`), and
  confirm no contributor photo files appear; as a control, open a series
  page and confirm its cover does appear there.

### Browser QA (end of 15A)

After the migrations are applied to the live project, repeat the Prompt 14
style browser pass with the test accounts: add, revoke and void consents
and watch episodes hide; the banner and checklist; photo badges; agreement
verification; source-material acknowledgement; delete flows and the cleanup
panel. Remove QA data afterwards.

## CI

- **`db-tests` job**: install the Supabase CLI, `supabase start` excluding
  services the tests don't use (Studio, logs, mail, realtime, image proxy),
  cache Docker images keyed by the CLI version, then run pgTAP, the
  migration-on-existing-data test, and the integration tests. The measured
  time added per PR is reported once it runs.
- **Migration drift check**: a separate workflow on pushes to `main` and
  weekly (cron), never on pull requests. It compares `supabase migration
list --linked` with the repo's migration files. It first tries a token
  scoped to this project with read-only permissions; the plan confirms that
  works before relying on it, and reports exactly which permission is missing
  if it doesn't. Exact steps for creating the token and adding GitHub secrets
  are given at that task.

## Rollout

The plan ends with `supabase db push` to apply the 15A migrations to the
live project, **only after the user approves that step**, followed by the
browser QA pass.

## Known limitations (added to `known-issues.md`)

- **Legal erasure**: consent rows can't be deleted from the admin, so an
  erasure request for a contributor's personal data needs a deliberate,
  reviewed developer migration.
- **Wrong uploaded agreement**: stays in `consent-documents` as an orphan;
  the consent row is voided instead.
- **Hidden photos remain stored**: photo files stay in the private bucket
  when a contributor becomes anonymous or loses photo consent; only the
  function refusing to issue a link hides them.
- **Photo in a phone's memory**: a photo already shown can stay in that
  app's memory cache until the app restarts (never on disk).
- **Guest rate limiting** on `get-contributor-photos`: deferred to Prompt 18.
- **Fingerprint trust**: `document_sha256` comes from the admin server
  action, so an admin calling `record_consent` directly could supply a false
  value; the storage etag snapshot is the value the caller can't forge.
- **Changes outside the app**: anyone with dashboard or service-role access
  can still alter or remove storage files; fingerprints detect changes and
  missing files but can't prevent them.
