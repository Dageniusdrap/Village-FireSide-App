-- supabase/migrations/20260803100100_push_tokens_table.sql

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  expo_push_token text not null,
  platform text not null, -- 'ios' | 'android'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create trigger push_tokens_set_updated_at
  before update on push_tokens
  for each row
  execute function set_updated_at();

alter table push_tokens enable row level security;

create policy push_tokens_owner_all
  on push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
