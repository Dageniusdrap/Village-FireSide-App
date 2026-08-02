-- supabase/migrations/20260802100700_approve_teacher_request_function.sql
--
-- Makes admin teacher-request approval's two writes — profiles.role and
-- teacher_requests.status — a single atomic transaction, mirroring
-- apply_revenuecat_event's shape (20260728120000_apply_revenuecat_event_function.sql).
--
-- Before this function existed, apps/admin/src/app/teacher-requests/actions.ts
-- did these as two separate .update() calls through the Supabase JS
-- client. Any failure between them (e.g. the second update erroring)
-- left a profile promoted to 'teacher' while its originating request
-- stayed 'pending' forever, with no way to tell from the row alone
-- whether the approval had actually completed.
--
-- Same risk pattern as unlock_episode / apply_revenuecat_event
-- (see 20260728130000_revoke_default_execute_grants.sql): this function
-- takes a plain p_user_id argument rather than deriving identity from
-- auth.uid(), and performs a privileged write (profiles.role) that
-- prevent_protected_profile_changes() blocks for any caller whose
-- auth.role() isn't 'service_role'. Deliberately NOT security definer —
-- like apply_revenuecat_event, its whole trust model is "only the
-- service role can ever invoke this", not "this function's owner can
-- bypass RLS on the caller's behalf". auth.role() reads the calling
-- connection's JWT claim (a session-level setting), which SECURITY
-- DEFINER does not change, so the trigger check inside this function
-- still depends on the actual caller being the service role — exactly
-- as it does for the two separate .update() calls this replaces. The
-- admin Server Action must keep calling this via
-- apps/admin/src/lib/supabase/service-role.ts, never the cookie-scoped
-- client.

create or replace function approve_teacher_request(p_request_id uuid, p_user_id uuid)
returns void
language plpgsql
as $$
begin
  update profiles
     set role = 'teacher'
   where id = p_user_id;

  update teacher_requests
     set status = 'approved'
   where id = p_request_id;
end;
$$;

-- Same trust boundary as unlock_episode / apply_revenuecat_event:
-- callable only by the service role (from the admin app's Server
-- Action), never by a client. Explicit revoke from anon/authenticated
-- closes Supabase's default-privileges gap immediately (see
-- 20260728130000's comment for why `revoke ... from public` alone isn't
-- sufficient on a Supabase project) rather than needing a follow-up
-- cleanup migration.
revoke all on function approve_teacher_request(uuid, uuid) from public;
revoke execute on function approve_teacher_request(uuid, uuid) from anon, authenticated;
grant execute on function approve_teacher_request(uuid, uuid) to service_role;
