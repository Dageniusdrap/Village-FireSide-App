create table episode_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  episode_id uuid not null references episodes (id) on delete cascade,
  position_seconds int not null,
  note text,
  created_at timestamptz not null default now()
);

create index episode_bookmarks_user_id_idx on episode_bookmarks (user_id);
create index episode_bookmarks_episode_id_idx on episode_bookmarks (episode_id);

alter table episode_bookmarks enable row level security;

create policy episode_bookmarks_owner_all
  on episode_bookmarks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
