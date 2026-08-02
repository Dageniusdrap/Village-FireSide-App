# Row Level Security Policies

Every table in this schema has RLS enabled — see `docs/schema.md` for the
schema itself. This document explains what each policy allows and, where
it isn't obvious, why.

## Two helper mechanisms used throughout

**`is_admin()`** — a `SECURITY DEFINER` SQL function that checks whether
the current request's user has `role = 'admin'` in `profiles`. Several
tables' "admin has full access" policies call this instead of querying
`profiles` directly from within the policy, because `profiles` itself has
RLS enabled — a plain subquery risks recursive RLS evaluation.
`SECURITY DEFINER` runs the function with its owner's privileges, so its
internal query isn't subject to the calling policy's own RLS check.

**`prevent_protected_profile_changes()`** — a `BEFORE UPDATE` trigger on
`profiles` (not an RLS policy) that blocks any change to `coin_balance`,
`is_premium`, `premium_expires_at`, or `role` unless the request is running
as the `service_role`.
This exists because RLS policies control _row_ access, not individual
_column_ writes — a `WHERE`-style check can't easily say "this row, but
not these four columns." The trigger is what actually stops a user from
crediting themselves coins — or extending their own premium expiry —
through their own-row `UPDATE` policy below.

## Policy by table

### `profiles`

- **Select/update own row** (`profiles_select_own`, `profiles_update_own`):
  any request where `auth.uid() = id`. No policy lets one user read
  another user's profile.
- `coin_balance`, `is_premium`, `premium_expires_at`, and `role` are
  blocked from changing via the trigger described above, regardless of
  which policy let the `UPDATE` through.

### `destinations`, `series`

- **Public select** (`*_select_published`): anyone — including
  unauthenticated (`anon`) requests — can read rows where
  `is_published = true`.
- **Admin full access** (`*_admin_all`): `is_admin()` grants
  select/insert/update/delete on every row, published or not.
- Non-admin write attempts have no matching policy at all, so they're
  denied by default (no explicit "deny" rule was needed).

### `episodes`

Same pattern as `destinations`/`series`, but public visibility is gated
on `status = 'published'` instead of a boolean column.

### `destination_media`

- **Public select** (`destination_media_select_published`): visible when
  its parent `destinations` row has `is_published = true` (checked via a
  subquery on `destination_id`).
- **Admin full access**: same `is_admin()` pattern as the content tables.

This table isn't mentioned in the original schema requirements' RLS list;
this policy set was chosen to mirror its parent table, matching the
pattern every other content table uses.

### `favorites`, `listening_progress`, `episode_bookmarks`

- **Owner full access** (`*_owner_all`): select/insert/update/delete
  restricted to `auth.uid() = user_id`. All three tables are user-mutable
  state — adding/removing a favorite, updating playback position, creating/updating bookmarks — so
  "owner only" was read as full CRUD rather than read-only.

### `unlocks`, `transactions`

- **Owner select only** (`*_select_own`): a user can see their own
  unlock/transaction history, but nothing else.
- No insert/update/delete policy exists for `anon`/`authenticated` at
  all. This is intentional, not an oversight: Supabase's `service_role`
  bypasses RLS entirely by default, so it doesn't need an explicit
  policy to write these tables — omitting a policy for every other role
  is what "insert only via service role" means in practice. Coin unlocks
  and financial transactions are written by server-side code (Next.js
  server actions using the service role key), never directly by a
  client.

### `booking_inquiries`

- **Anyone can insert** (`booking_inquiries_insert_anyone`) — including
  unauthenticated guests, so someone doesn't need an account to ask about
  a trip. The `WITH CHECK` clause constrains what an inserted row can
  actually contain:
  `status = 'new' and (user_id is null or user_id = auth.uid())`.
  - `status = 'new'`: the client's insert payload never includes `status`
    at all (`apps/mobile/src/app/(app)/destination/[slug]/inquire.tsx`),
    so the column's own `default 'new'` fills it in and this check passes
    trivially for every legitimate submission. It exists to reject, not
    silently correct, a payload that explicitly tries a different value.
  - `user_id is null or user_id = auth.uid()`: a guest (no session,
    `auth.uid()` is null) can only submit with `user_id` null; a
    signed-in caller can only attribute the inquiry to their own account,
    never someone else's.
  - **History:** this table's original policy (`with check (true)`,
    `supabase/migrations/20260721150500_rls_policies.sql`) placed no
    constraint on either column — anyone could insert with `status` set to
    e.g. `'closed'`, or `user_id` set to any other real profile id,
    spoofing an inquiry's attribution. That was low-risk while nothing in
    the app actually called this endpoint; Prompt 11 (the Explore tab's
    Booking Inquiry form) made it publicly reachable for the first time,
    which is what prompted tightening it in
    `supabase/migrations/20260801100000_tighten_booking_inquiries_insert_check.sql`.
  - **Manual verification:** `supabase/manual-checks/booking_inquiries_insert_check.sql`
    has six runnable SQL cases, each plain SQL in its own
    `BEGIN ... ROLLBACK`, with a comment stating the expected outcome to
    check by eye against the actual `psql` output (`INSERT 0 1` vs. an
    RLS-violation `ERROR`): three rejection cases — spoofed `status`, a
    guest spoofing a non-null `user_id` (the one case that depends on
    `WITH CHECK` rejecting a `NULL`-valued expression rather than a
    `false` one, since `auth.uid()` is null for an anon request), and an
    authenticated caller spoofing someone else's `user_id` — plus three
    acceptance cases (guest and signed-in, both submitting the legitimate
    shape, and signed-in with `status` omitted, matching the real client's
    payload exactly). Deliberately **not** under `supabase/tests/` — that
    path is the Supabase CLI's reserved pgTAP directory
    (`supabase test db` globs it), and this script would break that
    runner the moment it exists. This project has no automated RLS test
    harness yet at all — no pgTAP runner is wired into `pnpm test` or CI,
    and there's no local Postgres/Supabase CLI available to execute
    against in this environment — so it's a manual script, not an
    automated test. Prompt 18 ("Security & RLS Audit," see
    `docs/PROMPT_PACK.md`) is explicitly where this project plans to add
    pgTAP-based RLS testing; when that lands, this file's six cases are
    the natural first `throws_ok()`/`lives_ok()` assertions to port into
    `supabase/tests/`.
  - **Known open gaps, not closed by this fix:** the insert endpoint is
    still unauthenticated, unrate-limited, and has no length bound on
    `message`/`name`/etc. — someone could flood the table or submit very
    large payloads. Pre-existing, out of scope here, and Prompt 18
    territory alongside the RLS test harness above.
- **Admin select/update** (`booking_inquiries_admin_select`,
  `booking_inquiries_admin_update`): only `is_admin()` can read or update
  inquiries (e.g. changing `status` as staff follow up). There's no
  delete policy for any role — inquiries are meant to be retained, not
  removed.

### `contributors`, `consents`, `source_materials`

No public policy at all — `is_admin()` grants a `for all` policy on
each. The only public-facing read surface onto `contributors` is the
`public_contributors` view (see `docs/schema.md`), not this table
directly.

### `episode_contributors`

- **Public select** (`episode_contributors_select_published`): visible
  when its linked `episodes` row has `status = 'published'` (checked via
  a subquery on `episode_id`) — mirrors `destination_media`'s pattern of
  visibility keyed off a parent table.
- **Admin full access** (`episode_contributors_admin_all`): same
  `is_admin()` pattern as the content tables.

### `plays`

- **Owner select** (`plays_select_own`): `auth.uid() = user_id` — a
  signed-in user can see their own play history. Guest plays
  (`user_id` null) aren't visible to anyone except admins.
- **Admin full access** (`plays_admin_all`): `is_admin()` on all
  operations.
- **No insert/update/delete policy for anon/authenticated** — every row
  is written by the `get-episode-audio` Edge Function using the service
  role, which bypasses RLS entirely. Same pattern Prompt 2 established
  for `unlocks` and `transactions`.

### `cultural_groups`, `series_cultural_groups`, `contributor_cultural_groups`

- **Public select** (`cultural_groups_select_published`): rows where
  `is_published = true`.
- **Junction tables** (`series_cultural_groups_select_published`,
  `contributor_cultural_groups_select_published`): visible when the
  linked `cultural_groups` row has `is_published = true` (checked via a
  subquery on `cultural_group_id`) — mirrors `episode_contributors`'
  pattern of visibility keyed off a parent table.
- **Admin full access** (`*_admin_all`): `is_admin()` on all three
  tables.

### `app_settings`

- **Public select** (`app_settings_select_anyone`): `using (true)` —
  anyone, including unauthenticated requests, can read every row. This
  is a config table, not user data; nothing in it is sensitive, and the
  mobile app needs to read tunables like `default_free_episode_count`
  without an admin session.
- **Admin full access** (`app_settings_admin_all`): same `is_admin()`
  pattern as the content tables.
