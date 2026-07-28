-- supabase/migrations/20260726120100_unlock_episode_function.sql

create or replace function unlock_episode(p_user_id uuid, p_episode_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_episode record;
  v_balance bigint;
  v_already_unlocked boolean;
begin
  select access_tier, coin_price into v_episode
  from episodes
  where id = p_episode_id and status = 'published';

  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  if v_episode.access_tier <> 'coins' then
    return jsonb_build_object('result', 'not_coin_gated');
  end if;

  select exists(
    select 1 from unlocks where user_id = p_user_id and episode_id = p_episode_id
  ) into v_already_unlocked;

  if v_already_unlocked then
    return jsonb_build_object('result', 'already_unlocked');
  end if;

  begin
    select coin_balance into v_balance
    from profiles
    where id = p_user_id
    for update;

    -- Without this guard a missing profile row leaves v_balance NULL,
    -- `NULL < price` evaluates to NULL (not true), and the function
    -- falls through to decrement/insert against a user that doesn't
    -- exist. Fail loudly instead — the edge function turns this into a
    -- logged 500 rather than a silent no-op.
    if not found then
      raise exception 'unlock_episode: no profiles row for user %', p_user_id;
    end if;

    if v_balance < v_episode.coin_price then
      return jsonb_build_object(
        'result', 'insufficient_coins',
        'balance', v_balance,
        'price', v_episode.coin_price
      );
    end if;

    update profiles set coin_balance = coin_balance - v_episode.coin_price where id = p_user_id;

    insert into unlocks (user_id, episode_id) values (p_user_id, p_episode_id);

    insert into transactions (user_id, transaction_type, amount, coins_delta, episode_id)
    values (p_user_id, 'episode_unlock', v_episode.coin_price, -v_episode.coin_price, p_episode_id);

    return jsonb_build_object('result', 'unlocked');
  exception
    when unique_violation then
      -- A concurrent call for the same user+episode won the race between
      -- our already-unlocked check above and this block's balance lock:
      -- it already inserted the unlocks row and committed by the time we
      -- got here. The nested block's implicit savepoint rolls back this
      -- block's own effects (including our redundant decrement) before
      -- this handler runs, so no double-charge persists.
      return jsonb_build_object('result', 'already_unlocked');
  end;
end;
$$;

-- "Service role only" is an invariant this function's whole trust model
-- depends on (it takes p_user_id as an argument instead of reading
-- auth.uid(), so anyone able to execute it could unlock episodes as any
-- user). Postgres grants EXECUTE on new functions to PUBLIC by default,
-- which would let any authenticated client call it through PostgREST —
-- revoke that and grant it only to the role the unlock-episode edge
-- function uses.
revoke execute on function unlock_episode(uuid, uuid) from public;
grant execute on function unlock_episode(uuid, uuid) to service_role;
