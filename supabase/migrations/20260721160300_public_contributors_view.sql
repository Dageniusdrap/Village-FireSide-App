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
from contributors
where exists (
  select 1
  from episode_contributors ec
  join episodes e on e.id = ec.episode_id
  where ec.contributor_id = contributors.id
    and e.status = 'published'
);

grant select on public_contributors to anon, authenticated;
