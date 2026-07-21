-- supabase/migrations/20260721150200_indexes.sql

create index episodes_series_status_idx on episodes (series_id, status);

create index episodes_access_tier_idx on episodes (access_tier);

create index series_category_published_idx on series (category, is_published);

create index destinations_country_published_idx on destinations (country, is_published);

create index listening_progress_user_id_idx on listening_progress (user_id);

create index transactions_user_created_idx on transactions (user_id, created_at);

create index booking_inquiries_status_idx on booking_inquiries (status);
