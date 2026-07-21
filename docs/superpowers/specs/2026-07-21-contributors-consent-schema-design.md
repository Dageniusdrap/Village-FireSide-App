# Village Fireside — Contributors, Consent, and Education Schema (Prompt 3 of 23)

Status: Approved
Date: 2026-07-21

## Context

Prompt 2 (merged) established the core schema: `profiles`, `destinations`,
`series`, `episodes`, and the rest, with `is_admin()` and RLS conventions
already in place. This prompt (Prompt 3 in `docs/PROMPT_PACK.md`) adds the
schema for tracking who contributed each story, whether they consented to
being recorded/published, and where narrated (non-elder) content was
sourced from — plus tagging episodes for the Learn tab's subject/grade
browsing. This is the schema layer with the most legal weight in the whole
app: elder recordings and their consent status are the one thing that must
never be published without a verifiable, auditable trail.

## Goals

- The 6 new enums and 5 new tables from the prompt pack, exactly as
  specified where the pack gives an exact value, with nullability/FK
  behavior decided explicitly where it didn't (see Design).
- `episodes` gains `content_source`, `subject_area`, `grade_level`,
  `syllabus_topic`, and `source_material_id` via `ALTER TABLE`.
- Consent and contributor records are protected from accidental deletion,
  matching the audit-trail protection pattern Prompt 2 established for
  `transactions`.
- A `public_contributors` view exposes only the fields safe to show
  publicly, correctly nulling out extra fields for anonymous contributors.
- RLS on every new table; new sections appended to the existing
  `docs/schema.md` and `docs/rls-policies.md` (not new files).

## Non-goals

- No admin UI, no publishing-guard _enforcement_ code (that's Prompt 14 —
  this prompt only documents the rule in `docs/schema.md`; the database
  does not itself block publishing an under-consented episode).
- No actual audio/consent-document upload — that's storage (Prompt 4).
- No changes to `episode_contributors`' `role` semantics beyond "a free
  text tag" (e.g. "narrator", "translator") — no enum, no validation, per
  the prompt's plain `role TEXT`.

## Design

### New enums

| Enum               | Values                                                                         |
| ------------------ | ------------------------------------------------------------------------------ |
| `contributor_type` | `elder`, `voice_artist`, `writer`, `tour_guide`, `historian`, `translator`     |
| `consent_type`     | `story_recording`, `voice_cloning`, `photo`, `video`, `translation`, `archive` |
| `consent_status`   | `granted`, `granted_with_conditions`, `declined`, `revoked`                    |
| `content_source`   | `elder_testimony`, `narrated_production`, `ai_assisted`, `tour_guide_original` |
| `subject_area`     | `history`, `biology`, `geography`, `culture`, `conservation`, `folklore`       |
| `grade_level`      | `primary`, `o_level`, `a_level`, `tertiary`, `general`                         |

### Tables

**contributors** — `id` PK. `full_name`, `display_name`, `contributor_type`
`NOT NULL` (core identity/classification — `display_name` is what
`public_contributors` shows, so it must always exist). `is_anonymous`,
`is_deceased` `NOT NULL DEFAULT false`. `bio`, `village`, `district`,
`country` nullable (descriptive; often incomplete for elderly/historical
subjects). `photo_url`, `approximate_birth_year`, `phone` nullable
(explicit in the prompt). `created_at`, `updated_at`.

**consents** — `id` PK, `contributor_id` `NOT NULL` FK → `contributors`
(no `ON DELETE` clause — see Mechanisms). `consent_type`, `consent_status`
`NOT NULL`. `signed_date`, `document_url` **nullable** — resolved
ambiguity: a `declined` consent has nothing to sign or scan, so these
columns aren't required at the database level; the admin UI/publishing
guard (Prompt 14) is what actually enforces "a `granted` consent needs a
signed date and a document" in practice, not a DB constraint. `conditions`,
`witness_name`, `session_fee_amount`, `session_fee_currency`,
`fee_paid_date` all nullable, as given. `created_at`.

**source_materials** — `id` PK, `title` `NOT NULL`. `author`,
`publication_year`, `verification_notes`, `source_url` nullable (old
public-domain texts don't always have a clean, complete citation).
`public_domain_verified` `NOT NULL DEFAULT false` — unverified is the
expected starting state (Prompt 14 warns on unverified sources, implying
verification is a deliberate follow-up step, not automatic). `created_at`.

**episodes (ALTER TABLE)** — adds `content_source content_source NOT NULL
DEFAULT 'narrated_production'`; `subject_area subject_area`, `grade_level
grade_level`, `syllabus_topic TEXT` all nullable; `source_material_id UUID
REFERENCES source_materials`, nullable, `ON DELETE SET NULL` (losing a
citation link doesn't need to affect the episode itself).

**episode_contributors** — junction table: `episode_id` `NOT NULL` FK →
`episodes` (`ON DELETE CASCADE`), `contributor_id` `NOT NULL` FK →
`contributors` (`ON DELETE CASCADE`), `role TEXT NOT NULL` (free text,
e.g. "narrator", "translator" — no enum, per the prompt). Primary key
`(episode_id, contributor_id, role)`, exactly as specified.

### Mechanisms

**Consent records are protected like `transactions` were in Prompt 2.**
`consents.contributor_id` has **no `ON DELETE` clause** (Postgres default
`NO ACTION`) — this blocks deleting a contributor who has any consent
history at all, the same audit-trail protection Prompt 2 applied to
financial records. `episode_contributors`, by contrast, is a pure junction
table with no independent meaning once either side is gone, so both its
FKs use `ON DELETE CASCADE`.

**`public_contributors` view.** A plain `CREATE VIEW` (no
`security_invoker`), so it runs with its owner's privileges rather than
the querying user's — the same RLS-bypass mechanism `is_admin()` already
uses via `SECURITY DEFINER`, applied to a view instead of a function. This
lets `anon`/`authenticated` read a safe slice of the otherwise admin-only
`contributors` table. View creation alone doesn't grant access, so the
migration also needs an explicit `GRANT SELECT ON public_contributors TO
anon, authenticated`. Column exposure:

```sql
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
```

`display_name` and `contributor_type` always show. Every other exposed
column nulls out when `is_anonymous = true`. `full_name`, `phone`,
`village`, `approximate_birth_year`, and `is_deceased` are never exposed
through this view — only through direct (admin-only) table access.

### RLS

| Table                                          | Policy                                                                                                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contributors`, `consents`, `source_materials` | No public policy at all. `is_admin()` (reused from Prompt 2's migration — not redefined) gets a `for all` policy on each.                                                              |
| `public_contributors`                          | Not RLS-restricted directly (it's a view) — its access control is the `GRANT` plus the `CASE`-based column nulling above.                                                              |
| `episode_contributors`                         | Public can `SELECT` a row only when the linked `episodes` row is published (mirrors `destination_media`'s pattern of visibility keyed off a parent table). `is_admin()` — full access. |

### Documentation

Both are edits to Prompt 2's existing files, not new files:

- `docs/schema.md` — new sections for the 6 enums, 5 tables/alterations,
  the publishing rule ("an episode with `content_source =
'elder_testimony'` must have ≥1 linked elder contributor with a
  `granted` `story_recording` consent — enforced in the admin dashboard,
  Prompt 14, not the database"), and the mandatory "Narrated production"
  UI label rule for `narrated_production`/`ai_assisted` episodes.
- `docs/rls-policies.md` — new sections for this prompt's tables,
  following the existing per-table format.

## Verification

- Same as Prompt 2: no live Postgres in this environment (no Docker, no
  Supabase CLI) — verification is structural (balanced parens, expected
  statement counts, cross-file name references), plus a check that the
  new `ALTER TABLE episodes` statements reference columns/tables that
  already exist in Prompt 2's committed migration.
- `docs/schema.md` and `docs/rls-policies.md` contain new sections
  covering every table/enum/policy added here, without disturbing Prompt
  2's existing content.

## Out of scope for this sub-project

Admin UI and publishing-guard enforcement (Prompt 14), storage/upload
(Prompt 4), cultural groups (Prompt 3B — separate follow-on prompt), any
validation beyond what's stated (e.g. no CHECK constraint enforcing the
elder-consent publishing rule at the database level — it's a documented
rule enforced later, in application code).
