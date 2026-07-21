-- supabase/migrations/20260721150100_core_tables.sql

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  role user_role not null default 'listener',
  country text,
  coin_balance bigint not null default 0,
  is_premium boolean not null default false,
  premium_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table destinations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  region text,
  district text,
  country text,
  latitude double precision,
  longitude double precision,
  best_time_to_visit text,
  entry_fee_notes text,
  safety_notes text,
  conservation_notes text,
  cover_image_url text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  cover_image_url text,
  category text,
  destination_id uuid references destinations (id) on delete set null,
  is_published boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references series (id) on delete cascade,
  title text not null,
  description text,
  episode_number int not null,
  audio_url text,
  duration_seconds int,
  status episode_status not null default 'draft',
  access_tier access_tier not null default 'free',
  coin_price bigint not null default 0,
  language content_language not null default 'en',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, episode_number, language)
);

create table destination_media (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null references destinations (id) on delete cascade,
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  caption text,
  sort_order int not null default 0
);

create table favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  episode_id uuid references episodes (id) on delete cascade,
  series_id uuid references series (id) on delete cascade,
  destination_id uuid references destinations (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_exactly_one_target check (
    (
      (episode_id is not null)::int
      + (series_id is not null)::int
      + (destination_id is not null)::int
    ) = 1
  )
);

create unique index favorites_user_episode_uidx
  on favorites (user_id, episode_id)
  where episode_id is not null;

create unique index favorites_user_series_uidx
  on favorites (user_id, series_id)
  where series_id is not null;

create unique index favorites_user_destination_uidx
  on favorites (user_id, destination_id)
  where destination_id is not null;

create table listening_progress (
  user_id uuid not null references profiles (id) on delete cascade,
  episode_id uuid not null references episodes (id) on delete cascade,
  position_seconds int not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);

create table unlocks (
  user_id uuid not null references profiles (id) on delete cascade,
  episode_id uuid not null references episodes (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id),
  transaction_type transaction_type not null,
  amount bigint not null,
  currency text,
  coins_delta bigint not null default 0,
  reference text,
  episode_id uuid references episodes (id) on delete set null,
  created_at timestamptz not null default now()
);

create table booking_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  destination_id uuid not null references destinations (id),
  name text not null,
  phone text not null,
  email text,
  message text not null,
  preferred_date date,
  status inquiry_status not null default 'new',
  created_at timestamptz not null default now()
);
