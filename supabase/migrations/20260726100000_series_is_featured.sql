-- supabase/migrations/20260726100000_series_is_featured.sql
alter table series add column is_featured boolean not null default false;
