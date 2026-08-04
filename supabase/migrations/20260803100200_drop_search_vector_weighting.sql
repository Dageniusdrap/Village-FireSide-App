-- supabase/migrations/20260803100200_drop_search_vector_weighting.sql
--
-- 20260803100000_search_tsvector_columns.sql built setweight(..., 'A') /
-- setweight(..., 'B') vectors so a title match would outrank a
-- description-only match via ts_rank() — but nothing in the app ever
-- orders by ts_rank() (PostgREST can't order by a computed expression
-- directly, and use-global-search.ts's .textSearch() calls have no
-- .order() at all). The weighting was implying a ranking guarantee that
-- doesn't exist. This migration replaces each weighted search_vector with
-- an unweighted equivalent so the schema stops overstating what search
-- actually does. See docs/known-issues.md ("Search results aren't ranked
-- by relevance") for the follow-up fix shape.
--
-- Postgres requires dropping and re-adding a generated column to change
-- its expression (there's no `alter column ... set expression`); the GIN
-- index is dropped automatically along with its column, so each is
-- recreated here under its original name.
--
-- contributors.search_vector is untouched — it was only ever built from
-- display_name (a single field, no setweight call), so it isn't affected
-- by this issue.

alter table series drop column search_vector;
alter table series
  add column search_vector tsvector
  generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored;
create index series_search_vector_idx on series using gin (search_vector);

alter table episodes drop column search_vector;
alter table episodes
  add column search_vector tsvector
  generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored;
create index episodes_search_vector_idx on episodes using gin (search_vector);

alter table destinations drop column search_vector;
alter table destinations
  add column search_vector tsvector
  generated always as (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
  ) stored;
create index destinations_search_vector_idx on destinations using gin (search_vector);
