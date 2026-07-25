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
