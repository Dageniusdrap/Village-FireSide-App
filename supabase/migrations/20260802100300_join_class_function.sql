-- supabase/migrations/20260802100300_join_class_function.sql

create or replace function join_class(p_join_code text)
returns table (class_id uuid, class_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id uuid;
  v_class_name text;
begin
  select id, name into v_class_id, v_class_name
  from classes
  where join_code = upper(trim(p_join_code));

  if v_class_id is null then
    raise exception 'join_class: no class found for that code';
  end if;

  insert into class_members (class_id, user_id)
  values (v_class_id, auth.uid())
  on conflict (class_id, user_id) do nothing;

  return query select v_class_id, v_class_name;
end;
$$;

revoke all on function join_class(text) from public;
grant execute on function join_class(text) to authenticated;
