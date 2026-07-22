# Village Fireside — Storage Buckets & Media Pipeline (Prompt 4 of 23)

Status: Approved
Date: 2026-07-22

## Context

Prompts 2, 3, and 3B established the core schema, contributor/consent
schema, and cultural-groups schema, all as hand-applied SQL migrations —
no Supabase CLI, no Docker, no local Postgres in this environment
(`docs/architecture.md`). This prompt (Prompt 4 in `docs/PROMPT_PACK.md`)
adds the storage layer: four Supabase Storage buckets, their access
policies, a `plays` table for basic analytics, and a real
`get-episode-audio` Edge Function that mints short-lived signed URLs
after checking a caller's access rights.

**Convention extended to storage:** Supabase Storage buckets and their
`storage.objects` policies are fully expressible in SQL
(`insert into storage.buckets`, `create policy ... on storage.objects`),
so this prompt follows the same hand-applied-migration convention as
every table/RLS migration so far, rather than requiring manual bucket
creation via the Supabase Studio UI.

**Edge Function, written but not runnable here:** `supabase/functions/`
doesn't exist yet. Prompt 4 calls for a real Deno/TypeScript Edge
Function with actual access-control logic — this spec treats it exactly
like the SQL migrations: full source is written now, verified
structurally (parsing/shape checks, not execution), and deployed by hand
later (Supabase Dashboard or CLI, outside this session) the same way SQL
files are pasted into Studio's SQL editor.

## Goals

- Four storage buckets (`audio-episodes`, `audio-raw`, `images`,
  `consent-documents`) created via SQL migration, with policies on
  `storage.objects` exactly matching the prompt's access rules.
- `plays` table (`id`, `user_id` nullable, `episode_id`, `played_at`),
  with RLS and indexes decided explicitly where the prompt didn't specify
  them (see Design).
- `supabase/functions/get-episode-audio/index.ts`: full working logic —
  verify the episode is published, check free/unlock/premium access,
  mint a 6-hour signed URL, log a `plays` row on success, return a clear
  403 error code when locked.
- `docs/media-pipeline.md` documenting bucket purposes, the audio/image
  upload conventions, the `get-episode-audio` contract, and the
  reinterpretation of `episodes.audio_url` (see Design → Reused column).

## Non-goals

- No admin upload UI (buckets/forms) — that's Prompt 14.
- No zod input validation or rate limiting on the Edge Function — Prompt
  18's security audit is the pass that adds those consistently across
  _all_ edge functions; adding them piecemeal now would be redone there.
  This prompt does a minimal manual shape check (UUID format) instead.
- No DRM on downloaded files — out of scope entirely for this prompt;
  Prompt 10 already notes DRM as a future v-next consideration for
  offline downloads.
- No changes to `episodes`, `profiles`, or `unlocks` schemas beyond
  reading from them — this prompt only adds new tables/buckets/functions.

## Design

### Storage buckets

`supabase/migrations/20260722_storage_buckets.sql`:

`insert into storage.buckets (id, name, public) values (...)` for all
four buckets in one statement — `images` is `public = true`; the other
three (`audio-episodes`, `audio-raw`, `consent-documents`) are
`public = false`.

### Storage policies

Policies on `storage.objects` (RLS is already enabled on that table by
Supabase itself — this migration does not attempt to re-enable it):

| Bucket              | Policy                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `images`            | Public `select` policy (`bucket_id = 'images'`) **plus** an `is_admin()` `for all` policy (`bucket_id = 'images' and is_admin()`) — permissive policies OR together, so admins get full read/write and everyone else gets read-only, safely combined.                                                                                       |
| `audio-episodes`    | **Only** an `is_admin()` `for all` policy. No public select policy at all — public playback never goes through RLS; it goes through the signed URL the Edge Function mints using the service-role key, which bypasses RLS entirely. This matches the prompt's "no public read... access via signed URL generated server-side" line exactly. |
| `audio-raw`         | Same as `audio-episodes`: `is_admin()` `for all` only. Raw elder recordings archive, never public.                                                                                                                                                                                                                                          |
| `consent-documents` | Same pattern: `is_admin()` `for all` only. Scanned signed agreements, never public.                                                                                                                                                                                                                                                         |

`is_admin()` is reused from `supabase/migrations/20260721150500_rls_policies.sql`,
not redefined — same convention as Prompts 2, 3, and 3B.

### `plays` table

`supabase/migrations/20260722_plays_table.sql`:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid references profiles (id) on delete set null` — nullable,
  because guest plays (no account) are explicitly supported by the
  Edge Function design below. `on delete set null` (not cascade) because
  a play-count analytics row shouldn't disappear just because the
  listener's account was later deleted.
- `episode_id uuid not null references episodes (id) on delete cascade`
  — a play record has no independent meaning once its episode is gone.
- `played_at timestamptz not null default now()`

**RLS, a gap the prompt pack leaves unspecified for this table:** enabled;
owner can `select` own rows (`user_id = auth.uid()`); `is_admin()` `for
all` for admin/debugging access. **No insert/update/delete policy for
`anon`/`authenticated`** — every row is written by the Edge Function
using the service-role key, the same "insert only via service role"
pattern Prompt 2 established for `unlocks` and `transactions`.

**Indexes:** `plays (episode_id, played_at)` — covers both per-episode
counts and the time-windowed queries Prompt 17's analytics page needs
("plays over 7/30/90 days", "top 5 episodes"). `plays (user_id)` — the
owner-only `select` RLS policy filters on this column, so it needs its
own index rather than relying on the FK's implicit lookup cost.

### Reused column: `episodes.audio_url`

Prompt 2 created `episodes.audio_url TEXT` before any storage design
existed. This prompt fixes its meaning: **`audio_url` stores the
object path inside the private `audio-episodes` bucket** (e.g.
`voices-of-buganda/03-en.mp3`), not a playable URL — the bucket is
private, so nothing is directly playable without a signed URL. This is
called out explicitly in `docs/media-pipeline.md` since it changes how
an existing column is interpreted, not just what's new.

### `get-episode-audio` Edge Function

`supabase/functions/get-episode-audio/index.ts`. Two Supabase clients are
constructed inside the function:

1. An anon-key client, given the caller's JWT (from the `Authorization`
   header), used only to resolve `auth.getUser()`.
2. A service-role client (using the `SUPABASE_SERVICE_ROLE_KEY` the
   Supabase platform auto-injects into every Edge Function's environment
   — no manual secret configuration needed), used for every actual data
   read/write: fetching the episode, checking `unlocks`/`profiles`,
   minting the signed URL, and inserting the `plays` row.

**Guest-friendly by design:** guest mode (Prompt 5) means unauthenticated
calls must still succeed for free episodes. If the `Authorization` header
is missing or the token doesn't resolve to a user, the function treats
the caller as anonymous rather than failing the request outright — an
anonymous caller simply won't pass the unlock/premium checks below, so
free episodes still work and paid ones correctly 403.

**Logic:**

1. Parse `episode_id` from the JSON body. Reject non-UUID-shaped input
   with `400 { error: "invalid_request" }`.
2. Fetch the episode via the service-role client. If missing or
   `status != 'published'` → `404 { error: "not_found" }` (deliberately
   uninformative — doesn't distinguish "doesn't exist" from "not
   published yet", so a client can't probe draft content by ID).
3. Access check, in order:
   - `access_tier = 'free'` → allowed.
   - Else, if a user was resolved: allowed if an `unlocks` row exists for
     `(user_id, episode_id)`, **or** `profiles.is_premium` is true and
     (`premium_expires_at is null` or in the future).
   - Else → denied.
4. Denied → `403 { error: "locked" }`. Allowed → continue.
5. `storage.from('audio-episodes').createSignedUrl(audio_url, 21600)`
   (21600s = 6 hours, per the prompt). Insert a `plays` row
   (`user_id` or `null`, `episode_id`, default `played_at`).
6. Return `200 { signedUrl, expiresIn: 21600 }`.
7. Basic CORS preflight (`OPTIONS`) handling, matching the standard
   Supabase Edge Function boilerplate, so browser-based callers (e.g. a
   future admin preview) aren't blocked.
8. Unexpected errors: caught, logged via `console.error` (captured by
   Supabase's function logs), respond `500 { error: "internal_error" }`
   — no internal detail leaked to the client.

### Documentation: `docs/media-pipeline.md`

- **Buckets table:** name, public/private, purpose, who writes to it —
  the four-bucket list above.
- **Audio pipeline:** MP3 128kbps mono for speech (small files for
  African data costs); naming convention
  `{series_slug}/{episode_number}-{lang}.mp3`; the `audio_url`
  reinterpretation from Design → Reused column, stated explicitly.
- **Image pipeline:** WebP, max 1600px wide, served as public URLs
  directly from the `images` bucket — no signed URL needed, it's public.
- **`get-episode-audio` contract:** request/response shapes, all three
  outcomes (200 + signed URL, 403 locked, 404 not found), the 6-hour
  expiry.
- **`plays` table:** what it's for (basic analytics now, extended by
  Prompt 17's `play_events` later), and that every row is written
  server-side only — never directly by a client.
- **Deferred items, named explicitly:** zod validation + rate limiting
  (→ Prompt 18), the actual admin upload UI (→ Prompt 14), DRM
  (cross-referenced to Prompt 10's downloaded-files note, not otherwise
  applicable here).

## Verification

- Same approach as Prompts 2, 3, and 3B: no live Postgres or Deno runtime
  in this environment (no Docker, no Supabase CLI) — verification is
  structural for the SQL (balanced parens, expected statement counts,
  cross-file name/column references) and for the Edge Function (valid
  TypeScript shape via a syntax-level check — e.g. balanced
  braces/parens, presence of the expected exported `Deno.serve` handler,
  no accidental redefinition of `is_admin()`/`set_updated_at()`).
- `docs/media-pipeline.md` covers every bucket, the `plays` table, the
  full Edge Function contract, and the `audio_url` reinterpretation.
- Applying the 2 migration files and deploying the Edge Function to the
  real Supabase project, in order, after Prompts 2/3/3B's migrations, is
  the authoritative end-to-end test (out of this prompt's scope, per the
  Context section above).

## Out of scope for this sub-project

Admin upload UI (Prompt 14); zod validation and rate limiting on Edge
Functions generally (Prompt 18); RevenueCat/mobile-money purchase flows
that will also consume signed URLs indirectly (Prompts 9, 16); DRM on
downloads (Prompt 10, already noted there as future work); any change to
`episodes`, `profiles`, or `unlocks` beyond reading from them.
