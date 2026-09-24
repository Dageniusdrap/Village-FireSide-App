-- supabase/migrations/20260922100100_listener_streaks_and_record_listening_day.sql

create table listener_streaks (
  user_id uuid primary key references profiles (id) on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_listen_date date,
  last_ember_spent_at timestamptz
);

alter table listener_streaks enable row level security;

create policy listener_streaks_owner_select
  on listener_streaks for select
  using (user_id = auth.uid());

create or replace function record_listening_day(p_local_date date)
returns listener_streaks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row listener_streaks;
  v_gap int;
  v_ember_available boolean;
begin
  -- Defensive bound on the client-supplied date (see the spec's
  -- "Timezone handling" section). Wide enough for any real timezone
  -- offset (max ~14h), narrow enough to reject a tampered/garbage value.
  if p_local_date > (now() at time zone 'utc')::date + 1
     or p_local_date < (now() at time zone 'utc')::date - 1 then
    raise exception 'p_local_date out of acceptable range';
  end if;

  select * into v_row from listener_streaks
    where user_id = auth.uid() for update;

  if not found then
    insert into listener_streaks (user_id, current_streak, longest_streak, last_listen_date)
    values (auth.uid(), 1, 1, p_local_date)
    returning * into v_row;
    return v_row;
  end if;

  if v_row.last_listen_date = p_local_date then
    return v_row; -- already recorded today — no-op
  end if;

  v_gap := p_local_date - v_row.last_listen_date;

  if v_gap <= 0 then
    -- Client date is behind our stored last_listen_date (clock skew or
    -- an out-of-order call). Do nothing rather than risk destroying a
    -- real streak on untrusted-but-stale input.
    return v_row;
  elsif v_gap = 1 then
    update listener_streaks set
      current_streak = v_row.current_streak + 1,
      longest_streak = greatest(v_row.longest_streak, v_row.current_streak + 1),
      last_listen_date = p_local_date
    where user_id = auth.uid()
    returning * into v_row;
  elsif v_gap = 2 then
    v_ember_available := v_row.last_ember_spent_at is null
      or now() - v_row.last_ember_spent_at >= interval '7 days';
    if v_ember_available then
      update listener_streaks set
        current_streak = v_row.current_streak + 1,
        longest_streak = greatest(v_row.longest_streak, v_row.current_streak + 1),
        last_listen_date = p_local_date,
        last_ember_spent_at = now()
      where user_id = auth.uid()
      returning * into v_row;
    else
      update listener_streaks set
        current_streak = 1,
        last_listen_date = p_local_date
      where user_id = auth.uid()
      returning * into v_row;
    end if;
  else
    update listener_streaks set
      current_streak = 1,
      last_listen_date = p_local_date
    where user_id = auth.uid()
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function record_listening_day(date) from public;
grant execute on function record_listening_day(date) to authenticated;
