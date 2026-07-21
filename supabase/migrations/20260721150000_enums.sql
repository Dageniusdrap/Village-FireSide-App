-- supabase/migrations/20260721150000_enums.sql

create type user_role as enum ('listener', 'teacher', 'guide', 'admin');

create type episode_status as enum ('draft', 'review', 'published', 'archived');

create type access_tier as enum ('free', 'coins', 'premium');

create type content_language as enum ('en', 'lg', 'sw', 'fr', 'rw');

create type inquiry_status as enum ('new', 'contacted', 'closed');

create type transaction_type as enum ('coin_purchase', 'episode_unlock', 'subscription', 'refund');
