-- supabase/migrations/20260926100000_admin_actions.sql

create table admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table admin_actions enable row level security;

create policy admin_actions_admin_select
  on admin_actions for select
  using (is_admin());
