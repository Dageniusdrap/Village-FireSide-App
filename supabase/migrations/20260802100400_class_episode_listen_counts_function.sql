-- supabase/migrations/20260802100400_class_episode_listen_counts_function.sql

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
  group by ca.episode_id;
$$;

revoke all on function class_episode_listen_counts(uuid) from public;
grant execute on function class_episode_listen_counts(uuid) to authenticated;
