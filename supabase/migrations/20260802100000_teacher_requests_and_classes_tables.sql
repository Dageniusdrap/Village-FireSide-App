-- supabase/migrations/20260802100000_teacher_requests_and_classes_tables.sql

create table teacher_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  school text not null,
  district text not null,
  phone text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  join_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_at timestamptz not null default now()
);

create table class_assignments (
  class_id uuid not null references classes (id) on delete cascade,
  episode_id uuid not null references episodes (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (class_id, episode_id)
);

create table class_members (
  class_id uuid not null references classes (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);
