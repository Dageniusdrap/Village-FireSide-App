-- supabase/migrations/20260802100200_teacher_requests_and_classes_rls.sql

alter table teacher_requests enable row level security;

-- A signed-in user can request their own teacher account; status starts
-- and stays 'pending' from this policy's perspective — only is_admin()
-- (via the update policy below) can move it to 'approved'/'rejected'.
create policy teacher_requests_insert_own
  on teacher_requests for insert
  to authenticated
  with check (user_id = auth.uid() and status = 'pending');

create policy teacher_requests_admin_select
  on teacher_requests for select
  using (is_admin());

create policy teacher_requests_admin_update
  on teacher_requests for update
  using (is_admin())
  with check (is_admin());

alter table classes enable row level security;

create policy classes_teacher_select
  on classes for select
  using (teacher_id = auth.uid());

-- A joined student needs to read their class's name (e.g. "My Classes"
-- list) — this is deliberately separate from classes_teacher_select
-- (stacked, OR'd policies) rather than one combined expression, matching
-- this schema's existing style (see class_members below, and
-- booking_inquiries' separate admin-select/insert-anyone policies).
create policy classes_member_select
  on classes for select
  using (
    exists (
      select 1 from class_members
      where class_members.class_id = classes.id
        and class_members.user_id = auth.uid()
    )
  );

create policy classes_teacher_insert
  on classes for insert
  to authenticated
  with check (teacher_id = auth.uid());

alter table class_assignments enable row level security;

create policy class_assignments_teacher_select
  on class_assignments for select
  using (
    exists (
      select 1 from classes
      where classes.id = class_assignments.class_id
        and classes.teacher_id = auth.uid()
    )
  );

create policy class_assignments_member_select
  on class_assignments for select
  using (
    exists (
      select 1 from class_members
      where class_members.class_id = class_assignments.class_id
        and class_members.user_id = auth.uid()
    )
  );

create policy class_assignments_teacher_insert
  on class_assignments for insert
  to authenticated
  with check (
    exists (
      select 1 from classes
      where classes.id = class_assignments.class_id
        and classes.teacher_id = auth.uid()
    )
  );

alter table class_members enable row level security;

-- Member lists are "visible to the teacher only" per the Prompt 12 spec
-- text — this policy is what enforces that; a classmate has no select
-- policy that would let them see another member's row (see
-- class_members_student_select_own below, scoped to auth.uid() only).
create policy class_members_teacher_select
  on class_members for select
  using (
    exists (
      select 1 from classes
      where classes.id = class_members.class_id
        and classes.teacher_id = auth.uid()
    )
  );

create policy class_members_student_select_own
  on class_members for select
  using (user_id = auth.uid());

-- Deliberately NO insert policy here. class_members rows are only ever
-- created by join_class() (Task 5), a SECURITY DEFINER function that
-- bypasses RLS as its owning role — a direct client insert attempt is
-- rejected (RLS defaults to deny when no policy matches the command),
-- even for an authenticated user. This is what "students join with the
-- code" actually means: through the function, never a raw table write.
