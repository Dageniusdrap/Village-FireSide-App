-- supabase/migrations/20260922100105_record_listening_day_revoke_anon_execute.sql

revoke execute on function record_listening_day(date) from anon;
