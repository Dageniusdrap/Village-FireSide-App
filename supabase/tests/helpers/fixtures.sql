-- supabase/tests/helpers/fixtures.sql
-- Included by every pgTAP file with \ir. Each file runs inside its own
-- begin/rollback, so everything created here disappears afterwards.

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

create or replace function tests.create_user(p_role user_role default 'listener')
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          v_id::text || '@test.local', '{}'::jsonb, now(), now());
  -- handle_new_user() created the profile as 'listener'. profiles.role can
  -- only change as the service role (profiles_protect_columns trigger).
  if p_role <> 'listener' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update public.profiles set role = p_role where id = v_id;
    perform set_config('request.jwt.claims', '{}', true);
  end if;
  return v_id;
end;
$$;

create or replace function tests.claims_for(p_user_id uuid)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
$$;

create or replace function tests.create_contributor(
  p_type contributor_type default 'elder',
  p_anonymous boolean default false
)
returns uuid
language sql
as $$
  insert into public.contributors (full_name, display_name, contributor_type, is_anonymous)
  values ('Test Contributor', 'Test Contributor', p_type, p_anonymous)
  returning id;
$$;

create or replace function tests.create_episode(
  p_content_source content_source default 'elder_testimony'
)
returns uuid
language plpgsql
as $$
declare
  v_series uuid;
  v_episode uuid;
begin
  insert into public.series (title, slug)
  values ('Test Series', 'test-series-' || gen_random_uuid())
  returning id into v_series;
  insert into public.episodes (series_id, episode_number, title, description, audio_url, content_source)
  values (v_series, 1, 'Test Episode', 'Test description', 'episodes/test.m4a', p_content_source)
  returning id into v_episode;
  return v_episode;
end;
$$;

create or replace function tests.link(
  p_episode_id uuid,
  p_contributor_id uuid,
  p_role text default 'narrator'
)
returns void
language sql
as $$
  insert into public.episode_contributors (episode_id, contributor_id, role)
  values (p_episode_id, p_contributor_id, p_role);
$$;

create or replace function tests.add_consent(
  p_contributor_id uuid,
  p_type consent_type,
  p_status consent_status,
  p_reason text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  -- Before Task 6 adds consents.reason, the reason argument is ignored.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consents' and column_name = 'reason'
  ) then
    execute 'insert into public.consents (contributor_id, consent_type, consent_status, reason)
             values ($1, $2, $3, $4) returning id'
      into v_id using p_contributor_id, p_type, p_status, coalesce(p_reason, case when p_status = 'revoked' then 'test reason' end);
  else
    insert into public.consents (contributor_id, consent_type, consent_status)
    values (p_contributor_id, p_type, p_status)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Publishes directly for fixtures. From Task 9 on, the publish-state
-- trigger only allows this because the flag matches the episode id.
create or replace function tests.force_publish(p_episode_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('app.publishing_episode', p_episode_id::text, true);
  update public.episodes set status = 'published', published_at = now() where id = p_episode_id;
  perform set_config('app.publishing_episode', '', true);
end;
$$;
