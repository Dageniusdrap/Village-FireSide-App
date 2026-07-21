# Village Fireside — Core Database Schema (Sub-project 2 of 22)

Status: Approved
Date: 2026-07-21

## Context

Sub-project 1 scaffolded the monorepo (`apps/mobile`, `apps/admin`,
`packages/shared`, tooling, CI) with no product features. This sub-project
defines the core Postgres schema for Village Fireside — the tables, enums,
indexes, triggers, and Row Level Security (RLS) policies that every later
sub-project builds on — as hand-applied SQL migrations (per Sub-project 1's
established convention: no Supabase CLI, no Docker, no local Supabase; every
migration is a plain timestamped `.sql` file pasted into the Supabase Studio
SQL editor for the project's one Supabase instance).

## Goals

- All 6 enums and 10 tables from the prompt pack, exactly as specified
  (columns, types, defaults, constraints, uniqueness).
- Indexes on the columns called out for query performance.
- `updated_at` auto-maintained via trigger on every table that has it.
- A `profiles` row is created automatically when a user signs up
  (`auth.users` → `profiles`), since nothing else in this sub-project
  creates one and later sub-projects' RLS assumes it exists.
- RLS enabled and policied on every table, matching the access rules from
  the prompt pack, with two gaps in the prompt pack resolved by this spec
  (see Design → RLS policies).
- `docs/schema.md` and `docs/rls-policies.md` documenting the above in
  plain language.

## Non-goals

- No Supabase Storage buckets or storage policies (audio/image URLs are
  plain `TEXT` columns in this sub-project; the bucket setup and upload
  flow are a later sub-project's concern).
- No actual Supabase project — these migrations are files in the repo;
  applying them to a real project happens outside this sub-project's scope,
  same as Sub-project 1's `.env.example`-only approach.
- No seed data, no application code (mobile/admin screens) that reads or
  writes these tables — that starts in later sub-projects.
- No profile-editing flow, no "public profile" read access for other
  users — `profiles` RLS in this sub-project is owner-only.

## Design

### Migration files

Six files in `supabase/migrations/`, applied in order
(`YYYYMMDDHHMMSS_description.sql`, timestamps assigned sequentially at
implementation time):

1. `_enums.sql` — the 6 enum types
2. `_core_tables.sql` — all 10 tables, foreign keys, CHECK constraints
3. `_indexes.sql` — the indexes listed below
4. `_updated_at_triggers.sql` — shared `set_updated_at()` trigger function,
   attached to every table with an `updated_at` column
5. `_handle_new_user_trigger.sql` — `auth.users` → `profiles` signup trigger
6. `_rls_policies.sql` — `ENABLE ROW LEVEL SECURITY` + policies for every
   table

Splitting by concern (rather than one file per table, or one file total)
keeps each file small, independently reviewable, and independently
re-runnable if one statement fails when pasted into Studio.

### Enums

| Enum               | Values                                                      |
| ------------------ | ----------------------------------------------------------- |
| `user_role`        | `listener`, `teacher`, `guide`, `admin`                     |
| `episode_status`   | `draft`, `review`, `published`, `archived`                  |
| `access_tier`      | `free`, `coins`, `premium`                                  |
| `content_language` | `en`, `lg`, `sw`, `fr`, `rw`                                |
| `inquiry_status`   | `new`, `contacted`, `closed`                                |
| `transaction_type` | `coin_purchase`, `episode_unlock`, `subscription`, `refund` |

### Tables

All primary keys are `UUID`. Unless noted, `UUID` columns that are primary
keys default to `gen_random_uuid()` (built into Postgres 13+, no extension
needed); `profiles.id` has no default — it's supplied by the signup trigger
and equals the `auth.users.id` it mirrors.

**profiles** — `id` PK, references `auth.users`. `display_name` (NOT NULL,
populated by the signup trigger — see Mechanisms), `avatar_url` (nullable),
`role user_role` default `listener`, `country` (nullable),
`coin_balance BIGINT` default 0, `is_premium BOOLEAN` default false,
`premium_expires_at` (nullable), `created_at`, `updated_at`. Money rule:
`coin_balance` is a whole-unit `BIGINT`, never floating point.

**destinations** — `id` PK, `name`, `slug` (unique), `description`,
`region`/`district`/`country`, `latitude`/`longitude DOUBLE PRECISION`,
`best_time_to_visit`/`entry_fee_notes`/`safety_notes`/`conservation_notes`
(text), `cover_image_url`, `is_published` default false, `created_at`,
`updated_at`.

**series** — `id` PK, `title`, `slug` (unique), `description`,
`cover_image_url`, `category` (text — e.g. `lakes`, `forests`, `wildlife`,
`elder_history`, `children`, `hidden_africa`; free text, not an enum, since
the prompt pack didn't provide a closed category list and this needs to be
addable via admin without a migration), `destination_id` (nullable FK →
destinations), `is_published` default false, `sort_order INT`,
`created_at`, `updated_at`.

**episodes** — `id` PK, `series_id` (FK → series, NOT NULL), `title`,
`description`, `episode_number INT`, `audio_url`, `duration_seconds INT`,
`status episode_status` default `draft`, `access_tier access_tier` default
`free`, `coin_price BIGINT` default 0 (whole-unit, never float),
`language content_language` default `en`, `published_at` (nullable),
`created_at`, `updated_at`. `UNIQUE (series_id, episode_number, language)`.

**destination_media** — `id` PK, `destination_id` (FK → destinations, NOT
NULL), `media_url`, `media_type` (text, `CHECK IN ('image','video')`),
`caption`, `sort_order INT`.

**favorites** — `id` PK (surrogate; see Mechanisms for why), `user_id` (FK
→ profiles, NOT NULL), `episode_id`/`series_id`/`destination_id` (each a
nullable FK to its table), `created_at`. `CHECK` that exactly one of the
three target columns is non-null; three partial unique indexes (one per
target type) enforce "favorited once per user per target."

**listening_progress** — `user_id` (FK → profiles), `episode_id` (FK →
episodes), `position_seconds INT`, `completed BOOLEAN` default false,
`updated_at`. `PRIMARY KEY (user_id, episode_id)`.

**unlocks** — `user_id` (FK → profiles), `episode_id` (FK → episodes),
`unlocked_at`. `PRIMARY KEY (user_id, episode_id)`.

**transactions** — `id` PK, `user_id` (FK → profiles, NOT NULL),
`transaction_type transaction_type`, `amount BIGINT` (whole-unit),
`currency` (nullable — coin-only transactions have no fiat currency),
`coins_delta BIGINT` default 0, `reference` (text, payment-provider
reference), `episode_id` (nullable FK → episodes), `created_at`.

**booking_inquiries** — `id` PK, `user_id` (nullable FK → profiles — guest
inquiries have no account), `destination_id` (FK → destinations, NOT
NULL), `name`, `phone`, `email` (nullable), `message`, `preferred_date`
(nullable `DATE`), `status inquiry_status` default `new`, `created_at`.

### Indexes

`episodes(series_id, status)`, `episodes(access_tier)`,
`series(category, is_published)`, `destinations(country, is_published)`,
`listening_progress(user_id)`, `transactions(user_id, created_at)`,
`booking_inquiries(status)` — as specified in the prompt pack.

### Mechanisms

**`favorites` surrogate key.** Postgres primary keys can't contain NULLs,
and all three target columns are individually nullable (only one is set
per row), so a composite PK across them doesn't work. Fix: a surrogate
`id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, with the CHECK constraint
and three partial unique indexes doing the uniqueness work the prompt pack
asked for.

**`updated_at` trigger.** One shared `set_updated_at()` function
(`NEW.updated_at := now(); RETURN NEW;`), attached via `BEFORE UPDATE`
trigger to every table with an `updated_at` column: `profiles`,
`destinations`, `series`, `episodes`, `listening_progress`.

**Signup trigger (`auth.users` → `profiles`).** An `AFTER INSERT` trigger
on `auth.users` calls a `SECURITY DEFINER` function that inserts a matching
`profiles` row. Since `profiles.display_name` is `NOT NULL` but Supabase
Auth doesn't guarantee a display name at signup, the function falls back:
`COALESCE(raw_user_meta_data->>'display_name', raw_user_meta_data->>'full_name',
split_part(email, '@', 1), 'New Listener')`. `role` defaults to `listener`,
`coin_balance` to 0, matching the table defaults.

**Protecting `coin_balance` / `is_premium` / `role`.** RLS policies grant
row _access_, not column-level write restriction, so "owner can update
their row but not these three columns" is enforced by a `BEFORE UPDATE`
trigger (`prevent_protected_profile_changes()`) that raises an exception if
any of the three differ between `OLD` and `NEW`, unless the request is
running as `service_role` (`auth.role() = 'service_role'`). This is a hard
backstop independent of which RLS policy let the `UPDATE` through.

**`is_admin()` helper.** Several tables' RLS needs an "admin role has full
access" check. Querying `profiles` directly from another table's RLS
policy is fine, but `profiles` also has RLS enabled on itself, and admin
policies elsewhere may run in contexts where recursion risk is worth
designing out up front. `is_admin()` is a `SECURITY DEFINER`, `STABLE` SQL
function (`SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND
role = 'admin')`) — it runs with the function owner's privileges, so its
internal query isn't subject to the calling policy's own RLS evaluation.
Every "admin full access" policy below calls `is_admin()`.

### RLS policies

| Table                             | Policy                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`                        | Owner SELECT/UPDATE (`auth.uid() = id`). Protected columns blocked by trigger, not RLS. No cross-user SELECT.                                                                                                                                                                                   |
| `destinations`, `series`          | Public (`anon`+`authenticated`) SELECT where `is_published = true`. `is_admin()` — full SELECT/INSERT/UPDATE/DELETE.                                                                                                                                                                            |
| `episodes`                        | Same pattern, gated on `status = 'published'` instead of a boolean.                                                                                                                                                                                                                             |
| `destination_media`               | Public SELECT where the parent `destinations.is_published = true` (subquery on `destination_id`). `is_admin()` — full access. _(Not specified in the prompt pack; resolved to mirror its parent table, consistent with the rest of the content tables.)_                                        |
| `favorites`, `listening_progress` | Full CRUD (SELECT/INSERT/UPDATE/DELETE) restricted to `auth.uid() = user_id`. _(Prompt pack said "owner only" without narrowing to specific commands; read as full ownership since both are user-mutable state — add/remove a favorite, update playback position.)_                             |
| `unlocks`, `transactions`         | SELECT restricted to `auth.uid() = user_id`. No INSERT/UPDATE/DELETE policy for `anon`/`authenticated` at all — omitted deliberately rather than written as always-false, since Supabase's `service_role` bypasses RLS by default, so "INSERT only via service role" falls out of the omission. |
| `booking_inquiries`               | INSERT open to everyone (`anon`+`authenticated`, `WITH CHECK (true)`) — guest inquiries allowed. SELECT/UPDATE restricted to `is_admin()`.                                                                                                                                                      |

### Documentation

- `docs/schema.md` — every table's purpose, columns, types, defaults, and
  FK relationships, in plain language (not a copy of the DDL).
- `docs/rls-policies.md` — every policy, which role(s) it applies to, and
  why — including explaining the two prompt-pack gaps this spec resolved
  (`destination_media`, and the "owner only" commands for `favorites`/
  `listening_progress`) and why `unlocks`/`transactions` have no INSERT
  policy at all.

## Verification

- Every migration file is valid, one-time-applied SQL (no syntax errors;
  no `IF NOT EXISTS` guards needed since these aren't re-run scripts).
- If a local `psql`/Postgres binary is available in the implementation
  environment, run each file through `psql -f` (against a disposable local
  database) as a best-effort syntax check, in order — but this is not a
  hard requirement: per Sub-project 1's explicit no-Docker/no-local-Supabase
  constraint, standing up Postgres locally is out of scope, and the
  authoritative test is applying the files by hand to the real project via
  the Supabase Studio SQL editor, outside this sub-project.
- `docs/schema.md` and `docs/rls-policies.md` exist and describe every
  table/policy actually created.

## Out of scope for this sub-project

Supabase Storage buckets/policies, seed data, any application code that
reads or writes these tables, auth UI/onboarding flows, a public
profile-read policy, and category becoming an enum (kept as free text —
see Design → Tables → series).
