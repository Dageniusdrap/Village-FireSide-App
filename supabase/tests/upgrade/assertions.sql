-- supabase/tests/upgrade/assertions.sql
-- Each block raises if its check fails; run.sh fails on the first error.

do $$
begin
  if (select count(*) from auth.users where email like '%@villagefireside.app') <> 3 then
    raise exception 'upgrade: test accounts lost';
  end if;
  if (select role from profiles where id = '11111111-1111-1111-1111-111111111111') <> 'admin' then
    raise exception 'upgrade: admin role lost';
  end if;
  if (select count(*) from admin_actions) <> 5 then
    raise exception 'upgrade: admin_actions rows lost or added';
  end if;
  if (select status from episodes where id = '55555555-5555-5555-5555-555555555555') <> 'published' then
    raise exception 'upgrade: legacy episode is no longer published';
  end if;
  if (select published_at from episodes where id = '55555555-5555-5555-5555-555555555555')
     <> '2026-09-30 10:00:00+00'::timestamptz then
    raise exception 'upgrade: legacy published_at changed';
  end if;
end;
$$;
