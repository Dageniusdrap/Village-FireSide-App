# Database Schema

Every table lives in the `public` schema of the project's one Supabase
Postgres database. Migrations that created this schema are in
`supabase/migrations/`, applied by hand via the Supabase Studio SQL
editor — see `docs/architecture.md` for why.

## Enums

| Enum               | Values                                                      | Used by                         |
| ------------------ | ----------------------------------------------------------- | ------------------------------- |
| `user_role`        | `listener`, `teacher`, `guide`, `admin`                     | `profiles.role`                 |
| `episode_status`   | `draft`, `review`, `published`, `archived`                  | `episodes.status`               |
| `access_tier`      | `free`, `coins`, `premium`                                  | `episodes.access_tier`          |
| `content_language` | `en`, `lg`, `sw`, `fr`, `rw`                                | `episodes.language`             |
| `inquiry_status`   | `new`, `contacted`, `closed`                                | `booking_inquiries.status`      |
| `transaction_type` | `coin_purchase`, `episode_unlock`, `subscription`, `refund` | `transactions.transaction_type` |

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
| `role`                     | `user_role`, default `listener` | Can only change via the service role — see "Protected columns".                            |
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

| Column                     | Type                              | Notes                                                                                                        |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`                       | `uuid`, PK                        |                                                                                                              |
| `series_id`                | `uuid`, not null, FK → `series`   | Deleting a series deletes its episodes.                                                                      |
| `title`, `description`     | `text`                            | `title` not null, `description` nullable.                                                                    |
| `episode_number`           | `int`, not null                   | Required so the uniqueness rule below is actually enforceable (a null value wouldn't collide with anything). |
| `audio_url`                | `text`, nullable                  | Not set while an episode is still in `draft`.                                                                |
| `duration_seconds`         | `int`, nullable                   | Known once audio is uploaded/processed.                                                                      |
| `status`                   | `episode_status`, default `draft` | Gates public visibility.                                                                                     |
| `access_tier`              | `access_tier`, default `free`     | Whether listening requires coins or premium.                                                                 |
| `coin_price`               | `bigint`, default `0`             | Whole coins, never a fraction.                                                                               |
| `language`                 | `content_language`, default `en`  |                                                                                                              |
| `published_at`             | `timestamptz`, nullable           |                                                                                                              |
| `created_at`, `updated_at` | `timestamptz`                     |                                                                                                              |

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
