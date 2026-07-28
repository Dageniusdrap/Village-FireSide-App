-- supabase/migrations/20260728120100_protect_premium_expires_at.sql
--
-- `premium_expires_at` was writable by any signed-in user: profiles_update_own
-- lets a user UPDATE their own row, and prevent_protected_profile_changes()
-- only guarded coin_balance / is_premium / role — so a client could push its
-- own premium expiry years into the future. Add premium_expires_at to the
-- guarded set, so "the client is never trusted with premium state" is
-- enforced rather than just documented.
--
-- The definition in 20260721150500_rls_policies.sql has been corrected to
-- match, but that migration also contains non-idempotent CREATE TABLE /
-- CREATE POLICY statements and can't simply be re-run against an already
-- provisioned database. This standalone `create or replace function` is
-- the applyable form; the two bodies are intentionally identical.

create or replace function prevent_protected_profile_changes()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role' then
    if new.coin_balance is distinct from old.coin_balance
      or new.is_premium is distinct from old.is_premium
      or new.premium_expires_at is distinct from old.premium_expires_at
      or new.role is distinct from old.role
    then
      raise exception 'coin_balance, is_premium, premium_expires_at, and role can only be changed by the service role';
    end if;
  end if;
  return new;
end;
$$;
