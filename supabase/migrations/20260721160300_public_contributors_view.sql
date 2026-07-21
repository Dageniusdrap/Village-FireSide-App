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
