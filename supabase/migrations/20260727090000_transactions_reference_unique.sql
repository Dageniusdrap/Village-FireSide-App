-- supabase/migrations/20260727090000_transactions_reference_unique.sql
-- Enforce idempotency for webhook-sourced transactions at the database
-- level: revenuecat-webhook uses `reference` to hold the RevenueCat
-- event id, and two concurrent deliveries of the same event must not
-- both be able to insert a row for it. unlock_episode's transactions
-- inserts never set `reference` (they key off `episode_id` instead),
-- so a partial index that only constrains non-null references leaves
-- those rows unaffected.
create unique index transactions_reference_unique_idx
  on transactions (reference)
  where reference is not null;
