-- supabase/migrations/20260722100100_cultural_groups_indexes.sql

create index cultural_groups_country_published_idx on cultural_groups (country, is_published);

create index series_cultural_groups_cultural_group_id_idx on series_cultural_groups (cultural_group_id);

create index contributor_cultural_groups_cultural_group_id_idx on contributor_cultural_groups (cultural_group_id);
