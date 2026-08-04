-- supabase/migrations/20260803100000_search_tsvector_columns.sql

alter table series
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index series_search_vector_idx on series using gin (search_vector);

alter table episodes
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index episodes_search_vector_idx on episodes using gin (search_vector);

alter table destinations
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index destinations_search_vector_idx on destinations using gin (search_vector);

alter table contributors
  add column search_vector tsvector
  generated always as (to_tsvector('english', coalesce(display_name, ''))) stored;

create index contributors_search_vector_idx on contributors using gin (search_vector);

create or replace view public_contributors as
select
  id,
  display_name,
  contributor_type,
  case when is_anonymous then null else bio end as bio,
  case when is_anonymous then null else photo_url end as photo_url,
  case when is_anonymous then null else district end as district,
  case when is_anonymous then null else country end as country,
  search_vector
from contributors
where exists (
  select 1
  from episode_contributors ec
  join episodes e on e.id = ec.episode_id
  where ec.contributor_id = contributors.id
    and e.status = 'published'
);
