-- supabase/migrations/20260802100800_revoke_anon_execute_learn_functions.sql
--
-- join_class(text) (20260802100300_join_class_function.sql) and
-- class_episode_listen_counts(uuid) (20260802100400_class_episode_listen_counts_function.sql)
-- both did `revoke all ... from public; grant execute ... to
-- authenticated`, which is insufficient on this Supabase project:
-- alter default privileges grants EXECUTE to anon explicitly at
-- function-creation time (see 20260728130000_revoke_default_execute_grants.sql),
-- independent of (and not removed by) revoking PUBLIC.
--
-- Without this, an unauthenticated caller can call join_class('ABC123')
-- and distinguish a valid code (NOT-NULL violation on
-- class_members.user_id, since auth.uid() is null for anon) from an
-- invalid one ("no class found for that code") — a join-code oracle
-- requiring no account. class_episode_listen_counts is defence in depth
-- here (its own ownership check already returns zero rows for anon
-- since auth.uid() is null), but is included for the same
-- belt-and-suspenders reasoning 20260728130000 applies.
--
-- Fix-forward via a new migration, per this project's convention — the
-- two functions' own defining migrations are already applied to the
-- live project and are never edited in place (see 20260802100700's own
-- precedent for the same pattern, copied here).

revoke execute on function join_class(text) from anon;
revoke execute on function class_episode_listen_counts(uuid) from anon;
