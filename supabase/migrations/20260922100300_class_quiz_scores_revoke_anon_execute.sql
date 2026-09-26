-- supabase/migrations/20260922100300_class_quiz_scores_revoke_anon_execute.sql
--
-- Supabase's project-level default privileges grant `anon` its own
-- execute ACL entry on every new function, independent of
-- `revoke all ... from public` (see 20260922100105 for the identical
-- fix on record_listening_day, and 20260728130000 / 20260802100800 for
-- earlier occurrences of this same gap). class_quiz_scores' own
-- internal `teacher_id = auth.uid()` check already excludes anon from
-- any real data access; this closes the grant itself as defense in
-- depth, matching the repo's established convention.

revoke execute on function class_quiz_scores(uuid) from anon;
