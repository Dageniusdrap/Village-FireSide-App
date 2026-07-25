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
`is_premium`, or `role` unless the request is running as the `service_role`.
This exists because RLS policies control _row_ access, not individual
_column_ writes — a `WHERE`-style check can't easily say "this row, but
not these three columns." The trigger is what actually stops a user from
crediting themselves coins through their own-row `UPDATE` policy below.

## Policy by table

### `profiles`

- **Select/update own row** (`profiles_select_own`, `profiles_update_own`):
  any request where `auth.uid() = id`. No policy lets one user read
  another user's profile.
- `coin_balance`, `is_premium`, and `role` are blocked from changing via
  the trigger described above, regardless of which policy let the
  `UPDATE` through.

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

### `favorites`, `listening_progress`

- **Owner full access** (`*_owner_all`): select/insert/update/delete
  restricted to `auth.uid() = user_id`. Both tables are user-mutable
  state — adding/removing a favorite, updating playback position — so
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

- **Anyone can insert** (`booking_inquiries_insert_anyone`): `WITH CHECK
(true)` — including unauthenticated guests, so someone doesn't need an
  account to ask about a trip.
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
