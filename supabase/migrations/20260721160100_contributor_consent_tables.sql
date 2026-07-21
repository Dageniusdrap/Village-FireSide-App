-- supabase/migrations/20260721160100_contributor_consent_tables.sql

create table contributors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  display_name text not null,
  is_anonymous boolean not null default false,
  contributor_type contributor_type not null,
  bio text,
  photo_url text,
  village text,
  district text,
  country text,
  approximate_birth_year int,
  phone text,
  is_deceased boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger contributors_set_updated_at
  before update on contributors
  for each row
  execute function set_updated_at();

create table consents (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid not null references contributors (id),
  consent_type consent_type not null,
  consent_status consent_status not null,
  conditions text,
  signed_date date,
  document_url text,
  witness_name text,
  session_fee_amount bigint,
  session_fee_currency text,
  fee_paid_date date,
  created_at timestamptz not null default now()
);

create table source_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  publication_year int,
  public_domain_verified boolean not null default false,
  verification_notes text,
  source_url text,
  created_at timestamptz not null default now()
);

alter table episodes
  add column content_source content_source not null default 'narrated_production',
  add column subject_area subject_area,
  add column grade_level grade_level,
  add column syllabus_topic text,
  add column source_material_id uuid references source_materials (id) on delete set null;

create table episode_contributors (
  episode_id uuid not null references episodes (id) on delete cascade,
  contributor_id uuid not null references contributors (id) on delete cascade,
  role text not null,
  primary key (episode_id, contributor_id, role)
);
