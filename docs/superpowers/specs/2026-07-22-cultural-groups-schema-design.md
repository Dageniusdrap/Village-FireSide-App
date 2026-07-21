# Village Fireside — Cultural Groups ("Peoples & Kingdoms") Schema (Prompt 3B of 23)

Status: Approved
Date: 2026-07-22

## Context

Prompts 2 and 3 (merged) established the core schema and the contributor/
consent schema, with `is_admin()`, `set_updated_at()`, and the RLS
conventions already in place. This prompt (Prompt 3B in
`docs/PROMPT_PACK.md`) adds schema for organizing content by the peoples
and kingdoms of Africa — a browsable "Peoples & Kingdoms" dimension
alongside the existing category/region browsing.

**Forward-dependency gap, resolved:** the prompt pack describes a
per-country visibility toggle driven by an `app_settings` key, but
`app_settings` doesn't exist yet — it's created in Prompt 9. The prompt
pack's own text already scopes this correctly: the toggle is listed under
"App behavior (implement later with Prompts 7 and 12, note it in docs
now)." This prompt documents the intended mechanism and its default
values; it does not create `app_settings` or any UI. Prompt 9 creates the
table; Prompts 7 and 12 wire up the actual toggle and browse UI.

## Goals

- `cultural_groups` table and two junction tables
  (`series_cultural_groups`, `contributor_cultural_groups`), exactly as
  specified, with nullability/FK behavior decided explicitly where the
  prompt didn't (see Design).
- RLS on all three tables, resolving a gap the prompt pack left
  unspecified (junction-table policies — see Design → RLS).
- Indexes exactly as specified.
- `docs/schema.md` and `docs/rls-policies.md` updated (the prompt only
  named `schema.md`; extending `rls-policies.md` too keeps this prompt
  consistent with how Prompts 2 and 3 documented their RLS).
- The "App behavior" bullets (browse UI, terminology rule, per-country
  toggle) documented as _intent_, not implemented — per the forward-
  dependency resolution above.

## Non-goals

- No `app_settings` table, no per-country toggle implementation, no
  Home/Learn browse UI — all deferred to Prompts 7, 9, and 12 as the
  prompt pack itself specifies.
- No seed data (Buganda, Bunyoro-Kitara, Busoga, Acholi, Ankole) — the
  prompt pack explicitly defers these to Prompt 19.
- No changes to `series`, `contributors`, or any other existing table
  beyond adding the two junction tables that reference them.

## Design

### Tables

**cultural_groups** — `id` PK. `name`, `slug` `NOT NULL` (`slug` unique —
core identity fields). `description`, `country`, `region`,
`cover_image_url` nullable (descriptive, matching `destinations`' pattern
from Prompt 2 — country/region metadata is often incomplete). `is_published
NOT NULL DEFAULT false`. `created_at`, `updated_at NOT NULL DEFAULT now()`.

**series_cultural_groups** — pure junction table. `series_id` `NOT NULL`
FK → `series`, `ON DELETE CASCADE`. `cultural_group_id` `NOT NULL` FK →
`cultural_groups`, `ON DELETE CASCADE`. Primary key
`(series_id, cultural_group_id)`. Both FKs cascade because the junction
row has no independent meaning once either side is gone — same reasoning
Prompt 3 applied to `episode_contributors`.

**contributor_cultural_groups** — same shape: `contributor_id` `NOT NULL`
FK → `contributors`, `ON DELETE CASCADE`; `cultural_group_id` `NOT NULL`
FK → `cultural_groups`, `ON DELETE CASCADE`. Primary key
`(contributor_id, cultural_group_id)`.

### Mechanisms

**`updated_at` trigger.** `cultural_groups` gets a new
`cultural_groups_set_updated_at` trigger reusing the existing
`set_updated_at()` function (defined in Prompt 2's migrations) — not
redefined.

### RLS

The prompt pack only specifies policy for `cultural_groups` itself
("public reads published groups only; admin full access") — the two
junction tables' RLS is a gap this spec resolves:

| Table                                                   | Policy                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cultural_groups`                                       | Public `SELECT` where `is_published = true`. `is_admin()` (reused from Prompt 2) — full `for all` access. Same pattern as `destinations`/`series`.                                                                        |
| `series_cultural_groups`, `contributor_cultural_groups` | Public `SELECT` gated on `cultural_groups.is_published = true` for the linked row (mirrors `destination_media`'s and `episode_contributors`' pattern of visibility keyed off a parent table). `is_admin()` — full access. |

**Why the junction tables can safely be public:** a `contributor_cultural_groups`
row exposes only a `contributor_id`/`cultural_group_id` pairing — no PII.
`contributors` itself stays fully admin-locked; the only public-facing
surface onto it remains the already-gated `public_contributors` view from
Prompt 3. Exposing this pairing is what lets a future "notable
contributors from this culture" browse feature (Prompts 7/12) work at
all — without it, the app would have no way to query which contributors
belong to a published cultural group.

### Indexes

`cultural_groups(country, is_published)`, exactly as specified. Plus one
index per junction table's second column —
`series_cultural_groups(cultural_group_id)` and
`contributor_cultural_groups(cultural_group_id)` — so reverse lookups
("all series/contributors for this culture") aren't full table scans.
(First-column lookups are already covered by each table's own primary
key.)

### Documentation

**`docs/schema.md`** gets three additions:

1. `cultural_groups` and the two junction tables, documented like every
   other table.
2. A "Peoples & Kingdoms" app-behavior note documenting (not
   implementing): the Home/Learn browse sections (Prompts 7, 12); the
   terminology rule ("Peoples & Kingdoms" / "Cultures" — never "tribes");
   and the future `app_settings`-driven per-country visibility toggle,
   with its intended default values (ON for Uganda, OFF for Rwanda,
   where ethnic categorization of content is legally sensitive) and an
   explicit note that the mechanism arrives in Prompt 9 and the UI in
   Prompts 7/12.
3. A note that seed examples (Buganda, Bunyoro-Kitara, Busoga, Acholi,
   Ankole) are deferred to Prompt 19.

**`docs/rls-policies.md`** gets a new section for the three tables'
policies, following the existing per-table format.

## Verification

- Same approach as Prompts 2 and 3: no live Postgres in this environment
  (no Docker, no Supabase CLI) — verification is structural (balanced
  parens, expected statement counts, cross-file name/column references).
- `docs/schema.md` and `docs/rls-policies.md` contain new sections
  covering every table/policy added here, without disturbing existing
  content.

## Out of scope for this sub-project

`app_settings` table and the per-country toggle mechanism (Prompt 9);
Home/Learn browse UI (Prompts 7, 12); seed data (Prompt 19); any changes
to how `series` or `contributors` browsing/visibility works outside of
adding these new optional cultural-group associations.
