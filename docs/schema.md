# Database Schema

Every table lives in the `public` schema of the project's one Supabase
Postgres database. Migrations that created this schema are in
`supabase/migrations/`, applied by hand via the Supabase Studio SQL
editor — see `docs/architecture.md` for why.

## Enums

| Enum               | Values                                                                         | Used by                         |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------- |
| `user_role`        | `listener`, `teacher`, `guide`, `admin`                                        | `profiles.role`                 |
| `episode_status`   | `draft`, `review`, `published`, `archived`                                     | `episodes.status`               |
| `access_tier`      | `free`, `coins`, `premium`                                                     | `episodes.access_tier`          |
| `content_language` | `en`, `lg`, `sw`, `fr`, `rw`                                                   | `episodes.language`             |
| `inquiry_status`   | `new`, `contacted`, `closed`                                                   | `booking_inquiries.status`      |
| `transaction_type` | `coin_purchase`, `episode_unlock`, `subscription`, `refund`                    | `transactions.transaction_type` |
| `contributor_type` | `elder`, `voice_artist`, `writer`, `tour_guide`, `historian`, `translator`     | `contributors.contributor_type` |
| `consent_type`     | `story_recording`, `voice_cloning`, `photo`, `video`, `translation`, `archive` | `consents.consent_type`         |
| `consent_status`   | `granted`, `granted_with_conditions`, `declined`, `revoked`                    | `consents.consent_status`       |
| `content_source`   | `elder_testimony`, `narrated_production`, `ai_assisted`, `tour_guide_original` | `episodes.content_source`       |
| `subject_area`     | `history`, `biology`, `geography`, `culture`, `conservation`, `folklore`       | `episodes.subject_area`         |
| `grade_level`      | `primary`, `o_level`, `a_level`, `tertiary`, `general`                         | `episodes.grade_level`          |

## Tables

### `profiles`

One row per app user, mirroring `auth.users`. Created automatically by
the `handle_new_user()` trigger when someone signs up — see "Automatic
profile creation" below.

| Column                     | Type                            | Notes                                                                                      |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `id`                       | `uuid`, PK                      | Same value as `auth.users.id`.                                                             |
| `display_name`             | `text`, not null                | Falls back to the user's email prefix or "New Listener" at signup if no name was supplied. |
| `avatar_url`               | `text`, nullable                |                                                                                            |
| `role`                     | `user_role`, default `listener` | Can only change via the service role — see `docs/rls-policies.md`.                         |
| `country`                  | `text`, nullable                |                                                                                            |
| `coin_balance`             | `bigint`, default `0`           | Whole coins, never a fraction. Can only change via the service role.                       |
| `is_premium`               | `boolean`, default `false`      | Can only change via the service role.                                                      |
| `premium_expires_at`       | `timestamptz`, nullable         |                                                                                            |
| `created_at`, `updated_at` | `timestamptz`                   | `updated_at` auto-maintained by trigger.                                                   |

### `destinations`

A physical place (a lake, a forest, a historical site) that has stories
told about it and that a visitor might book a trip to.

| Column                                                                        | Type                         | Notes                                                 |
| ----------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| `id`                                                                          | `uuid`, PK                   |                                                       |
| `name`                                                                        | `text`, not null             |                                                       |
| `slug`                                                                        | `text`, not null, unique     | URL-friendly identifier.                              |
| `description`                                                                 | `text`, nullable             |                                                       |
| `region`, `district`, `country`                                               | `text`, nullable             | Free-text location fields.                            |
| `latitude`, `longitude`                                                       | `double precision`, nullable |                                                       |
| `best_time_to_visit`, `entry_fee_notes`, `safety_notes`, `conservation_notes` | `text`, nullable             | Free-text guidance shown to visitors.                 |
| `cover_image_url`                                                             | `text`, nullable             |                                                       |
| `is_published`                                                                | `boolean`, default `false`   | Gates public visibility — see `docs/rls-policies.md`. |
| `created_at`, `updated_at`                                                    | `timestamptz`                |                                                       |

### `series`

A themed collection of episodes (e.g. all the stories about one lake, or
one category like "elder history").

| Column                           | Type                                  | Notes                                                                                                                                                           |
| -------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                             | `uuid`, PK                            |                                                                                                                                                                 |
| `title`                          | `text`, not null                      |                                                                                                                                                                 |
| `slug`                           | `text`, not null, unique              |                                                                                                                                                                 |
| `description`, `cover_image_url` | `text`, nullable                      |                                                                                                                                                                 |
| `category`                       | `text`, nullable                      | Free text (e.g. `lakes`, `forests`, `wildlife`, `elder_history`, `children`, `hidden_africa`) rather than an enum, so new categories don't require a migration. |
| `destination_id`                 | `uuid`, nullable, FK → `destinations` | A series doesn't have to be tied to one destination.                                                                                                            |
| `is_published`                   | `boolean`, default `false`            |                                                                                                                                                                 |
| `sort_order`                     | `int`, default `0`                    | Controls display order; defaults to 0 rather than being nullable so sorting is always predictable.                                                              |
| `created_at`, `updated_at`       | `timestamptz`                         |                                                                                                                                                                 |

### `episodes`

One audio story, belonging to a series.

| Column                        | Type                                                            | Notes                                                                                                        |
| ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`                          | `uuid`, PK                                                      |                                                                                                              |
| `series_id`                   | `uuid`, not null, FK → `series`                                 | Deleting a series deletes its episodes.                                                                      |
| `title`, `description`        | `text`                                                          | `title` not null, `description` nullable.                                                                    |
| `episode_number`              | `int`, not null                                                 | Required so the uniqueness rule below is actually enforceable (a null value wouldn't collide with anything). |
| `audio_url`                   | `text`, nullable                                                | Not set while an episode is still in `draft`.                                                                |
| `duration_seconds`            | `int`, nullable                                                 | Known once audio is uploaded/processed.                                                                      |
| `status`                      | `episode_status`, default `draft`                               | Gates public visibility.                                                                                     |
| `access_tier`                 | `access_tier`, default `free`                                   | Whether listening requires coins or premium.                                                                 |
| `coin_price`                  | `bigint`, default `0`                                           | Whole coins, never a fraction.                                                                               |
| `language`                    | `content_language`, default `en`                                |                                                                                                              |
| `published_at`                | `timestamptz`, nullable                                         |                                                                                                              |
| `content_source`              | `content_source`, default `narrated_production`                 | Whether this episode is elder testimony, a narrated production, AI-assisted, or a tour guide's own account.  |
| `subject_area`, `grade_level` | nullable                                                        | Learn-tab tagging (Prompt 12) — subject and school grade level this episode fits.                            |
| `syllabus_topic`              | `text`, nullable                                                | Free-text syllabus tag for quick filtering in the Learn tab.                                                 |
| `source_material_id`          | `uuid`, nullable, FK → `source_materials`, `ON DELETE SET NULL` | Citation link when this episode narrates a public-domain book.                                               |
| `created_at`, `updated_at`    | `timestamptz`                                                   |                                                                                                              |

Unique on `(series_id, episode_number, language)` — the same episode
number can exist once per language within a series (e.g. episode 3 in
English and episode 3 in Swahili are different rows, but two English
episode 3s in the same series is a data error).

### `destination_media`

Photos/videos attached to a destination, in display order.

| Column           | Type                                  | Notes                                                       |
| ---------------- | ------------------------------------- | ----------------------------------------------------------- |
| `id`             | `uuid`, PK                            |                                                             |
| `destination_id` | `uuid`, not null, FK → `destinations` | Deleting a destination deletes its media.                   |
| `media_url`      | `text`, not null                      |                                                             |
| `media_type`     | `text`, not null                      | Restricted to `'image'` or `'video'` by a CHECK constraint. |
| `caption`        | `text`, nullable                      |                                                             |
| `sort_order`     | `int`, default `0`                    | Same predictable-ordering reasoning as `series.sort_order`. |

### `favorites`

A user bookmarking an episode, series, or destination — exactly one of
the three per row.

| Column                                      | Type                              | Notes                                                         |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| `id`                                        | `uuid`, PK                        | Surrogate key — see "Why favorites has a surrogate id" below. |
| `user_id`                                   | `uuid`, not null, FK → `profiles` |                                                               |
| `episode_id`, `series_id`, `destination_id` | `uuid`, nullable, FK              | Exactly one is set; enforced by a CHECK constraint.           |
| `created_at`                                | `timestamptz`                     |                                                               |

Three partial unique indexes (one per target type) stop the same user
from favoriting the same episode/series/destination twice.

**Why `favorites` has a surrogate id:** a Postgres primary key can't
contain `NULL`, but each of the three target columns is individually
nullable (only one is set per row), so there's no combination of them
that can be a primary key. A separate `id` column sidesteps the problem;
the CHECK constraint and partial unique indexes do the uniqueness
enforcement the design actually needs.

### `listening_progress`

How far a user has gotten into an episode.

| Column             | Type                              | Notes                    |
| ------------------ | --------------------------------- | ------------------------ |
| `user_id`          | `uuid`, not null, FK → `profiles` | Part of the primary key. |
| `episode_id`       | `uuid`, not null, FK → `episodes` | Part of the primary key. |
| `position_seconds` | `int`, default `0`                |                          |
| `completed`        | `boolean`, default `false`        |                          |
| `updated_at`       | `timestamptz`                     |                          |

Primary key is `(user_id, episode_id)` — one progress row per user per
episode.

### `unlocks`

Which coin-priced episodes a user has paid to unlock.

| Column        | Type                              | Notes                    |
| ------------- | --------------------------------- | ------------------------ |
| `user_id`     | `uuid`, not null, FK → `profiles` | Part of the primary key. |
| `episode_id`  | `uuid`, not null, FK → `episodes` | Part of the primary key. |
| `unlocked_at` | `timestamptz`                     |                          |

Rows are only ever written by the service role (server-side, after a
successful coin deduction) — see `docs/rls-policies.md`.

### `transactions`

An audit trail of every coin/money movement: purchases, unlocks,
subscription charges, refunds.

| Column             | Type                                                    | Notes                                                                     |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `id`               | `uuid`, PK                                              |                                                                           |
| `user_id`          | `uuid`, not null, FK → `profiles`                       | No `ON DELETE` cascade — see "Why some foreign keys don't cascade" below. |
| `transaction_type` | `transaction_type`, not null                            |                                                                           |
| `amount`           | `bigint`, not null                                      | Whole units, never a fraction.                                            |
| `currency`         | `text`, nullable                                        | Coin-only transactions (no fiat involved) leave this null.                |
| `coins_delta`      | `bigint`, default `0`                                   | How many coins this transaction added or removed.                         |
| `reference`        | `text`, nullable                                        | Payment provider's reference id, when there is one.                       |
| `episode_id`       | `uuid`, nullable, FK → `episodes`, `ON DELETE SET NULL` | Set for `episode_unlock` transactions.                                    |
| `created_at`       | `timestamptz`                                           |                                                                           |

### `booking_inquiries`

A visitor asking about a trip to a destination — from a logged-in user
or a guest.

| Column                     | Type                                                    | Notes                                   |
| -------------------------- | ------------------------------------------------------- | --------------------------------------- |
| `id`                       | `uuid`, PK                                              |                                         |
| `user_id`                  | `uuid`, nullable, FK → `profiles`, `ON DELETE SET NULL` | Null for guest inquiries.               |
| `destination_id`           | `uuid`, not null, FK → `destinations`                   | No `ON DELETE` cascade — see below.     |
| `name`, `phone`, `message` | `text`, not null                                        | Minimum contact info needed to respond. |
| `email`                    | `text`, nullable                                        |                                         |
| `preferred_date`           | `date`, nullable                                        |                                         |
| `status`                   | `inquiry_status`, default `new`                         |                                         |
| `created_at`               | `timestamptz`                                           |                                         |

**Why some foreign keys don't cascade:** `transactions.user_id` and
`booking_inquiries.destination_id` have no `ON DELETE` clause, which
means Postgres blocks the delete if matching rows exist (the default
`NO ACTION` behavior — nothing extra had to be written to get this).
That's deliberate: financial records and business leads shouldn't
silently disappear because someone deleted a profile or a destination.
In practice this means account deletion (a later sub-project) will need
to anonymize a user's `profiles` row rather than hard-delete it if they
have transaction history, and removing a destination with open
inquiries needs those inquiries handled first.

### `contributors`

The people behind each story: elders, voice artists, writers, tour
guides, historians, translators.

| Column                                  | Type                         | Notes                                                                                           |
| --------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                                    | `uuid`, PK                   |                                                                                                 |
| `full_name`                             | `text`, not null             | Legal/full name — never shown publicly, admin-only.                                             |
| `display_name`                          | `text`, not null             | What `public_contributors` (and the app) shows.                                                 |
| `is_anonymous`                          | `boolean`, default `false`   | When true, `public_contributors` hides everything except `display_name` and `contributor_type`. |
| `contributor_type`                      | `contributor_type`, not null |                                                                                                 |
| `bio`, `village`, `district`, `country` | nullable                     | Descriptive; often incomplete for elderly/historical contributors.                              |
| `photo_url`                             | `text`, nullable             |                                                                                                 |
| `approximate_birth_year`                | `int`, nullable              |                                                                                                 |
| `phone`                                 | `text`, nullable             | Admin-only — never exposed through `public_contributors`.                                       |
| `is_deceased`                           | `boolean`, default `false`   |                                                                                                 |
| `created_at`, `updated_at`              | `timestamptz`                |                                                                                                 |

### `consents`

A record of whether a contributor agreed to a specific use of their
story (recording, voice cloning, photo, video, translation, archive).
This is the table with the most legal weight in the whole schema.

| Column                                                        | Type                                  | Notes                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                          | `uuid`, PK                            |                                                                                                                                                                                |
| `contributor_id`                                              | `uuid`, not null, FK → `contributors` | No `ON DELETE` clause — see "Why some foreign keys don't cascade" below.                                                                                                       |
| `consent_type`                                                | `consent_type`, not null              |                                                                                                                                                                                |
| `consent_status`                                              | `consent_status`, not null            |                                                                                                                                                                                |
| `conditions`                                                  | `text`, nullable                      | Free text, e.g. what a `granted_with_conditions` consent actually permits.                                                                                                     |
| `signed_date`, `document_url`                                 | nullable                              | A `declined` consent has nothing to sign or scan — the database doesn't require these; the admin UI (Prompt 14) is what enforces "a `granted` consent needs both" in practice. |
| `witness_name`                                                | `text`, nullable                      |                                                                                                                                                                                |
| `session_fee_amount`, `session_fee_currency`, `fee_paid_date` | nullable                              | Not every consent session involves a fee.                                                                                                                                      |
| `created_at`                                                  | `timestamptz`                         |                                                                                                                                                                                |

**Publishing rule:** an episode with `content_source = 'elder_testimony'`
must have at least one linked elder contributor (via
`episode_contributors`) with a `granted` `story_recording` consent. This
is enforced in the admin dashboard's publish action (Prompt 14) — the
database does not itself block publishing an under-consented episode.

### `source_materials`

Public-domain books being narrated.

| Column                                                           | Type                       | Notes                                                                                                   |
| ---------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`                                                             | `uuid`, PK                 |                                                                                                         |
| `title`                                                          | `text`, not null           |                                                                                                         |
| `author`, `publication_year`, `verification_notes`, `source_url` | nullable                   | Old public-domain texts don't always have a clean, complete citation.                                   |
| `public_domain_verified`                                         | `boolean`, default `false` | Unverified is the expected starting state — Prompt 14 warns when an episode links an unverified source. |
| `created_at`                                                     | `timestamptz`              |                                                                                                         |

### `episode_contributors`

Junction table linking episodes to the contributors who worked on them,
with a role per link (e.g. "narrator", "translator" — free text, no
enum).

| Column           | Type                                                       | Notes                                                                                |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `episode_id`     | `uuid`, not null, FK → `episodes`, `ON DELETE CASCADE`     | Part of the primary key.                                                             |
| `contributor_id` | `uuid`, not null, FK → `contributors`, `ON DELETE CASCADE` | Part of the primary key.                                                             |
| `role`           | `text`, not null                                           | Part of the primary key — the same episode/contributor pair can have multiple roles. |

Primary key is `(episode_id, contributor_id, role)`.

## `public_contributors` view

A public-facing view over `contributors`, exposing only `id`,
`display_name`, `contributor_type`, and (unless `is_anonymous`) `bio`,
`photo_url`, `district`, `country`. `full_name`, `phone`, `village`,
`approximate_birth_year`, and `is_deceased` are never exposed through
it — only via direct (admin-only) table access. It's a plain view (not
`security_invoker`), so it runs with its owner's privileges rather than
the querying user's, letting `anon`/`authenticated` read this safe slice
of an otherwise admin-only table — the same escape mechanism `is_admin()`
uses via `SECURITY DEFINER`, applied to a view instead of a function.

## Why some foreign keys don't cascade (continued)

`consents.contributor_id` has no `ON DELETE` clause, for the same reason
`transactions.user_id` and `booking_inquiries.destination_id` don't (see
above): it blocks deleting a contributor who has any consent history at
all, protecting the legal record from silent loss.

## Narrated-production labeling rule

Every episode with `content_source` of `narrated_production` or
`ai_assisted` must show a "Narrated production" label in the app UI
(Prompt 6's `SourceBadge` component). This is a UI/content rule, not
something the database enforces.

## Automatic profile creation

A trigger on `auth.users` (`handle_new_user()`, fired `AFTER INSERT`)
creates the matching `profiles` row the moment someone signs up, so
every other table's "owner" policies always have a `profiles` row to
reference. `display_name` falls back through the signup metadata's
`display_name`, then `full_name`, then the part of the email before
`@`, then finally the literal string `"New Listener"` — `profiles.display_name`
is `NOT NULL`, and Supabase Auth doesn't guarantee any of those fields
are present at signup.

## `updated_at` maintenance

`profiles`, `destinations`, `series`, `episodes`, and `listening_progress`
each have a `BEFORE UPDATE` trigger that sets `updated_at = now()` on
every update, using one shared `set_updated_at()` function. Application
code never sets `updated_at` directly — it's always overwritten by the
trigger.
