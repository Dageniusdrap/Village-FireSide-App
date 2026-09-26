-- supabase/migrations/20260922100000_daily_featured_episodes_table.sql

create table daily_featured_episodes (
  feature_date date primary key,
  episode_id uuid not null references episodes (id),
  created_at timestamptz not null default now()
);

alter table daily_featured_episodes enable row level security;

create policy daily_featured_episodes_select_anyone
  on daily_featured_episodes for select
  using (true);

create policy daily_featured_episodes_admin_all
  on daily_featured_episodes for all
  using (is_admin())
  with check (is_admin());
