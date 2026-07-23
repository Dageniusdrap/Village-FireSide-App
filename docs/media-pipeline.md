# Media Pipeline

## Storage buckets

| Bucket              | Public? | Purpose                                                       | Written by                           |
| ------------------- | ------- | ------------------------------------------------------------- | ------------------------------------ |
| `images`            | Yes     | Series/episode covers, destination photos, contributor photos | Admin only                           |
| `audio-episodes`    | No      | Final, published episode audio                                | Admin only; read via signed URL only |
| `audio-raw`         | No      | Raw elder-recording archive                                   | Admin only, never public             |
| `consent-documents` | No      | Scanned signed consent agreements                             | Admin only, never public             |

Access to all four buckets is controlled by policies on `storage.objects`
(see `docs/rls-policies.md` is not the right place for storage policies —
they live in `supabase/migrations/20260722120000_storage_buckets.sql` and
are summarized above). `images` is the only bucket with a public read
policy; the other three are `is_admin()`-only, with no public policy at
all — the app never reads from them directly.

## Audio pipeline

- Format: MP3, 128kbps mono (speech doesn't need stereo or higher
  bitrate — this keeps files small for African data costs).
- Naming convention: `{series_slug}/{episode_number}-{lang}.mp3` — e.g.
  `voices-of-buganda/03-en.mp3`.
- **`episodes.audio_url` stores this bucket-relative object path, not a
  playable URL.** The `audio-episodes` bucket is private, so nothing in
  it is directly reachable — every playback goes through
  `get-episode-audio` (below), which mints a short-lived signed URL.

## Image pipeline

- Format: WebP, max 1600px wide.
- Served as public URLs directly from the `images` bucket — no signed
  URL step, since the bucket (and its storage policy) is public.

## `get-episode-audio` Edge Function

`supabase/functions/get-episode-audio/index.ts`. Request:
`POST { episode_id: string }` with an optional `Authorization: Bearer
<jwt>` header (omitted or invalid — treated as an anonymous/guest
caller, per Prompt 5's guest-browsing rule; guests can still unlock free
episodes this way).

Responses:

| Status | Body                           | Meaning                                                                                                                 |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ signedUrl, expiresIn }`     | Access granted; `signedUrl` is valid for `expiresIn` (21600) seconds.                                                   |
| 400    | `{ error: "invalid_request" }` | `episode_id` missing or not a UUID.                                                                                     |
| 403    | `{ error: "locked" }`          | Episode exists and is published, but the caller doesn't have access (not free, no unlock, not premium).                 |
| 404    | `{ error: "not_found" }`       | Episode doesn't exist or isn't published — deliberately indistinguishable, so a client can't probe draft content by ID. |
| 500    | `{ error: "internal_error" }`  | Unexpected server error; details are logged server-side only.                                                           |

Access logic: `access_tier = 'free'` always passes. Otherwise, a signed-in
caller passes if they have an `unlocks` row for the episode, or if
`profiles.is_premium` is true and `premium_expires_at` is null or in the
future. Every successful (200) response logs one row to `plays`.

## `plays` table

Basic analytics: one row per successful audio-URL grant (`user_id`
nullable for guests, `episode_id`, `played_at`). Extended later by
Prompt 17's `play_events` table for richer event tracking
(started/completed/downloaded/shared/unlocked) — `plays` itself is not
replaced, just supplemented.

## Deferred to later prompts

- **zod input validation and rate limiting** on `get-episode-audio` (and
  edge functions generally) — Prompt 18's security audit.
- **Admin upload UI** for all four buckets — Prompt 14.
- **DRM** on downloaded files — noted as a future option in Prompt 10's
  offline-downloads work, not applicable to this prompt.
