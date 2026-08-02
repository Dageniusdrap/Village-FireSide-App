-- supabase/migrations/20260802100600_fix_classes_member_select_rls_recursion.sql
--
-- classes_member_select (20260802100200_teacher_requests_and_classes_rls.sql)
-- checks membership via `exists (select 1 from class_members where
-- class_members.class_id = classes.id and class_members.user_id =
-- auth.uid())`. class_members' own select policies
-- (class_members_teacher_select) check ownership via `exists (select 1
-- from classes where classes.id = class_members.class_id and
-- classes.teacher_id = auth.uid())`. Evaluating either policy under RLS
-- re-triggers the other table's RLS evaluation, which re-triggers the
-- first again — Postgres detects this as infinite recursion (SQLSTATE
-- 42P17) and errors out on ANY query against either table. Confirmed
-- live during this migration set's own post-apply verification (Task 6
-- of docs/superpowers/plans/2026-08-02-learn-tab.md) — every one of the
-- six planned class_members RLS check cases failed with this error
-- before this fix.
--
-- Fix: give classes_member_select's membership check a SECURITY DEFINER
-- escape hatch, mirroring is_admin()'s existing pattern for exactly this
-- kind of cross-table RLS cycle (see is_admin()'s own comment in
-- 20260721150500_rls_policies.sql). is_class_member() reads
-- class_members as its owning role — SECURITY DEFINER functions bypass
-- RLS on the tables they query internally — so evaluating classes'
-- policy no longer re-enters class_members' policies, breaking the
-- cycle. class_members_teacher_select is left as a plain EXISTS against
-- classes (unchanged): only one side of a mutual reference needs to
-- bypass RLS to eliminate a cycle, and classes_teacher_select (a plain
-- auth.uid() comparison, no subquery) means evaluating classes' RLS from
-- inside class_members_teacher_select's subquery never itself re-enters
-- class_members.
--
-- No explicit revoke/grant here, matching is_admin()'s own precedent —
-- Supabase's default privileges grant EXECUTE on every new public-schema
-- function to anon and authenticated automatically
-- (20260728130000_revoke_default_execute_grants.sql documents this
-- default). is_class_member() only ever reads the caller's own
-- auth.uid()-scoped rows, same harmless-read rationale is_admin() relies
-- on — it is not a privileged-write function like unlock_episode or
-- apply_revenuecat_event, so it does not need that migration's revoke.

create or replace function is_class_member(p_class_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from class_members
    where class_members.class_id = p_class_id
      and class_members.user_id = auth.uid()
  );
$$;

drop policy classes_member_select on classes;

create policy classes_member_select
  on classes for select
  using (is_class_member(classes.id));
