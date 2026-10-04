-- supabase/tests/upgrade/fixtures.sql
-- Live-shaped data at the pre-15A baseline: the three test accounts, one
-- admin_actions entry of each existing type, and a published
-- elder_testimony episode with no consent (legal before 15A).

do $$
declare
  v_admin uuid := '11111111-1111-1111-1111-111111111111';
  v_teacher uuid := '22222222-2222-2222-2222-222222222222';
  v_listener uuid := '33333333-3333-3333-3333-333333333333';
  v_series uuid := '44444444-4444-4444-4444-444444444444';
  v_episode uuid := '55555555-5555-5555-5555-555555555555';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-test@villagefireside.app', '{}', now(), now()),
    (v_teacher, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teacher-test@villagefireside.app', '{}', now(), now()),
    (v_listener, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test@villagefireside.app', '{}', now(), now());

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update profiles set role = 'admin' where id = v_admin;
  update profiles set role = 'teacher' where id = v_teacher;
  perform set_config('request.jwt.claims', '{}', true);

  insert into series (id, title, slug, is_published) values (v_series, 'Legacy Series', 'legacy-series', true);
  insert into episodes (id, series_id, episode_number, title, description, audio_url, content_source, status, published_at)
  values (v_episode, v_series, 1, 'Legacy Elder Episode', 'Published before 15A', 'episodes/legacy.m4a',
          'elder_testimony', 'published', '2026-09-30 10:00:00+00');

  insert into admin_actions (admin_id, action, entity_type, entity_id, details) values
    (v_admin, 'create', 'series', v_series, '{"title":"Legacy Series"}'),
    (v_admin, 'update', 'series', v_series, '{"title":"Legacy Series"}'),
    (v_admin, 'publish', 'series', v_series, null),
    (v_admin, 'create', 'episode', v_episode, '{"title":"Legacy Elder Episode"}'),
    (v_admin, 'publish', 'episode', v_episode, null);
end;
$$;
