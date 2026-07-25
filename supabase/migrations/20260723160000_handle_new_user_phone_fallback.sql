-- supabase/migrations/20260723160000_handle_new_user_phone_fallback.sql

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role, coin_balance)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1),
      case
        when new.phone is not null and length(new.phone) >= 4
          then 'Listener •••' || right(new.phone, 4)
      end,
      'New Listener'
    ),
    'listener',
    0
  );
  return new;
end;
$$;
