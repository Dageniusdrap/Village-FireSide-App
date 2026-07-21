-- supabase/migrations/20260721150300_updated_at_triggers.sql

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on profiles
  for each row
  execute function set_updated_at();

create trigger destinations_set_updated_at
  before update on destinations
  for each row
  execute function set_updated_at();

create trigger series_set_updated_at
  before update on series
  for each row
  execute function set_updated_at();

create trigger episodes_set_updated_at
  before update on episodes
  for each row
  execute function set_updated_at();

create trigger listening_progress_set_updated_at
  before update on listening_progress
  for each row
  execute function set_updated_at();
