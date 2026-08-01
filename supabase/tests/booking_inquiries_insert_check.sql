-- supabase/tests/booking_inquiries_insert_check.sql
--
-- Manual verification for booking_inquiries_insert_anyone's WITH CHECK
-- clause (supabase/migrations/20260801100000_tighten_booking_inquiries_insert_check.sql).
--
-- Not automated: this repo has no pgTAP/RLS test harness yet (no
-- `supabase/tests/*` runner is wired into `pnpm test` or CI), and this
-- environment has no Supabase CLI / local Postgres to execute it against.
-- Run this by hand — paste it into the Supabase SQL editor for a
-- non-production project, or `psql` connected via `supabase db` — before
-- trusting the policy in production. Prompt 18 ("Security & RLS Audit") is
-- where this project's own docs (docs/PROMPT_PACK.md) already call for
-- turning checks like this into real pgTAP tests
-- (`pg_prove`/`pgtap.extension`) that run in CI; when that lands, the two
-- rejection cases and the one acceptance case below should become
-- `throws_ok()`/`lives_ok()` assertions instead of hand-run `DO` blocks.
--
-- Replace the two placeholder UUIDs below with real ids from a disposable
-- project before running (a real destination id, and two distinct real
-- profile ids — "self" and "someone_else").

\set destination_id '00000000-0000-0000-0000-000000000001'
\set self_user_id '00000000-0000-0000-0000-000000000002'
\set someone_else_user_id '00000000-0000-0000-0000-000000000003'

-- 1. Guest (anon, no JWT at all) — legitimate shape must succeed.
--    Mirrors apps/mobile/.../inquire.tsx's actual insert: no `status` in
--    the payload, `user_id: null`.
begin;
  set local role anon;
  insert into booking_inquiries (destination_id, user_id, name, phone, message)
  values (:'destination_id', null, 'Test Guest', '0700000000', 'Manual RLS check — guest, legit shape');
  -- Expected: 1 row inserted, status = 'new' (the column default).
rollback;

-- 2. Guest attempting to spoof status — must be REJECTED.
begin;
  set local role anon;
  insert into booking_inquiries (destination_id, user_id, name, phone, message, status)
  values (:'destination_id', null, 'Malicious Guest', '0700000000', 'Manual RLS check — spoofed status', 'closed');
  -- Expected: ERROR — new row violates row-level security policy for
  -- table "booking_inquiries".
rollback;

-- 3. Authenticated caller attempting to attribute the inquiry to a
--    DIFFERENT user's id — must be REJECTED.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub": "self_user_id_placeholder", "role": "authenticated"}';
  -- ^ substitute the actual value of :'self_user_id' into the JSON above
  --   (psql \set doesn't interpolate inside a single-quoted JSON string —
  --   replace by hand when running this).
  insert into booking_inquiries (destination_id, user_id, name, phone, message)
  values (:'destination_id', :'someone_else_user_id', 'Spoofing Test', '0700000000', 'Manual RLS check — spoofed user_id');
  -- Expected: ERROR — new row violates row-level security policy for
  -- table "booking_inquiries" (user_id doesn't equal auth.uid()).
rollback;

-- 4. Authenticated caller submitting as themselves — must succeed.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub": "self_user_id_placeholder", "role": "authenticated"}';
  -- ^ same substitution note as case 3.
  insert into booking_inquiries (destination_id, user_id, name, phone, message)
  values (:'destination_id', :'self_user_id', 'Legit Signed-In User', '0700000000', 'Manual RLS check — signed-in, own id');
  -- Expected: 1 row inserted.
rollback;
