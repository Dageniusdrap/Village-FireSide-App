# Core Database Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the core Postgres schema (enums, tables, indexes, triggers, RLS policies) as hand-applied SQL migration files in `supabase/migrations/`, plus plain-language documentation in `docs/schema.md` and `docs/rls-policies.md`.

**Architecture:** Six migration files applied in strict order (enums → tables → indexes → `updated_at` triggers → signup trigger → RLS), each independently reviewable and re-runnable. No application code changes — this is pure schema plus docs.

**Tech Stack:** Postgres (via Supabase), raw SQL DDL. No ORM, no Supabase CLI, no Docker (per project convention — see Global Constraints).

## Global Constraints

- Money columns are always `BIGINT` whole units, never floating point (`profiles.coin_balance`, `episodes.coin_price`, `transactions.amount`, `transactions.coins_delta`).
- No Supabase CLI, no Docker, no local Supabase stack — migrations are files in `supabase/migrations/`, applied by hand later via Supabase Studio's SQL editor. Nothing in this plan requires a running Postgres instance to complete.
- Enum and table names, column names, and types must exactly match the design spec (`docs/superpowers/specs/2026-07-21-database-schema-design.md`) unless a task explicitly calls out and justifies a deviation.
- RLS is enabled on every table created in this plan — no table ships without it.
- Every migration file is applied exactly once, in filename order; files are not idempotent (no `IF NOT EXISTS` guards) since re-running isn't the intended usage.

---

### Task 1: Enums migration

**Files:**

- Create: `supabase/migrations/20260721150000_enums.sql`

**Interfaces:**

- Consumes: nothing (first migration).
- Produces: enum types `user_role`, `episode_status`, `access_tier`, `content_language`, `inquiry_status`, `transaction_type` — consumed by Task 2's table columns.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721150000_enums.sql

create type user_role as enum ('listener', 'teacher', 'guide', 'admin');

create type episode_status as enum ('draft', 'review', 'published', 'archived');

create type access_tier as enum ('free', 'coins', 'premium');

create type content_language as enum ('en', 'lg', 'sw', 'fr', 'rw');

create type inquiry_status as enum ('new', 'contacted', 'closed');

create type transaction_type as enum ('coin_purchase', 'episode_unlock', 'subscription', 'refund');
```

- [ ] **Step 2: Verify the file's structure**

There's no live Postgres in this environment to apply the migration
against (per Global Constraints), so verification is a structural check
run against the file text itself.

Run:

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721150000_enums.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert sql.count("create type") == 6, f"expected 6 enum types, found {sql.count('create type')}"
for name in ["user_role", "episode_status", "access_tier", "content_language", "inquiry_status", "transaction_type"]:
    assert f"create type {name} as enum" in sql, f"missing enum: {name}"
print("OK: 6 enums present, parens balanced")
PY
```

Expected: `OK: 6 enums present, parens balanced`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721150000_enums.sql
git commit -m "feat: add enum types migration"
```

---

### Task 2: Core tables migration

**Files:**

- Create: `supabase/migrations/20260721150100_core_tables.sql`

**Interfaces:**

- Consumes: enum types from Task 1 (`user_role`, `episode_status`, `access_tier`, `content_language`, `inquiry_status`, `transaction_type`).
- Produces: tables `profiles`, `destinations`, `series`, `episodes`, `destination_media`, `favorites`, `listening_progress`, `unlocks`, `transactions`, `booking_inquiries` — consumed by Tasks 3–7.

**Nullability note:** where the design spec didn't explicitly mark a
column nullable or NOT NULL, this task applies the professional default:
core identity fields (`name`/`title`/`slug`), required foreign keys, and
any column with a `DEFAULT` are `NOT NULL`; free-text descriptive/optional
metadata is nullable. Two calls beyond the literal spec text, both
documented in Task 7:

- `episodes.episode_number` is `NOT NULL` — the `UNIQUE (series_id,
episode_number, language)` constraint can't do its job if the value can
  be null (Postgres treats every `NULL` as distinct in a unique
  constraint).
- `series.sort_order` and `destination_media.sort_order` default to `0`
  (`NOT NULL DEFAULT 0`) rather than being nullable, so `ORDER BY
sort_order` behaves predictably without `NULLS LAST` handling
  everywhere it's used.

**Foreign-key delete behavior:** content-ownership relationships cascade
(deleting a `series` removes its `episodes`; deleting a `destination`
removes its `destination_media`; deleting a `profiles` row removes its
`favorites`/`listening_progress`/`unlocks`). `transactions.user_id` and
`booking_inquiries.destination_id` intentionally have **no** `ON DELETE`
clause (Postgres default `NO ACTION`) — this blocks deleting a profile
with transaction history or a destination with open inquiries, protecting
financial and business records from silent loss. `series.destination_id`,
`transactions.episode_id`, and `booking_inquiries.user_id` are nullable
FKs with `ON DELETE SET NULL`, since losing the reference is acceptable
there.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721150100_core_tables.sql

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  role user_role not null default 'listener',
  country text,
  coin_balance bigint not null default 0,
  is_premium boolean not null default false,
  premium_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table destinations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  region text,
  district text,
  country text,
  latitude double precision,
  longitude double precision,
  best_time_to_visit text,
  entry_fee_notes text,
  safety_notes text,
  conservation_notes text,
  cover_image_url text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  cover_image_url text,
  category text,
  destination_id uuid references destinations (id) on delete set null,
  is_published boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references series (id) on delete cascade,
  title text not null,
  description text,
  episode_number int not null,
  audio_url text,
  duration_seconds int,
  status episode_status not null default 'draft',
  access_tier access_tier not null default 'free',
  coin_price bigint not null default 0,
  language content_language not null default 'en',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, episode_number, language)
);

create table destination_media (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null references destinations (id) on delete cascade,
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  caption text,
  sort_order int not null default 0
);

create table favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  episode_id uuid references episodes (id) on delete cascade,
  series_id uuid references series (id) on delete cascade,
  destination_id uuid references destinations (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_exactly_one_target check (
    (
      (episode_id is not null)::int
      + (series_id is not null)::int
      + (destination_id is not null)::int
    ) = 1
  )
);

create unique index favorites_user_episode_uidx
  on favorites (user_id, episode_id)
  where episode_id is not null;

create unique index favorites_user_series_uidx
  on favorites (user_id, series_id)
  where series_id is not null;

create unique index favorites_user_destination_uidx
  on favorites (user_id, destination_id)
  where destination_id is not null;

create table listening_progress (
  user_id uuid not null references profiles (id) on delete cascade,
  episode_id uuid not null references episodes (id) on delete cascade,
  position_seconds int not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);

create table unlocks (
  user_id uuid not null references profiles (id) on delete cascade,
  episode_id uuid not null references episodes (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id),
  transaction_type transaction_type not null,
  amount bigint not null,
  currency text,
  coins_delta bigint not null default 0,
  reference text,
  episode_id uuid references episodes (id) on delete set null,
  created_at timestamptz not null default now()
);

create table booking_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  destination_id uuid not null references destinations (id),
  name text not null,
  phone text not null,
  email text,
  message text not null,
  preferred_date date,
  status inquiry_status not null default 'new',
  created_at timestamptz not null default now()
);
```

Note: `favorites`'s three partial unique indexes are created in this same
file, immediately after the table, rather than in Task 3's indexes file —
they're uniqueness _constraints_ enforcing the table's own invariant (one
favorite per user per target), not query-performance indexes, so they
belong with the table definition.

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721150100_core_tables.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
tables = ["profiles", "destinations", "series", "episodes", "destination_media",
          "favorites", "listening_progress", "unlocks", "transactions", "booking_inquiries"]
for t in tables:
    assert f"create table {t} " in sql, f"missing table: {t}"
assert sql.count("create table") == 10, f"expected 10 tables, found {sql.count('create table')}"
print("OK: 10 tables present, parens balanced")
PY
```

Expected: `OK: 10 tables present, parens balanced`

- [ ] **Step 3: Verify every enum type used here was defined in Task 1**

```bash
for enum in user_role episode_status access_tier content_language inquiry_status transaction_type; do
  grep -q "$enum" supabase/migrations/20260721150000_enums.sql || echo "MISSING in enums file: $enum"
done
echo "done"
```

Expected: no `MISSING` lines printed, just `done`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260721150100_core_tables.sql
git commit -m "feat: add core tables migration"
```

---

### Task 3: Indexes migration

**Files:**

- Create: `supabase/migrations/20260721150200_indexes.sql`

**Interfaces:**

- Consumes: tables/columns from Task 2 (`episodes.series_id`, `episodes.status`, `episodes.access_tier`, `series.category`, `series.is_published`, `destinations.country`, `destinations.is_published`, `listening_progress.user_id`, `transactions.user_id`, `transactions.created_at`, `booking_inquiries.status`).
- Produces: nothing consumed by later tasks — query-performance indexes only.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721150200_indexes.sql

create index episodes_series_status_idx on episodes (series_id, status);

create index episodes_access_tier_idx on episodes (access_tier);

create index series_category_published_idx on series (category, is_published);

create index destinations_country_published_idx on destinations (country, is_published);

create index listening_progress_user_id_idx on listening_progress (user_id);

create index transactions_user_created_idx on transactions (user_id, created_at);

create index booking_inquiries_status_idx on booking_inquiries (status);
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721150200_indexes.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert sql.count("create index") == 7, f"expected 7 indexes, found {sql.count('create index')}"
print("OK: 7 indexes present, parens balanced")
PY
```

Expected: `OK: 7 indexes present, parens balanced`

- [ ] **Step 3: Verify every table/column referenced here exists in Task 2's file**

```bash
for ref in "episodes (series_id" "episodes (access_tier" "series (category" "destinations (country" "listening_progress (user_id" "transactions (user_id" "booking_inquiries (status"; do
  grep -q "$ref" supabase/migrations/20260721150200_indexes.sql || echo "MISSING index target: $ref"
done
echo "done"
```

Expected: no `MISSING` lines, just `done`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260721150200_indexes.sql
git commit -m "feat: add performance indexes migration"
```

---

### Task 4: `updated_at` trigger migration

**Files:**

- Create: `supabase/migrations/20260721150300_updated_at_triggers.sql`

**Interfaces:**

- Consumes: tables from Task 2 that have an `updated_at` column (`profiles`, `destinations`, `series`, `episodes`, `listening_progress`).
- Produces: function `set_updated_at()` — not consumed elsewhere in this plan, but any future migration adding a new `updated_at` column should reuse it rather than redefining it.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721150300_updated_at_triggers.sql

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on profiles
  for each row
  execute function set_updated_at();

create trigger destinations_set_updated_at
  before update on destinations
  for each row
  execute function set_updated_at();

create trigger series_set_updated_at
  before update on series
  for each row
  execute function set_updated_at();

create trigger episodes_set_updated_at
  before update on episodes
  for each row
  execute function set_updated_at();

create trigger listening_progress_set_updated_at
  before update on listening_progress
  for each row
  execute function set_updated_at();
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721150300_updated_at_triggers.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert sql.count("create trigger") == 5, f"expected 5 triggers, found {sql.count('create trigger')}"
for t in ["profiles", "destinations", "series", "episodes", "listening_progress"]:
    assert f"before update on {t}" in sql, f"missing trigger on: {t}"
print("OK: 5 updated_at triggers present, parens balanced")
PY
```

Expected: `OK: 5 updated_at triggers present, parens balanced`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721150300_updated_at_triggers.sql
git commit -m "feat: add updated_at trigger function and triggers"
```

---

### Task 5: Signup trigger migration

**Files:**

- Create: `supabase/migrations/20260721150400_handle_new_user_trigger.sql`

**Interfaces:**

- Consumes: `profiles` table shape from Task 2 (`id`, `display_name`, `role`, `coin_balance`); Supabase's built-in `auth.users` table (`id`, `email`, `raw_user_meta_data`).
- Produces: function `handle_new_user()`, trigger `on_auth_user_created` — not consumed by later tasks in this plan, but every later sub-project that creates users relies on this trigger existing.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721150400_handle_new_user_trigger.sql

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role, coin_balance)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1),
      'New Listener'
    ),
    'listener',
    0
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721150400_handle_new_user_trigger.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert "security definer" in sql, "handle_new_user() must be security definer to insert into profiles"
assert "after insert on auth.users" in sql, "trigger must fire after insert on auth.users"
assert "insert into public.profiles" in sql, "must insert into profiles"
print("OK: signup trigger present, security definer, parens balanced")
PY
```

Expected: `OK: signup trigger present, security definer, parens balanced`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721150400_handle_new_user_trigger.sql
git commit -m "feat: add auth.users to profiles signup trigger"
```

---

### Task 6: RLS policies migration

**Files:**

- Create: `supabase/migrations/20260721150500_rls_policies.sql`

**Interfaces:**

- Consumes: all 10 tables from Task 2; `profiles.role`, `profiles.coin_balance`, `profiles.is_premium` specifically for the admin-check and protected-column-guard functions.
- Produces: functions `is_admin()`, `prevent_protected_profile_changes()`; RLS enabled + policies on every table. Nothing consumed by later tasks in this plan, but every later sub-project's application code operates under these policies.

**Filing note:** the design spec's Mechanisms section describes
`prevent_protected_profile_changes()` (a trigger, not a policy) as part of
"how profile column protection is enforced," in the same breath as
`is_admin()`, without assigning it its own migration file. This task
places it here, in `_rls_policies.sql`, alongside `is_admin()` — both are
access-control mechanisms for the same set of tables, and grouping them
keeps "everything that controls who can touch what" in one file rather
than splitting one trigger away from the RLS policies it exists to
complement.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721150500_rls_policies.sql

-- Admin check helper, used by several tables' policies below. SECURITY
-- DEFINER so its internal query against `profiles` isn't itself subject
-- to the calling policy's RLS evaluation (avoids recursion).
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Blocks changes to coin_balance / is_premium / role from any request
-- that isn't running as the service role, regardless of which RLS policy
-- let the UPDATE through.
create or replace function prevent_protected_profile_changes()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role' then
    if new.coin_balance is distinct from old.coin_balance
      or new.is_premium is distinct from old.is_premium
      or new.role is distinct from old.role
    then
      raise exception 'coin_balance, is_premium, and role can only be changed by the service role';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on profiles
  for each row
  execute function prevent_protected_profile_changes();

-- profiles: owner can read/update their own row; protected columns are
-- blocked by the trigger above, not by this policy.
alter table profiles enable row level security;

create policy profiles_select_own
  on profiles for select
  using (auth.uid() = id);

create policy profiles_update_own
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- destinations: public can read published rows; admins have full access.
alter table destinations enable row level security;

create policy destinations_select_published
  on destinations for select
  using (is_published = true);

create policy destinations_admin_all
  on destinations for all
  using (is_admin())
  with check (is_admin());

-- series: same pattern as destinations.
alter table series enable row level security;

create policy series_select_published
  on series for select
  using (is_published = true);

create policy series_admin_all
  on series for all
  using (is_admin())
  with check (is_admin());

-- episodes: same pattern, gated on status instead of a boolean.
alter table episodes enable row level security;

create policy episodes_select_published
  on episodes for select
  using (status = 'published');

create policy episodes_admin_all
  on episodes for all
  using (is_admin())
  with check (is_admin());

-- destination_media: visible when its parent destination is published;
-- admins have full access. (Not specified in the original prompt pack;
-- resolved in the design spec to mirror its parent table.)
alter table destination_media enable row level security;

create policy destination_media_select_published
  on destination_media for select
  using (
    exists (
      select 1 from destinations d
      where d.id = destination_media.destination_id
        and d.is_published = true
    )
  );

create policy destination_media_admin_all
  on destination_media for all
  using (is_admin())
  with check (is_admin());

-- favorites: full CRUD restricted to the owning user.
alter table favorites enable row level security;

create policy favorites_owner_all
  on favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- listening_progress: full CRUD restricted to the owning user.
alter table listening_progress enable row level security;

create policy listening_progress_owner_all
  on listening_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- unlocks: owner can read their own unlocks. No insert/update/delete
-- policy for anon/authenticated at all — service_role bypasses RLS by
-- default, so "insert only via service role" needs no explicit policy.
alter table unlocks enable row level security;

create policy unlocks_select_own
  on unlocks for select
  using (auth.uid() = user_id);

-- transactions: same read-only-to-owner pattern as unlocks.
alter table transactions enable row level security;

create policy transactions_select_own
  on transactions for select
  using (auth.uid() = user_id);

-- booking_inquiries: anyone (including guests) can submit an inquiry;
-- only admins can read or update them.
alter table booking_inquiries enable row level security;

create policy booking_inquiries_insert_anyone
  on booking_inquiries for insert
  with check (true);

create policy booking_inquiries_admin_select
  on booking_inquiries for select
  using (is_admin());

create policy booking_inquiries_admin_update
  on booking_inquiries for update
  using (is_admin())
  with check (is_admin());
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721150500_rls_policies.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
tables = ["profiles", "destinations", "series", "episodes", "destination_media",
          "favorites", "listening_progress", "unlocks", "transactions", "booking_inquiries"]
for t in tables:
    assert f"alter table {t} enable row level security" in sql, f"RLS not enabled on: {t}"
assert sql.count("create policy") == 17, f"expected 17 policies, found {sql.count('create policy')}"
assert "create or replace function is_admin" in sql
assert "create or replace function prevent_protected_profile_changes" in sql
print("OK: RLS enabled on all 10 tables, 17 policies, both helper functions present, parens balanced")
PY
```

Expected: `OK: RLS enabled on all 10 tables, 17 policies, both helper functions present, parens balanced`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721150500_rls_policies.sql
git commit -m "feat: add RLS policies for all tables"
```

---

### Task 7: Documentation (`docs/schema.md`, `docs/rls-policies.md`)

**Files:**

- Create: `docs/schema.md`
- Create: `docs/rls-policies.md`

**Interfaces:**

- Consumes: the full schema from Tasks 1–6 (this task only documents it).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write `docs/schema.md`**

```markdown
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
```

- [ ] **Step 2: Write `docs/rls-policies.md`**

```markdown
# Row Level Security Policies

Every table in this schema has RLS enabled — see `docs/schema.md` for the
schema itself. This document explains what each policy allows and, where
it isn't obvious, why.

## Two helper mechanisms used throughout

**`is_admin()`** — a `SECURITY DEFINER` SQL function that checks whether
the current request's user has `role = 'admin'` in `profiles`. Several
tables' "admin has full access" policies call this instead of querying
`profiles` directly from within the policy, because `profiles` itself has
RLS enabled — a plain subquery risks recursive RLS evaluation.
`SECURITY DEFINER` runs the function with its owner's privileges, so its
internal query isn't subject to the calling policy's own RLS check.

**`prevent_protected_profile_changes()`** — a `BEFORE UPDATE` trigger on
`profiles` (not an RLS policy) that blocks any change to `coin_balance`,
`is_premium`, or `role` unless the request is running as the `service_role`.
This exists because RLS policies control _row_ access, not individual
_column_ writes — a `WHERE`-style check can't easily say "this row, but
not these three columns." The trigger is what actually stops a user from
crediting themselves coins through their own-row `UPDATE` policy below.

## Policy by table

### `profiles`

- **Select/update own row** (`profiles_select_own`, `profiles_update_own`):
  any request where `auth.uid() = id`. No policy lets one user read
  another user's profile.
- `coin_balance`, `is_premium`, and `role` are blocked from changing via
  the trigger described above, regardless of which policy let the
  `UPDATE` through.

### `destinations`, `series`

- **Public select** (`*_select_published`): anyone — including
  unauthenticated (`anon`) requests — can read rows where
  `is_published = true`.
- **Admin full access** (`*_admin_all`): `is_admin()` grants
  select/insert/update/delete on every row, published or not.
- Non-admin write attempts have no matching policy at all, so they're
  denied by default (no explicit "deny" rule was needed).

### `episodes`

Same pattern as `destinations`/`series`, but public visibility is gated
on `status = 'published'` instead of a boolean column.

### `destination_media`

- **Public select** (`destination_media_select_published`): visible when
  its parent `destinations` row has `is_published = true` (checked via a
  subquery on `destination_id`).
- **Admin full access**: same `is_admin()` pattern as the content tables.

This table isn't mentioned in the original schema requirements' RLS list;
this policy set was chosen to mirror its parent table, matching the
pattern every other content table uses.

### `favorites`, `listening_progress`

- **Owner full access** (`*_owner_all`): select/insert/update/delete
  restricted to `auth.uid() = user_id`. Both tables are user-mutable
  state — adding/removing a favorite, updating playback position — so
  "owner only" was read as full CRUD rather than read-only.

### `unlocks`, `transactions`

- **Owner select only** (`*_select_own`): a user can see their own
  unlock/transaction history, but nothing else.
- No insert/update/delete policy exists for `anon`/`authenticated` at
  all. This is intentional, not an oversight: Supabase's `service_role`
  bypasses RLS entirely by default, so it doesn't need an explicit
  policy to write these tables — omitting a policy for every other role
  is what "insert only via service role" means in practice. Coin unlocks
  and financial transactions are written by server-side code (Next.js
  server actions using the service role key), never directly by a
  client.

### `booking_inquiries`

- **Anyone can insert** (`booking_inquiries_insert_anyone`): `WITH CHECK
(true)` — including unauthenticated guests, so someone doesn't need an
  account to ask about a trip.
- **Admin select/update** (`booking_inquiries_admin_select`,
  `booking_inquiries_admin_update`): only `is_admin()` can read or update
  inquiries (e.g. changing `status` as staff follow up). There's no
  delete policy for any role — inquiries are meant to be retained, not
  removed.
```

- [ ] **Step 3: Verify both files exist and reference every table**

```bash
python3 - <<'PY'
tables = ["profiles", "destinations", "series", "episodes", "destination_media",
          "favorites", "listening_progress", "unlocks", "transactions", "booking_inquiries"]

schema = open("docs/schema.md").read()
rls = open("docs/rls-policies.md").read()

for t in tables:
    assert f"`{t}`" in schema, f"docs/schema.md missing table: {t}"
    assert f"`{t}`" in rls, f"docs/rls-policies.md missing table: {t}"

print("OK: both docs reference all 10 tables")
PY
```

Expected: `OK: both docs reference all 10 tables`

- [ ] **Step 4: Commit**

```bash
git add docs/schema.md docs/rls-policies.md
git commit -m "docs: add schema and RLS policy documentation"
```

---

## Verification (whole plan)

- All 6 migration files exist in `supabase/migrations/`, named in
  applied order, each passing its task's structural check above.
- `docs/schema.md` documents all 10 tables and both enums-in-use tables;
  `docs/rls-policies.md` documents all 10 tables' policies.
- `git log --oneline` shows 7 commits, one per task, each with a
  descriptive message.
- Applying the 6 files by hand to the real Supabase project (outside
  this plan's scope, per Global Constraints) is the authoritative
  end-to-end test.
