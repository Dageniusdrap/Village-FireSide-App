-- supabase/migrations/20260801100000_tighten_booking_inquiries_insert_check.sql
--
-- booking_inquiries_insert_anyone's WITH CHECK (true) let any inserter —
-- including an unauthenticated guest — set `status` to anything (not just
-- the intended `'new'`) and set `user_id` to any profile id, not just their
-- own. Prompt 11 makes this endpoint publicly reachable for the first time
-- (the Booking Inquiry form), so the gap needs closing before real users
-- hit it.
--
-- The mobile client already never sends `status` in its insert payload and
-- already sends `user_id: session?.user.id ?? null` (apps/mobile/src/app/(app)/
-- destination/[slug]/inquire.tsx) — this migration makes that the only thing
-- the database will accept, rather than merely the only thing the client
-- happens to send today.
--
-- status: rather than a trigger that silently overwrites a tampered value,
-- this rejects the insert outright when status isn't 'new' — Postgres
-- evaluates WITH CHECK against the row's final values, so a payload that
-- omits `status` entirely (the client's actual behavior) still passes,
-- since the column's own `default 'new'` fills it in before the check runs.
-- An insert that explicitly tries `status: 'closed'` (or anything else)
-- fails the whole insert with an RLS violation, rather than being quietly
-- corrected — fail-closed, and the legitimate client path never touches
-- this edge at all since it never sends the field.
--
-- user_id: `user_id is null or user_id = auth.uid()` allows a guest (no
-- session, auth.uid() is null) only to submit with user_id null, and an
-- authenticated caller only to attribute the inquiry to their own account —
-- never someone else's.
alter policy booking_inquiries_insert_anyone
  on booking_inquiries
  with check (
    status = 'new'
    and (user_id is null or user_id = auth.uid())
  );
