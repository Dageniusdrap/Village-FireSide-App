-- supabase/tests/000_harness.test.sql
begin;
\ir helpers/fixtures.sql

select plan(3);

select has_table('public', 'admin_actions', 'the last pre-15A migration is applied');
select isnt(tests.create_user('admin'), null, 'fixture helper creates a user');

-- tests.create_user() runs its insert/update in its own statement, so a
-- fresh snapshot sees it. Calling it again inline inside this SELECT's
-- WHERE clause would run in the SAME snapshot as the outer query and the
-- new row would not be visible yet -- hence the \gset split below.
select tests.create_user('teacher') as teacher_id \gset
select is(
  (select role from public.profiles where id = :'teacher_id'::uuid),
  'teacher'::user_role,
  'fixture helper can set a non-listener role'
);

select * from finish();
rollback;
