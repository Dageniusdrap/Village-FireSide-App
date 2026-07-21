# Contributors, Consent, and Education Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add contributor/consent/education-tagging schema (Prompt 3) as 5 new hand-applied SQL migration files, plus edits to the existing `docs/schema.md` and `docs/rls-policies.md` — no application code changes.

**Architecture:** Five migration files applied in strict order (enums → tables/alter/junction → indexes → public view → RLS), continuing the same "one file per concern" convention Prompt 2 established. `is_admin()` and `set_updated_at()` are reused from Prompt 2's already-applied migrations, not redefined.

**Tech Stack:** Postgres (via Supabase), raw SQL DDL. No ORM, no Supabase CLI, no Docker (per project convention).

## Global Constraints

- No Supabase CLI, no Docker, no local Supabase stack — nothing in this plan requires a running Postgres instance to complete; verification is structural (same approach as Prompt 2's plan).
- Enum/table/column names must exactly match the design spec (`docs/superpowers/specs/2026-07-21-contributors-consent-schema-design.md`) unless a task explicitly justifies a deviation.
- RLS is enabled on every new table — no table ships without it.
- `consents.contributor_id` and any other foreign key meant to protect a legal/audit record must have **no** `ON DELETE` clause (Postgres default `NO ACTION`), matching Prompt 2's `transactions`/`booking_inquiries` pattern. Junction/child tables with no independent meaning use `ON DELETE CASCADE`.
- Reuse `is_admin()` (from `supabase/migrations/20260721150500_rls_policies.sql`) and `set_updated_at()` (from `supabase/migrations/20260721150300_updated_at_triggers.sql`) — do not redefine either function.
- Every migration file is applied exactly once, in filename order; files are not idempotent (no `IF NOT EXISTS` guards).

---

### Task 1: Contributor/consent/education enums migration

**Files:**

- Create: `supabase/migrations/20260721160000_contributor_consent_enums.sql`

**Interfaces:**

- Consumes: nothing (first migration of this prompt).
- Produces: enum types `contributor_type`, `consent_type`, `consent_status`, `content_source`, `subject_area`, `grade_level` — consumed by Task 2's table columns.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721160000_contributor_consent_enums.sql

create type contributor_type as enum ('elder', 'voice_artist', 'writer', 'tour_guide', 'historian', 'translator');

create type consent_type as enum ('story_recording', 'voice_cloning', 'photo', 'video', 'translation', 'archive');

create type consent_status as enum ('granted', 'granted_with_conditions', 'declined', 'revoked');

create type content_source as enum ('elder_testimony', 'narrated_production', 'ai_assisted', 'tour_guide_original');

create type subject_area as enum ('history', 'biology', 'geography', 'culture', 'conservation', 'folklore');

create type grade_level as enum ('primary', 'o_level', 'a_level', 'tertiary', 'general');
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721160000_contributor_consent_enums.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert sql.count("create type") == 6, f"expected 6 enum types, found {sql.count('create type')}"
for name in ["contributor_type", "consent_type", "consent_status", "content_source", "subject_area", "grade_level"]:
    assert f"create type {name} as enum" in sql, f"missing enum: {name}"
print("OK: 6 enums present, parens balanced")
PY
```

Expected: `OK: 6 enums present, parens balanced`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721160000_contributor_consent_enums.sql
git commit -m "feat: add contributor/consent/education enum types migration"
```

---

### Task 2: Contributors, consents, source_materials tables + episodes alteration + episode_contributors junction

**Files:**

- Create: `supabase/migrations/20260721160100_contributor_consent_tables.sql`

**Interfaces:**

- Consumes: enums from Task 1; `episodes` and `set_updated_at()` from Prompt 2's already-applied migrations (`supabase/migrations/20260721150100_core_tables.sql`, `supabase/migrations/20260721150300_updated_at_triggers.sql`).
- Produces: tables `contributors`, `consents`, `source_materials`, `episode_contributors`; 5 new columns on `episodes`; a `contributors_set_updated_at` trigger — consumed by Tasks 3–6.

**Nullability, matching the approved design spec:** `contributors.full_name`/`display_name`/`contributor_type` are `NOT NULL`; `bio`/`village`/`district`/`country`/`photo_url`/`approximate_birth_year`/`phone` are nullable; `is_anonymous`/`is_deceased` are `NOT NULL DEFAULT false`. `consents.signed_date` and `consents.document_url` are **nullable** (a `declined` consent has nothing to sign/scan — this was an explicit design decision, not an oversight; do not add `NOT NULL`). `source_materials.public_domain_verified` is `NOT NULL DEFAULT false`.

**Foreign-key delete behavior:** `consents.contributor_id` has **no `ON DELETE` clause** — this is deliberate (protects consent records the same way Prompt 2 protected `transactions`; do not add `ON DELETE CASCADE` here even though it might look like an omission). `episode_contributors`'s two FKs both use `ON DELETE CASCADE` (pure junction table). `episodes.source_material_id` uses `ON DELETE SET NULL`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721160100_contributor_consent_tables.sql

create table contributors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  display_name text not null,
  is_anonymous boolean not null default false,
  contributor_type contributor_type not null,
  bio text,
  photo_url text,
  village text,
  district text,
  country text,
  approximate_birth_year int,
  phone text,
  is_deceased boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger contributors_set_updated_at
  before update on contributors
  for each row
  execute function set_updated_at();

create table consents (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid not null references contributors (id),
  consent_type consent_type not null,
  consent_status consent_status not null,
  conditions text,
  signed_date date,
  document_url text,
  witness_name text,
  session_fee_amount bigint,
  session_fee_currency text,
  fee_paid_date date,
  created_at timestamptz not null default now()
);

create table source_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  publication_year int,
  public_domain_verified boolean not null default false,
  verification_notes text,
  source_url text,
  created_at timestamptz not null default now()
);

alter table episodes
  add column content_source content_source not null default 'narrated_production',
  add column subject_area subject_area,
  add column grade_level grade_level,
  add column syllabus_topic text,
  add column source_material_id uuid references source_materials (id) on delete set null;

create table episode_contributors (
  episode_id uuid not null references episodes (id) on delete cascade,
  contributor_id uuid not null references contributors (id) on delete cascade,
  role text not null,
  primary key (episode_id, contributor_id, role)
);
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721160100_contributor_consent_tables.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
for t in ["contributors", "consents", "source_materials", "episode_contributors"]:
    assert f"create table {t} " in sql, f"missing table: {t}"
assert sql.count("create table") == 4, f"expected 4 tables, found {sql.count('create table')}"
assert "alter table episodes" in sql
print("OK: 4 tables + episodes ALTER present, parens balanced")
PY
```

Expected: `OK: 4 tables + episodes ALTER present, parens balanced`

- [ ] **Step 3: Verify `consents.contributor_id` has no `ON DELETE` clause (the deliberate audit-trail protection)**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721160100_contributor_consent_tables.sql").read()
consents_block = sql.split("create table consents")[1].split("create table source_materials")[0]
assert "on delete" not in consents_block.lower(), "consents.contributor_id must NOT have an ON DELETE clause"
print("OK: consents.contributor_id has no ON DELETE clause, as intended")
PY
```

Expected: `OK: consents.contributor_id has no ON DELETE clause, as intended`

- [ ] **Step 4: Verify every enum type used here was defined in Task 1**

```bash
for enum in contributor_type consent_type consent_status content_source subject_area grade_level; do
  grep -q "$enum" supabase/migrations/20260721160000_contributor_consent_enums.sql || echo "MISSING in enums file: $enum"
done
echo "done"
```

Expected: no `MISSING` lines, just `done`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721160100_contributor_consent_tables.sql
git commit -m "feat: add contributors/consents/source_materials tables, episode_contributors junction, episodes alteration"
```

---

### Task 3: Indexes migration

**Files:**

- Create: `supabase/migrations/20260721160200_contributor_consent_indexes.sql`

**Interfaces:**

- Consumes: tables/columns from Task 2 (`contributors.contributor_type`, `consents.contributor_id`/`consent_type`, `episodes.content_source`/`subject_area`/`grade_level`, `episode_contributors.contributor_id`).
- Produces: nothing consumed by later tasks — query-performance indexes only.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721160200_contributor_consent_indexes.sql

create index contributors_contributor_type_idx on contributors (contributor_type);

create index consents_contributor_id_consent_type_idx on consents (contributor_id, consent_type);

create index episodes_content_source_idx on episodes (content_source);

create index episodes_subject_area_grade_level_idx on episodes (subject_area, grade_level);

create index episode_contributors_contributor_id_idx on episode_contributors (contributor_id);
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721160200_contributor_consent_indexes.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert sql.count("create index") == 5, f"expected 5 indexes, found {sql.count('create index')}"
print("OK: 5 indexes present, parens balanced")
PY
```

Expected: `OK: 5 indexes present, parens balanced`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721160200_contributor_consent_indexes.sql
git commit -m "feat: add contributor/consent/education indexes migration"
```

---

### Task 4: `public_contributors` view migration

**Files:**

- Create: `supabase/migrations/20260721160300_public_contributors_view.sql`

**Interfaces:**

- Consumes: `contributors` table from Task 2.
- Produces: view `public_contributors`, granted to `anon`/`authenticated` — this is the only public-facing read surface onto `contributors`, consumed by later app-facing prompts (Prompt 7's "Meet the Storytellers" rail, Prompt 11's local contributors).

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721160300_public_contributors_view.sql

create view public_contributors as
select
  id,
  display_name,
  contributor_type,
  case when is_anonymous then null else bio end as bio,
  case when is_anonymous then null else photo_url end as photo_url,
  case when is_anonymous then null else district end as district,
  case when is_anonymous then null else country end as country
from contributors;

grant select on public_contributors to anon, authenticated;
```

Note: this is a plain view (no `security_invoker`), so it runs with its owner's privileges rather than the querying user's — the same RLS-bypass mechanism `is_admin()` already uses via `SECURITY DEFINER`, applied here to a view instead of a function. Do not add `security_invoker = true`; doing so would make the view respect the caller's RLS on the underlying (admin-only) `contributors` table and defeat its purpose.

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721160300_public_contributors_view.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert "create view public_contributors" in sql
assert "security_invoker" not in sql, "must NOT set security_invoker — it would defeat the view's purpose"
assert "grant select on public_contributors to anon, authenticated" in sql
for col in ["display_name", "contributor_type", "bio", "photo_url", "district", "country"]:
    assert col in sql, f"missing exposed column: {col}"
for col in ["full_name", "phone", "village", "approximate_birth_year", "is_deceased"]:
    assert col not in sql, f"column must NOT be exposed through this view: {col}"
print("OK: view present, correct columns exposed/excluded, no security_invoker, grant present")
PY
```

Expected: `OK: view present, correct columns exposed/excluded, no security_invoker, grant present`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721160300_public_contributors_view.sql
git commit -m "feat: add public_contributors view"
```

---

### Task 5: RLS policies migration

**Files:**

- Create: `supabase/migrations/20260721160400_contributor_consent_rls.sql`

**Interfaces:**

- Consumes: `is_admin()` (from `supabase/migrations/20260721150500_rls_policies.sql`, already applied — do not redefine it); tables `contributors`, `consents`, `source_materials`, `episode_contributors` from Task 2.
- Produces: RLS enabled + policies on all 4 tables. Nothing consumed by later tasks in this plan.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260721160400_contributor_consent_rls.sql

-- contributors: admin only. Public access is only ever through the
-- public_contributors view (Task 4), never this table directly.
alter table contributors enable row level security;

create policy contributors_admin_all
  on contributors for all
  using (is_admin())
  with check (is_admin());

-- consents: admin only. Consent records, phone numbers, and fee amounts
-- must never be publicly readable.
alter table consents enable row level security;

create policy consents_admin_all
  on consents for all
  using (is_admin())
  with check (is_admin());

-- source_materials: admin only.
alter table source_materials enable row level security;

create policy source_materials_admin_all
  on source_materials for all
  using (is_admin())
  with check (is_admin());

-- episode_contributors: visible when its parent episode is published;
-- admin full access. Mirrors destination_media's pattern from Prompt 2
-- of visibility keyed off a parent table.
alter table episode_contributors enable row level security;

create policy episode_contributors_select_published
  on episode_contributors for select
  using (
    exists (
      select 1 from episodes e
      where e.id = episode_contributors.episode_id
        and e.status = 'published'
    )
  );

create policy episode_contributors_admin_all
  on episode_contributors for all
  using (is_admin())
  with check (is_admin());
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260721160400_contributor_consent_rls.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
for t in ["contributors", "consents", "source_materials", "episode_contributors"]:
    assert f"alter table {t} enable row level security" in sql, f"RLS not enabled on: {t}"
assert sql.count("create policy") == 5, f"expected 5 policies, found {sql.count('create policy')}"
assert "create or replace function is_admin" not in sql, "must NOT redefine is_admin() — reuse Prompt 2's"
print("OK: RLS enabled on all 4 tables, 5 policies, is_admin() reused not redefined, parens balanced")
PY
```

Expected: `OK: RLS enabled on all 4 tables, 5 policies, is_admin() reused not redefined, parens balanced`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721160400_contributor_consent_rls.sql
git commit -m "feat: add RLS policies for contributors, consents, source_materials, episode_contributors"
```

---

### Task 6: Documentation (edit `docs/schema.md` and `docs/rls-policies.md`)

**Files:**

- Modify: `docs/schema.md`
- Modify: `docs/rls-policies.md`

**Interfaces:**

- Consumes: the full schema from Tasks 1–5 (this task only documents it).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the 6 new enum rows to `docs/schema.md`'s existing Enums table**

Find this exact table in `docs/schema.md` (currently ends with the `transaction_type` row):

```markdown
| `inquiry_status` | `new`, `contacted`, `closed` | `booking_inquiries.status` |
| `transaction_type` | `coin_purchase`, `episode_unlock`, `subscription`, `refund` | `transactions.transaction_type` |
```

Replace it with (adding 6 new rows after the `transaction_type` row):

```markdown
| `inquiry_status` | `new`, `contacted`, `closed` | `booking_inquiries.status` |
| `transaction_type` | `coin_purchase`, `episode_unlock`, `subscription`, `refund` | `transactions.transaction_type` |
| `contributor_type` | `elder`, `voice_artist`, `writer`, `tour_guide`, `historian`, `translator` | `contributors.contributor_type` |
| `consent_type` | `story_recording`, `voice_cloning`, `photo`, `video`, `translation`, `archive` | `consents.consent_type` |
| `consent_status` | `granted`, `granted_with_conditions`, `declined`, `revoked` | `consents.consent_status` |
| `content_source` | `elder_testimony`, `narrated_production`, `ai_assisted`, `tour_guide_original` | `episodes.content_source` |
| `subject_area` | `history`, `biology`, `geography`, `culture`, `conservation`, `folklore` | `episodes.subject_area` |
| `grade_level` | `primary`, `o_level`, `a_level`, `tertiary`, `general` | `episodes.grade_level` |
```

(Column widths in the table don't need to match exactly — Prettier will reformat the table on commit, same as it did for Prompt 2's docs.)

- [ ] **Step 2: Add the 5 new columns to the existing `### `episodes`` section's column table**

Find this exact row in `docs/schema.md`:

```markdown
| `published_at` | `timestamptz`, nullable | |
| `created_at`, `updated_at` | `timestamptz` | |
```

Replace it with:

```markdown
| `published_at` | `timestamptz`, nullable | |
| `content_source` | `content_source`, default `narrated_production` | Whether this episode is elder testimony, a narrated production, AI-assisted, or a tour guide's own account. |
| `subject_area`, `grade_level` | nullable | Learn-tab tagging (Prompt 12) — subject and school grade level this episode fits. |
| `syllabus_topic` | `text`, nullable | Free-text syllabus tag for quick filtering in the Learn tab. |
| `source_material_id` | `uuid`, nullable, FK → `source_materials`, `ON DELETE SET NULL` | Citation link when this episode narrates a public-domain book. |
| `created_at`, `updated_at` | `timestamptz` | |
```

- [ ] **Step 3: Append new table sections to `docs/schema.md`, after the existing `### `booking_inquiries`` section and before `## Automatic profile creation`**

```markdown
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
```

- [ ] **Step 4: Append new sections to `docs/rls-policies.md`, after the existing `### `booking_inquiries`` section**

```markdown
### `contributors`, `consents`, `source_materials`

No public policy at all — `is_admin()` grants a `for all` policy on
each. The only public-facing read surface onto `contributors` is the
`public_contributors` view (see `docs/schema.md`), not this table
directly.

### `episode_contributors`

- **Public select** (`episode_contributors_select_published`): visible
  when its linked `episodes` row has `status = 'published'` (checked via
  a subquery on `episode_id`) — mirrors `destination_media`'s pattern of
  visibility keyed off a parent table.
- **Admin full access** (`episode_contributors_admin_all`): same
  `is_admin()` pattern as the content tables.
```

- [ ] **Step 5: Verify both docs reference every new table/enum**

```bash
python3 - <<'PY'
schema = open("docs/schema.md").read()
rls = open("docs/rls-policies.md").read()

for t in ["contributors", "consents", "source_materials", "episode_contributors", "public_contributors"]:
    assert f"`{t}`" in schema, f"docs/schema.md missing: {t}"

for t in ["contributors", "consents", "source_materials", "episode_contributors"]:
    assert f"`{t}`" in rls, f"docs/rls-policies.md missing: {t}"

for enum in ["contributor_type", "consent_type", "consent_status", "content_source", "subject_area", "grade_level"]:
    assert f"`{enum}`" in schema, f"docs/schema.md missing enum: {enum}"

print("OK: both docs reference all new tables/enums")
PY
```

Expected: `OK: both docs reference all new tables/enums`

- [ ] **Step 6: Commit**

```bash
git add docs/schema.md docs/rls-policies.md
git commit -m "docs: document contributors, consent, and education schema"
```

---

## Verification (whole plan)

- All 5 migration files exist in `supabase/migrations/`, named in applied
  order, each passing its task's structural check above.
- `docs/schema.md` and `docs/rls-policies.md` document every new
  table/enum/policy added here, without disturbing Prompt 2's existing
  content (verify with `git diff` that no existing row/section was
  deleted, only added to).
- `git log --oneline` shows 6 new commits, one per task.
- Applying the 5 files by hand to the real Supabase project, after
  Prompt 2's 6 files, is the authoritative end-to-end test (out of this
  plan's scope, per Global Constraints).
