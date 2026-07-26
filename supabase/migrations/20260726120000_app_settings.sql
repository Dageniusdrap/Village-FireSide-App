-- supabase/migrations/20260726120000_app_settings.sql

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

create policy app_settings_select_anyone
  on app_settings for select
  using (true);

create policy app_settings_admin_all
  on app_settings for all
  using (is_admin())
  with check (is_admin());

create trigger app_settings_set_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

insert into app_settings (key, value) values
  ('default_free_episode_count', '3'),
  ('coin_pack_products', '{"coins_100": 100, "coins_500": 500, "coins_1200": 1200}'),
  ('premium_product_id', '"premium_monthly"');
