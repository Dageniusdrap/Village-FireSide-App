-- supabase/migrations/20260721160000_contributor_consent_enums.sql

create type contributor_type as enum ('elder', 'voice_artist', 'writer', 'tour_guide', 'historian', 'translator');

create type consent_type as enum ('story_recording', 'voice_cloning', 'photo', 'video', 'translation', 'archive');

create type consent_status as enum ('granted', 'granted_with_conditions', 'declined', 'revoked');

create type content_source as enum ('elder_testimony', 'narrated_production', 'ai_assisted', 'tour_guide_original');

create type subject_area as enum ('history', 'biology', 'geography', 'culture', 'conservation', 'folklore');

create type grade_level as enum ('primary', 'o_level', 'a_level', 'tertiary', 'general');
