-- supabase/migrations/20260721160200_contributor_consent_indexes.sql

create index contributors_contributor_type_idx on contributors (contributor_type);

create index consents_contributor_id_consent_type_idx on consents (contributor_id, consent_type);

create index episodes_content_source_idx on episodes (content_source);

create index episodes_subject_area_grade_level_idx on episodes (subject_area, grade_level);

create index episode_contributors_contributor_id_idx on episode_contributors (contributor_id);
