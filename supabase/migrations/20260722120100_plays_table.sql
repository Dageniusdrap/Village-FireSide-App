-- supabase/migrations/20260722120100_plays_table.sql

create table plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  episode_id uuid not null references episodes (id) on delete cascade,
  played_at timestamptz not null default now()
);

create index plays_episode_id_played_at_idx on plays (episode_id, played_at);
create index plays_user_id_idx on plays (user_id);

alter table plays enable row level security;

create policy plays_select_own
  on plays for select
  using (auth.uid() = user_id);

create policy plays_admin_all
  on plays for all
  using (is_admin())
  with check (is_admin());
