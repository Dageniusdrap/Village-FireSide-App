# Cultural Groups ("Peoples & Kingdoms") Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cultural-group organization schema (Prompt 3B) as 3 new hand-applied SQL migration files, plus edits to the existing `docs/schema.md` and `docs/rls-policies.md` — no application code, no `app_settings` table, no seed data (all explicitly deferred, per the approved spec).

**Architecture:** Three migration files applied in strict order (tables/junctions/trigger → indexes → RLS), continuing the "one file per concern" convention from Prompts 2 and 3. `is_admin()` and `set_updated_at()` are reused from already-applied migrations, not redefined.

**Tech Stack:** Postgres (via Supabase), raw SQL DDL. No ORM, no Supabase CLI, no Docker (per project convention).

## Global Constraints

- No Supabase CLI, no Docker, no local Supabase stack — nothing in this plan requires a running Postgres instance; verification is structural.
- Table/column names must exactly match the design spec (`docs/superpowers/specs/2026-07-22-cultural-groups-schema-design.md`) unless a task explicitly justifies a deviation.
- RLS is enabled on all 3 new tables — no table ships without it.
- Reuse `is_admin()` (from `supabase/migrations/20260721150500_rls_policies.sql`) and `set_updated_at()` (from `supabase/migrations/20260721150300_updated_at_triggers.sql`) — do not redefine either function.
- Do NOT create an `app_settings` table, any per-country toggle, or any seed data in this plan — all explicitly deferred (Prompt 9, Prompts 7/12, and Prompt 19 respectively). This plan only documents that future intent in prose.
- Every migration file is applied exactly once, in filename order; files are not idempotent (no `IF NOT EXISTS` guards).

---

### Task 1: `cultural_groups` table + junction tables + `updated_at` trigger

**Files:**

- Create: `supabase/migrations/20260722100000_cultural_groups_tables.sql`

**Interfaces:**

- Consumes: `series` and `contributors` tables (already applied, from Prompt 2 and Prompt 3 respectively); `set_updated_at()` function (from Prompt 2's already-applied migration).
- Produces: tables `cultural_groups`, `series_cultural_groups`, `contributor_cultural_groups`; a `cultural_groups_set_updated_at` trigger — consumed by Tasks 2–4.

**Nullability, matching the approved design spec:** `cultural_groups.name`/`slug` are `NOT NULL` (`slug` unique); `description`/`country`/`region`/`cover_image_url` are nullable; `is_published NOT NULL DEFAULT false`. Both junction tables' two columns are `NOT NULL` FKs with `ON DELETE CASCADE` on both sides (pure junction tables, no independent meaning once either side is gone — same reasoning Prompt 3 applied to `episode_contributors`).

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260722100000_cultural_groups_tables.sql

create table cultural_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  country text,
  region text,
  cover_image_url text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger cultural_groups_set_updated_at
  before update on cultural_groups
  for each row
  execute function set_updated_at();

create table series_cultural_groups (
  series_id uuid not null references series (id) on delete cascade,
  cultural_group_id uuid not null references cultural_groups (id) on delete cascade,
  primary key (series_id, cultural_group_id)
);

create table contributor_cultural_groups (
  contributor_id uuid not null references contributors (id) on delete cascade,
  cultural_group_id uuid not null references cultural_groups (id) on delete cascade,
  primary key (contributor_id, cultural_group_id)
);
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260722100000_cultural_groups_tables.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert sql.count("create table") == 3, f"expected 3 tables, found {sql.count('create table')}"
for t in ["cultural_groups", "series_cultural_groups", "contributor_cultural_groups"]:
    assert f"create table {t} " in sql, f"missing table: {t}"
assert sql.count("create trigger") == 1, f"expected 1 trigger, found {sql.count('create trigger')}"
assert "execute function set_updated_at()" in sql
assert "create or replace function set_updated_at" not in sql, "must NOT redefine set_updated_at()"
print("OK: 3 tables + 1 trigger present, set_updated_at() reused not redefined, parens balanced")
PY
```

Expected: `OK: 3 tables + 1 trigger present, set_updated_at() reused not redefined, parens balanced`

- [ ] **Step 3: Verify referenced tables (`series`, `contributors`) exist in already-applied migrations**

```bash
grep -q "create table series " supabase/migrations/20260721150100_core_tables.sql && echo "series: OK"
grep -q "create table contributors " supabase/migrations/20260721160100_contributor_consent_tables.sql && echo "contributors: OK"
```

Expected: both `OK` lines printed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260722100000_cultural_groups_tables.sql
git commit -m "feat: add cultural_groups table, junction tables, and updated_at trigger"
```

---

### Task 2: Indexes migration

**Files:**

- Create: `supabase/migrations/20260722100100_cultural_groups_indexes.sql`

**Interfaces:**

- Consumes: tables from Task 1 (`cultural_groups.country`/`is_published`, `series_cultural_groups.cultural_group_id`, `contributor_cultural_groups.cultural_group_id`).
- Produces: nothing consumed by later tasks — query-performance indexes only.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260722100100_cultural_groups_indexes.sql

create index cultural_groups_country_published_idx on cultural_groups (country, is_published);

create index series_cultural_groups_cultural_group_id_idx on series_cultural_groups (cultural_group_id);

create index contributor_cultural_groups_cultural_group_id_idx on contributor_cultural_groups (cultural_group_id);
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260722100100_cultural_groups_indexes.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert sql.count("create index") == 3, f"expected 3 indexes, found {sql.count('create index')}"
assert "cultural_groups (country, is_published)" in sql
assert "series_cultural_groups (cultural_group_id)" in sql
assert "contributor_cultural_groups (cultural_group_id)" in sql
print("OK: 3 indexes present with correct targets, parens balanced")
PY
```

Expected: `OK: 3 indexes present with correct targets, parens balanced`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260722100100_cultural_groups_indexes.sql
git commit -m "feat: add cultural groups indexes migration"
```

---

### Task 3: RLS policies migration

**Files:**

- Create: `supabase/migrations/20260722100200_cultural_groups_rls.sql`

**Interfaces:**

- Consumes: `is_admin()` (from `supabase/migrations/20260721150500_rls_policies.sql`, already applied — do not redefine it); tables from Task 1.
- Produces: RLS enabled + policies on all 3 tables. Nothing consumed by later tasks in this plan.

**RLS design, matching the approved spec (this resolves a gap the original prompt pack left unspecified for the junction tables):** `cultural_groups` gets public `SELECT` where `is_published = true`, plus `is_admin()` full access — same pattern as `destinations`/`series`. Both junction tables get public `SELECT` gated on the linked `cultural_groups` row's `is_published = true` (mirrors `episode_contributors`' pattern of visibility keyed off a parent table), plus `is_admin()` full access.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260722100200_cultural_groups_rls.sql

-- cultural_groups: public can read published rows; admin full access.
alter table cultural_groups enable row level security;

create policy cultural_groups_select_published
  on cultural_groups for select
  using (is_published = true);

create policy cultural_groups_admin_all
  on cultural_groups for all
  using (is_admin())
  with check (is_admin());

-- series_cultural_groups: visible when the linked cultural group is published.
alter table series_cultural_groups enable row level security;

create policy series_cultural_groups_select_published
  on series_cultural_groups for select
  using (
    exists (
      select 1 from cultural_groups cg
      where cg.id = series_cultural_groups.cultural_group_id
        and cg.is_published = true
    )
  );

create policy series_cultural_groups_admin_all
  on series_cultural_groups for all
  using (is_admin())
  with check (is_admin());

-- contributor_cultural_groups: same visibility pattern.
alter table contributor_cultural_groups enable row level security;

create policy contributor_cultural_groups_select_published
  on contributor_cultural_groups for select
  using (
    exists (
      select 1 from cultural_groups cg
      where cg.id = contributor_cultural_groups.cultural_group_id
        and cg.is_published = true
    )
  );

create policy contributor_cultural_groups_admin_all
  on contributor_cultural_groups for all
  using (is_admin())
  with check (is_admin());
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260722100200_cultural_groups_rls.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
for t in ["cultural_groups", "series_cultural_groups", "contributor_cultural_groups"]:
    assert f"alter table {t} enable row level security" in sql, f"RLS not enabled on: {t}"
assert sql.count("create policy") == 6, f"expected 6 policies, found {sql.count('create policy')}"
assert "create or replace function is_admin" not in sql, "must NOT redefine is_admin() — reuse Prompt 2's"
print("OK: RLS enabled on all 3 tables, 6 policies, is_admin() reused not redefined, parens balanced")
PY
```

Expected: `OK: RLS enabled on all 3 tables, 6 policies, is_admin() reused not redefined, parens balanced`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260722100200_cultural_groups_rls.sql
git commit -m "feat: add RLS policies for cultural groups and junction tables"
```

---

### Task 4: Documentation (edit `docs/schema.md` and `docs/rls-policies.md`)

**Files:**

- Modify: `docs/schema.md`
- Modify: `docs/rls-policies.md`

**Interfaces:**

- Consumes: the full schema from Tasks 1–3 (this task only documents it).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Append new table sections to `docs/schema.md`, after the existing `### `episode_contributors`` section and before `## `public_contributors` view``**

Find this exact text in `docs/schema.md` (read the live file first — whitespace may have shifted slightly from Prettier reformatting since this plan was written; match on the live file's actual content, not necessarily byte-for-byte against this snippet):

```markdown
Primary key is `(episode_id, contributor_id, role)`.

## `public_contributors` view
```

Insert the following new content between those two lines (i.e. right after "Primary key is `(episode_id, contributor_id, role)`." and before "## `public_contributors` view"):

```markdown
### `cultural_groups`

A people or kingdom of Africa (e.g. Buganda, Acholi) that content can be
organized around — the "Peoples & Kingdoms" browsing dimension.

| Column                                                | Type                       | Notes                                    |
| ----------------------------------------------------- | -------------------------- | ---------------------------------------- |
| `id`                                                  | `uuid`, PK                 |                                          |
| `name`                                                | `text`, not null           |                                          |
| `slug`                                                | `text`, not null, unique   |                                          |
| `description`, `country`, `region`, `cover_image_url` | nullable                   | Descriptive metadata, often incomplete.  |
| `is_published`                                        | `boolean`, default `false` | Gates public visibility.                 |
| `created_at`, `updated_at`                            | `timestamptz`              | `updated_at` auto-maintained by trigger. |

### `series_cultural_groups`

Junction table linking a series to the cultural group(s) it belongs to.

| Column              | Type                                                          | Notes                    |
| ------------------- | ------------------------------------------------------------- | ------------------------ |
| `series_id`         | `uuid`, not null, FK → `series`, `ON DELETE CASCADE`          | Part of the primary key. |
| `cultural_group_id` | `uuid`, not null, FK → `cultural_groups`, `ON DELETE CASCADE` | Part of the primary key. |

Primary key is `(series_id, cultural_group_id)`.

### `contributor_cultural_groups`

Junction table linking a contributor to the cultural group(s) they
belong to.

| Column              | Type                                                          | Notes                    |
| ------------------- | ------------------------------------------------------------- | ------------------------ |
| `contributor_id`    | `uuid`, not null, FK → `contributors`, `ON DELETE CASCADE`    | Part of the primary key. |
| `cultural_group_id` | `uuid`, not null, FK → `cultural_groups`, `ON DELETE CASCADE` | Part of the primary key. |

Primary key is `(contributor_id, cultural_group_id)`. Exposes only a
contributor/culture pairing — no personal data. `contributors` itself
stays admin-only; the only public-facing surface onto it is the
`public_contributors` view.
```

- [ ] **Step 2: Append an app-behavior section to `docs/schema.md`, after the existing `## Narrated-production labeling rule` section and before `## Automatic profile creation`**

Find this exact text (again, match against the live file's actual current content):

```markdown
(Prompt 6's `SourceBadge` component). This is a UI/content rule, not
something the database enforces.

## Automatic profile creation
```

Insert the following new section between those two lines:

```markdown
## Peoples & Kingdoms (app behavior — documented now, built later)

"Peoples & Kingdoms" is a planned browsing dimension for content
organized by African cultural group (`cultural_groups`, above). This
section documents the intended behavior; none of it is implemented yet:

- **Browse UI:** a "Peoples & Kingdoms" section on Home and a filter in
  the Learn tab (Prompts 7 and 12).
- **Terminology rule:** the UI always says "Peoples & Kingdoms" or
  "Cultures" — never "tribes".
- **Per-country visibility:** an `app_settings` key (table created in
  Prompt 9) will control whether cultural group browsing is shown per
  country — intended default: ON for Uganda, OFF for Rwanda, where
  ethnic categorization of content is legally sensitive. When OFF, the
  same content stays browsable by theme and region only. This toggle
  does not exist yet; `cultural_groups.is_published` is the only gate
  enforced today.
- **Seed data:** example cultural groups (Buganda, Bunyoro-Kitara,
  Busoga, Acholi, Ankole) are deferred to Prompt 19, not created here.
```

- [ ] **Step 3: Append a new section to `docs/rls-policies.md`, after the existing `### `episode_contributors`` section (end of file)**

```markdown
### `cultural_groups`, `series_cultural_groups`, `contributor_cultural_groups`

- **Public select** (`cultural_groups_select_published`): rows where
  `is_published = true`.
- **Junction tables** (`series_cultural_groups_select_published`,
  `contributor_cultural_groups_select_published`): visible when the
  linked `cultural_groups` row has `is_published = true` (checked via a
  subquery on `cultural_group_id`) — mirrors `episode_contributors`'
  pattern of visibility keyed off a parent table.
- **Admin full access** (`*_admin_all`): `is_admin()` on all three
  tables.
```

- [ ] **Step 4: Verify both docs reference every new table**

```bash
python3 - <<'PY'
schema = open("docs/schema.md").read()
rls = open("docs/rls-policies.md").read()

for t in ["cultural_groups", "series_cultural_groups", "contributor_cultural_groups"]:
    assert f"`{t}`" in schema, f"docs/schema.md missing: {t}"
    assert f"`{t}`" in rls, f"docs/rls-policies.md missing: {t}"

assert "Peoples & Kingdoms" in schema
assert "app_settings" in schema, "must document the deferred app_settings mechanism"
assert "tribes" in schema.lower(), "must document the terminology rule (which mentions the forbidden word to warn against it)"

print("OK: both docs reference all new tables, app-behavior section present")
PY
```

Expected: `OK: both docs reference all new tables, app-behavior section present`

- [ ] **Step 5: Verify no existing content was lost**

```bash
git diff --stat docs/schema.md docs/rls-policies.md
```

Expected: only insertions (`+`) reported for both files relative to before this task's changes — no line should show as a net content deletion beyond incidental Prettier table-column re-padding. If anything looks like a real deletion (a whole row/section missing), stop and investigate before committing.

- [ ] **Step 6: Commit**

```bash
git add docs/schema.md docs/rls-policies.md
git commit -m "docs: document cultural groups schema and Peoples & Kingdoms app behavior"
```

---

## Verification (whole plan)

- All 3 migration files exist in `supabase/migrations/`, named in applied
  order, each passing its task's structural check above.
- `docs/schema.md` and `docs/rls-policies.md` document every new
  table/policy added here, without disturbing existing content.
- No `app_settings` table, per-country toggle implementation, or seed
  data was created — all three remain explicitly deferred per the
  approved spec.
- `git log --oneline` shows 4 new commits, one per task.
- Applying the 3 files by hand to the real Supabase project, after
  Prompts 2 and 3's files, is the authoritative end-to-end test (out of
  this plan's scope, per Global Constraints).
