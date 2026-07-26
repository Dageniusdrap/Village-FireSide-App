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
