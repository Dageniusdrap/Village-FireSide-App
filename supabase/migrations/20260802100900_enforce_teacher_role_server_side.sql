-- supabase/migrations/20260802100900_enforce_teacher_role_server_side.sql
--
-- classes_teacher_insert (20260802100200_teacher_requests_and_classes_rls.sql)
-- only checked `teacher_id = auth.uid()` — any authenticated user, not
-- just an admin-approved teacher, could create a class, get a join
-- code, assign episodes, and read aggregate listen counts. This matches
-- the design spec's RLS table (not an implementation bug), but is worth
-- closing now since listen-counts-of-students is the sensitive surface
-- here.
--
-- Tighten the insert check to also require the caller's profile to
-- currently hold role = 'teacher', and add the same check inside
-- class_episode_listen_counts' existing ownership `exists (...)` clause
-- — this is the same profiles.role = 'teacher' check
-- docs/education.md already notes would be needed for role revocation
-- (a teacher demoted away from the role could otherwise still pull
-- listen counts for classes they created while they held it), so this
-- one condition closes both concerns at once.

drop policy classes_teacher_insert on classes;

create policy classes_teacher_insert
  on classes for insert
  to authenticated
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = 'teacher'
    )
  );

create or replace function class_episode_listen_counts(p_class_id uuid)
returns table (episode_id uuid, listener_count bigint)
language sql
security definer
set search_path = public
as $$
  select
    ca.episode_id,
    count(distinct lp.user_id) as listener_count
  from class_assignments ca
  left join class_members cm
    on cm.class_id = ca.class_id
  left join listening_progress lp
    on lp.episode_id = ca.episode_id
   and lp.user_id = cm.user_id
  where ca.class_id = p_class_id
    and exists (
      select 1 from classes c
      where c.id = p_class_id
        and c.teacher_id = auth.uid()
    )
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = 'teacher'
    )
  group by ca.episode_id;
$$;
