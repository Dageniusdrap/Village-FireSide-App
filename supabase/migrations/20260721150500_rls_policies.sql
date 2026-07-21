-- supabase/migrations/20260721150500_rls_policies.sql

-- Admin check helper, used by several tables' policies below. SECURITY
-- DEFINER so its internal query against `profiles` isn't itself subject
-- to the calling policy's RLS evaluation (avoids recursion).
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Blocks changes to coin_balance / is_premium / role from any request
-- that isn't running as the service role, regardless of which RLS policy
-- let the UPDATE through.
create or replace function prevent_protected_profile_changes()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role' then
    if new.coin_balance is distinct from old.coin_balance
      or new.is_premium is distinct from old.is_premium
      or new.role is distinct from old.role
    then
      raise exception 'coin_balance, is_premium, and role can only be changed by the service role';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on profiles
  for each row
  execute function prevent_protected_profile_changes();

-- profiles: owner can read/update their own row; protected columns are
-- blocked by the trigger above, not by this policy.
alter table profiles enable row level security;

create policy profiles_select_own
  on profiles for select
  using (auth.uid() = id);

create policy profiles_update_own
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- destinations: public can read published rows; admins have full access.
alter table destinations enable row level security;

create policy destinations_select_published
  on destinations for select
  using (is_published = true);

create policy destinations_admin_all
  on destinations for all
  using (is_admin())
  with check (is_admin());

-- series: same pattern as destinations.
alter table series enable row level security;

create policy series_select_published
  on series for select
  using (is_published = true);

create policy series_admin_all
  on series for all
  using (is_admin())
  with check (is_admin());

-- episodes: same pattern, gated on status instead of a boolean.
alter table episodes enable row level security;

create policy episodes_select_published
  on episodes for select
  using (status = 'published');

create policy episodes_admin_all
  on episodes for all
  using (is_admin())
  with check (is_admin());

-- destination_media: visible when its parent destination is published;
-- admins have full access. (Not specified in the original prompt pack;
-- resolved in the design spec to mirror its parent table.)
alter table destination_media enable row level security;

create policy destination_media_select_published
  on destination_media for select
  using (
    exists (
      select 1 from destinations d
      where d.id = destination_media.destination_id
        and d.is_published = true
    )
  );

create policy destination_media_admin_all
  on destination_media for all
  using (is_admin())
  with check (is_admin());

-- favorites: full CRUD restricted to the owning user.
alter table favorites enable row level security;

create policy favorites_owner_all
  on favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- listening_progress: full CRUD restricted to the owning user.
alter table listening_progress enable row level security;

create policy listening_progress_owner_all
  on listening_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- unlocks: owner can read their own unlocks. No insert/update/delete
-- policy for anon/authenticated at all — service_role bypasses RLS by
-- default, so "insert only via service role" needs no explicit policy.
alter table unlocks enable row level security;

create policy unlocks_select_own
  on unlocks for select
  using (auth.uid() = user_id);

-- transactions: same read-only-to-owner pattern as unlocks.
alter table transactions enable row level security;

create policy transactions_select_own
  on transactions for select
  using (auth.uid() = user_id);

-- booking_inquiries: anyone (including guests) can submit an inquiry;
-- only admins can read or update them.
alter table booking_inquiries enable row level security;

create policy booking_inquiries_insert_anyone
  on booking_inquiries for insert
  with check (true);

create policy booking_inquiries_admin_select
  on booking_inquiries for select
  using (is_admin());

create policy booking_inquiries_admin_update
  on booking_inquiries for update
  using (is_admin())
  with check (is_admin());
