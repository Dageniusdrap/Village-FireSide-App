-- supabase/migrations/20260728120000_apply_revenuecat_event_function.sql
--
-- Makes revenuecat-webhook's two writes — the `transactions` row that
-- marks a RevenueCat event as processed, and the `profiles` mutation
-- that actually credits coins or moves premium state — a single atomic
-- transaction, mirroring `unlock_episode`'s shape.
--
-- Before this function existed the webhook did those two writes in two
-- separate round trips through the Supabase JS client: the idempotency
-- marker committed first, then the profile update ran (and its error was
-- discarded). Any transient failure between the two left a transactions
-- row claiming a purchase had been applied while the balance/premium
-- change never happened — and since the function still returned 200,
-- RevenueCat never retried. Doing both inside one plpgsql function means
-- either both writes commit or neither does, and any genuine failure
-- propagates to the caller so it can return a non-2xx and let
-- RevenueCat retry.
--
-- Concurrency: the profile mutations below are all *relative* SQL
-- updates (`coin_balance = coin_balance + n`, `greatest(...)`), never an
-- absolute value computed in TypeScript from an earlier read. Postgres
-- serializes concurrent `UPDATE`s of the same row and re-evaluates the
-- expression against the committed value, which is the same row-level
-- write serialization `unlock_episode`'s decrement relies on. That
-- closes both the unlock-vs-credit and the credit-vs-credit lost-update
-- races.

create or replace function apply_revenuecat_event(
  p_user_id uuid,
  p_event_id text,
  p_action text,
  p_coins bigint default 0,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
as $$
declare
  v_transaction_type transaction_type;
  v_coins bigint;
begin
  if p_action not in ('credit_coins', 'set_premium', 'expire_premium', 'log_only') then
    raise exception 'apply_revenuecat_event: unknown action %', p_action;
  end if;

  if p_action = 'set_premium' and p_expires_at is null then
    raise exception 'apply_revenuecat_event: set_premium requires p_expires_at';
  end if;

  if p_action = 'credit_coins' then
    v_transaction_type := 'coin_purchase';
    v_coins := coalesce(p_coins, 0);
  else
    v_transaction_type := 'subscription';
    v_coins := 0;
  end if;

  begin
    insert into transactions (user_id, transaction_type, amount, coins_delta, reference)
    values (p_user_id, v_transaction_type, v_coins, v_coins, p_event_id);
  exception
    when unique_violation then
      -- A previous (or concurrently in-flight) delivery of this same
      -- RevenueCat event already won the unique index on
      -- `transactions.reference`. The nested block's implicit savepoint
      -- rolls back this insert attempt, and returning here skips the
      -- profile mutation entirely — a replay is a no-op, never a
      -- double credit. Same shape as unlock_episode's already-unlocked
      -- short-circuit.
      return jsonb_build_object('result', 'already_processed');
  end;

  -- A `p_user_id` that isn't a real profile never reaches this point:
  -- the insert above violates transactions' foreign key to profiles and
  -- raises 23503, which is deliberately NOT caught here so the caller
  -- can distinguish it from a retryable failure.

  if p_action = 'credit_coins' then
    update profiles
       set coin_balance = coin_balance + v_coins
     where id = p_user_id;

  elsif p_action = 'set_premium' then
    -- Event-ordering guard: a stale or out-of-order grant must never
    -- shorten a subscriber's access, so premium_expires_at only ever
    -- moves forward (`greatest`). is_premium is then derived from that
    -- resulting expiry rather than being forced true, so replaying an
    -- old already-lapsed purchase can't resurrect premium.
    update profiles
       set premium_expires_at = greatest(coalesce(premium_expires_at, p_expires_at), p_expires_at),
           is_premium = greatest(coalesce(premium_expires_at, p_expires_at), p_expires_at) > now()
     where id = p_user_id;

  elsif p_action = 'expire_premium' then
    -- Event-ordering guard: only expire if the stored expiry is not
    -- newer than the expiry this EXPIRATION event refers to. If a
    -- renewal already pushed premium_expires_at past that point, this
    -- event is stale and must not revoke a paying subscriber's access.
    -- Falls back to now() when the event carries no expiration time.
    update profiles
       set is_premium = false
     where id = p_user_id
       and (
         premium_expires_at is null
         or premium_expires_at <= coalesce(p_expires_at, now())
       );

  end if;
  -- 'log_only': the transactions row above is the entire effect.

  return jsonb_build_object('result', 'applied');
end;
$$;

-- Same trust boundary as unlock_episode: callable only by the service
-- role (from the revenuecat-webhook edge function), never by a client.
revoke execute on function apply_revenuecat_event(uuid, text, text, bigint, timestamptz) from public;
grant execute on function apply_revenuecat_event(uuid, text, text, bigint, timestamptz) to service_role;
