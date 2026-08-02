-- supabase/manual-checks/booking_inquiries_insert_check.sql
--
-- Manual verification for booking_inquiries_insert_anyone's WITH CHECK
-- clause (supabase/migrations/20260801100000_tighten_booking_inquiries_insert_check.sql).
--
-- Deliberately NOT under supabase/tests/ — that path is the Supabase CLI's
-- reserved pgTAP directory (`supabase test db` globs it and runs every
-- .sql file through pg_prove); this script emits no TAP output and several
-- of its cases deliberately raise errors, so it would break that runner
-- the moment it exists. This repo has no pgTAP/RLS test harness yet at
-- all — no runner is wired into `pnpm test` or CI — and there's no
-- Supabase CLI / local Postgres available in this environment to execute
-- this against, so it's a manual, hand-run script. Prompt 18 ("Security &
-- RLS Audit," see docs/PROMPT_PACK.md) is where this project plans to add
-- real pgTAP-based RLS testing; when that lands, the six cases below are
-- the natural first ones to port into supabase/tests/ as
-- throws_ok()/lives_ok() assertions.
--
-- Run with: psql <connection-string> -f this-file.sql
-- against a disposable/non-production project. Each case is plain SQL in
-- its own explicit transaction (BEGIN ... ROLLBACK) — no DO blocks, no
-- dollar-quoting. That's deliberate: psql's `:variable`/`:'variable'`
-- substitution is documented to skip single-quoted string literals, but
-- its interaction with dollar-quoted (`$$...$$`) PL/pgSQL bodies isn't
-- clearly documented, so this avoids the ambiguity entirely rather than
-- risk a substitution silently not happening inside one. psql's default
-- ON_ERROR_STOP=off means a failed INSERT prints its error and execution
-- continues to the next statement (ROLLBACK is always valid even after a
-- failed statement aborts the surrounding transaction) — but a
-- security-conscious operator's ~/.psqlrc sometimes flips that default,
-- so it's set explicitly below rather than assumed.
--
-- Read each case's comment for the outcome to expect, then check the
-- actual output: either "INSERT 0 1" (succeeded) or an "ERROR: new row
-- violates row-level security policy for table booking_inquiries" (was
-- rejected).

\set ON_ERROR_STOP off

\set destination_id '00000000-0000-0000-0000-000000000001'
\set self_user_id '00000000-0000-0000-0000-000000000002'
\set someone_else_user_id '00000000-0000-0000-0000-000000000003'

-- Replace the three UUIDs above with real ids from a disposable project
-- before running: a real destination id, and two distinct real profile
-- ids ("self" and "someone_else").

-- Case 1: guest (anon), legitimate shape (no status, user_id null).
-- Expect: SUCCEEDS ("INSERT 0 1").
begin;
set local role anon;
insert into booking_inquiries (destination_id, user_id, name, phone, message)
values (:'destination_id', null, 'Test Guest', '0700000000', 'guest, legit shape');
rollback;

-- Case 2: guest attempting to spoof status.
-- Expect: REJECTED ("ERROR: new row violates row-level security policy").
begin;
set local role anon;
insert into booking_inquiries (destination_id, user_id, name, phone, message, status)
values (:'destination_id', null, 'Malicious Guest', '0700000000', 'spoofed status', 'closed');
rollback;

-- Case 3: guest (anon, auth.uid() is null) attempting to attribute the
-- inquiry to a real user's id. This is the one case that depends on
-- WITH CHECK rejecting a NULL-valued expression, not a false one:
-- `user_id is null` -> false, `user_id = auth.uid()` -> uuid = null -> null.
-- Expect: REJECTED.
begin;
set local role anon;
insert into booking_inquiries (destination_id, user_id, name, phone, message)
values (:'destination_id', :'self_user_id', 'Guest Spoofing A User', '0700000000', 'guest, non-null user_id');
rollback;

-- Case 4: authenticated caller attributing the inquiry to a DIFFERENT
-- user's id. Expect: REJECTED.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'self_user_id', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into booking_inquiries (destination_id, user_id, name, phone, message)
values (:'destination_id', :'someone_else_user_id', 'Spoofing Test', '0700000000', 'spoofed user_id');
rollback;

-- Case 5: authenticated caller submitting as themselves. Expect: SUCCEEDS.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'self_user_id', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into booking_inquiries (destination_id, user_id, name, phone, message)
values (:'destination_id', :'self_user_id', 'Legit Signed-In User', '0700000000', 'signed-in, own id');
rollback;

-- Case 6: authenticated caller omitting status entirely (the real
-- mobile client's actual payload shape) — status is filled in by the
-- column default ('new'), which satisfies the check. Expect: SUCCEEDS.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'self_user_id', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into booking_inquiries (destination_id, user_id, name, phone, message)
values (:'destination_id', :'self_user_id', 'Legit Signed-In User', '0700000000', 'signed-in, status omitted');
rollback;
