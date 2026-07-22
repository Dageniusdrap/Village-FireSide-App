# Storage Buckets & Media Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the storage layer (Prompt 4) as 2 hand-applied SQL migration files, 1 Supabase Edge Function, and docs updates — 4 storage buckets + policies, a `plays` table, and a working `get-episode-audio` function that mints signed URLs after an access check.

**Architecture:** Two migration files (storage buckets/policies, then the `plays` table), continuing the "one file per concern" convention from Prompts 2, 3, and 3B. A new `supabase/functions/get-episode-audio/index.ts` Edge Function is written as real, complete source — verified structurally, not executed (no Deno runtime in this environment). `is_admin()` is reused from Prompt 2's already-applied migration, not redefined.

**Tech Stack:** Postgres (via Supabase) raw SQL DDL for the migrations; Deno/TypeScript (Supabase Edge Functions runtime) for the function, using `@supabase/supabase-js` via an `esm.sh` import (no npm install step exists for Deno functions).

## Global Constraints

- No Supabase CLI, no Docker, no local Supabase stack, no Deno runtime in this environment — nothing in this plan requires running Postgres or executing the Edge Function; verification is structural throughout.
- Table/column/bucket names must exactly match the design spec (`docs/superpowers/specs/2026-07-22-storage-media-pipeline-design.md`) unless a task explicitly justifies a deviation.
- RLS is enabled on the `plays` table — reuse `is_admin()` from `supabase/migrations/20260721150500_rls_policies.sql`, do not redefine it.
- `storage.objects` already has RLS enabled by Supabase itself — do NOT add `alter table storage.objects enable row level security`.
- `episodes.audio_url` now means the object path inside the private `audio-episodes` bucket (e.g. `voices-of-buganda/03-en.mp3`), not a playable URL — this is a reinterpretation of an existing Prompt 2 column, not a new one.
- No zod validation, no rate limiting, no admin upload UI — all explicitly deferred to Prompts 18 and 14 respectively; this plan only notes that future intent in prose.
- Every migration file is applied exactly once, in filename order; files are not idempotent (no `IF NOT EXISTS` guards).

---

### Task 1: Storage buckets + `storage.objects` policies

**Files:**

- Create: `supabase/migrations/20260722120000_storage_buckets.sql`

**Interfaces:**

- Consumes: `is_admin()` (from `supabase/migrations/20260721150500_rls_policies.sql`, already applied — do not redefine it).
- Produces: 4 storage buckets (`audio-episodes`, `audio-raw`, `images`, `consent-documents`) and their `storage.objects` policies — consumed by Task 3 (the Edge Function reads/writes `audio-episodes` via the service role, which bypasses these policies entirely, but the bucket must exist first).

**Bucket `public` flags, matching the approved design spec:** `images` is `public = true` (public read via the storage public-URL scheme). `audio-episodes`, `audio-raw`, `consent-documents` are all `public = false` — nothing in them is reachable without either `is_admin()` or a signed URL minted server-side.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260722120000_storage_buckets.sql

insert into storage.buckets (id, name, public)
values
  ('audio-episodes', 'audio-episodes', false),
  ('audio-raw', 'audio-raw', false),
  ('images', 'images', true),
  ('consent-documents', 'consent-documents', false);

-- images: public can read; admin has full read/write/delete access.
create policy images_select_public
  on storage.objects for select
  using (bucket_id = 'images');

create policy images_admin_all
  on storage.objects for all
  using (bucket_id = 'images' and is_admin())
  with check (bucket_id = 'images' and is_admin());

-- audio-episodes: no public read at all — playback is only ever via a
-- signed URL minted server-side by the get-episode-audio Edge Function
-- (using the service role, which bypasses RLS entirely).
create policy audio_episodes_admin_all
  on storage.objects for all
  using (bucket_id = 'audio-episodes' and is_admin())
  with check (bucket_id = 'audio-episodes' and is_admin());

-- audio-raw: raw elder recordings archive, admin only, never public.
create policy audio_raw_admin_all
  on storage.objects for all
  using (bucket_id = 'audio-raw' and is_admin())
  with check (bucket_id = 'audio-raw' and is_admin());

-- consent-documents: scanned signed agreements, admin only, never public.
create policy consent_documents_admin_all
  on storage.objects for all
  using (bucket_id = 'consent-documents' and is_admin())
  with check (bucket_id = 'consent-documents' and is_admin());
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260722120000_storage_buckets.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert sql.count("insert into storage.buckets") == 1
for bucket in ["audio-episodes", "audio-raw", "images", "consent-documents"]:
    assert f"'{bucket}'" in sql, f"missing bucket: {bucket}"
assert "'images', 'images', true" in sql, "images bucket must be public"
assert "'audio-episodes', 'audio-episodes', false" in sql
assert "'audio-raw', 'audio-raw', false" in sql
assert "'consent-documents', 'consent-documents', false" in sql
assert sql.count("create policy") == 5, f"expected 5 policies, found {sql.count('create policy')}"
assert "enable row level security" not in sql, "storage.objects RLS is already enabled by Supabase — do not re-enable it"
assert "create or replace function is_admin" not in sql, "must NOT redefine is_admin()"
print("OK: 4 buckets + 5 policies present, is_admin() reused not redefined, parens balanced")
PY
```

Expected: `OK: 4 buckets + 5 policies present, is_admin() reused not redefined, parens balanced`

- [ ] **Step 3: Verify `is_admin()` exists in an already-applied migration**

```bash
grep -q "create or replace function is_admin" supabase/migrations/20260721150500_rls_policies.sql && echo "is_admin: OK"
```

Expected: `is_admin: OK`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260722120000_storage_buckets.sql
git commit -m "feat: add storage buckets and storage.objects policies"
```

---

### Task 2: `plays` table

**Files:**

- Create: `supabase/migrations/20260722120100_plays_table.sql`

**Interfaces:**

- Consumes: `profiles` and `episodes` tables (already applied, from Prompt 2); `is_admin()` (from Prompt 2's already-applied migration).
- Produces: table `plays` with columns `id`, `user_id` (nullable), `episode_id`, `played_at` — consumed by Task 3 (the Edge Function inserts a row into it on every successful signed-URL mint).

**Nullability and delete behavior, matching the approved design spec:** `user_id` is nullable (`on delete set null`) to support guest plays and to avoid deleting analytics history when an account is later removed. `episode_id` is `NOT NULL` (`on delete cascade`) since a play record has no independent meaning once its episode is gone.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260722120100_plays_table.sql

create table plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  episode_id uuid not null references episodes (id) on delete cascade,
  played_at timestamptz not null default now()
);

create index plays_episode_id_played_at_idx on plays (episode_id, played_at);
create index plays_user_id_idx on plays (user_id);

alter table plays enable row level security;

create policy plays_select_own
  on plays for select
  using (auth.uid() = user_id);

create policy plays_admin_all
  on plays for all
  using (is_admin())
  with check (is_admin());
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260722120100_plays_table.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert sql.count("create table") == 1
assert "create table plays " in sql
assert "references profiles (id) on delete set null" in sql
assert "references episodes (id) on delete cascade" in sql
assert sql.count("create index") == 2
assert "plays (episode_id, played_at)" in sql
assert "plays (user_id)" in sql
assert "alter table plays enable row level security" in sql
assert sql.count("create policy") == 2
assert "create or replace function is_admin" not in sql, "must NOT redefine is_admin()"
print("OK: plays table + 2 indexes + RLS (2 policies) present, is_admin() reused not redefined, parens balanced")
PY
```

Expected: `OK: plays table + 2 indexes + RLS (2 policies) present, is_admin() reused not redefined, parens balanced`

- [ ] **Step 3: Verify referenced tables (`profiles`, `episodes`) exist in already-applied migrations**

```bash
grep -q "create table profiles " supabase/migrations/20260721150100_core_tables.sql && echo "profiles: OK"
grep -q "create table episodes " supabase/migrations/20260721150100_core_tables.sql && echo "episodes: OK"
```

Expected: both `OK` lines printed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260722120100_plays_table.sql
git commit -m "feat: add plays table"
```

---

### Task 3: `get-episode-audio` Edge Function

**Files:**

- Create: `supabase/functions/get-episode-audio/index.ts`

**Interfaces:**

- Consumes: `episodes`, `unlocks`, `profiles`, `plays` tables (from Task 2 and already-applied migrations); the `audio-episodes` storage bucket (from Task 1). Reads `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from the environment — these are auto-injected into every Supabase Edge Function by the platform, no manual secret configuration needed.
- Produces: an HTTP endpoint. Request body: `{ episode_id: string }` (UUID), `Authorization: Bearer <jwt>` header (optional — absent or invalid means an anonymous/guest caller). Responses: `200 { signedUrl: string, expiresIn: 21600 }`, `400 { error: "invalid_request" }`, `403 { error: "locked" }`, `404 { error: "not_found" }`, `500 { error: "internal_error" }`. Nothing else in this plan consumes this function directly (the mobile player wires it up in Prompt 8).

- [ ] **Step 1: Write the function file**

```typescript
// supabase/functions/get-episode-audio/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGNED_URL_TTL_SECONDS = 21600; // 6 hours

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let episodeId: unknown;
  try {
    const body = await req.json();
    episodeId = body.episode_id;
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  if (typeof episodeId !== "string" || !UUID_RE.test(episodeId)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");

  const supabaseAnon = createClient(supabaseUrl, anonKey);
  const supabaseService = createClient(supabaseUrl, serviceRoleKey);

  let userId: string | null = null;
  if (jwt) {
    const { data, error } = await supabaseAnon.auth.getUser(jwt);
    if (!error && data.user) {
      userId = data.user.id;
    }
  }

  try {
    const { data: episode, error: episodeError } = await supabaseService
      .from("episodes")
      .select("id, status, access_tier, audio_url")
      .eq("id", episodeId)
      .maybeSingle();

    if (episodeError) throw episodeError;

    if (!episode || episode.status !== "published" || !episode.audio_url) {
      return jsonResponse({ error: "not_found" }, 404);
    }

    let allowed = episode.access_tier === "free";

    if (!allowed && userId) {
      const { data: unlock } = await supabaseService
        .from("unlocks")
        .select("user_id")
        .eq("user_id", userId)
        .eq("episode_id", episodeId)
        .maybeSingle();

      if (unlock) {
        allowed = true;
      } else {
        const { data: profile } = await supabaseService
          .from("profiles")
          .select("is_premium, premium_expires_at")
          .eq("id", userId)
          .maybeSingle();

        if (
          profile?.is_premium &&
          (!profile.premium_expires_at || new Date(profile.premium_expires_at) > new Date())
        ) {
          allowed = true;
        }
      }
    }

    if (!allowed) {
      return jsonResponse({ error: "locked" }, 403);
    }

    const { data: signedUrlData, error: signedUrlError } = await supabaseService.storage
      .from("audio-episodes")
      .createSignedUrl(episode.audio_url, SIGNED_URL_TTL_SECONDS);

    if (signedUrlError || !signedUrlData) {
      throw signedUrlError ?? new Error("failed to create signed url");
    }

    await supabaseService.from("plays").insert({
      user_id: userId,
      episode_id: episodeId,
    });

    return jsonResponse(
      { signedUrl: signedUrlData.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS },
      200,
    );
  } catch (err) {
    console.error("get-episode-audio error:", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
ts = open("supabase/functions/get-episode-audio/index.ts").read()
assert ts.count("{") == ts.count("}"), "unbalanced braces"
assert ts.count("(") == ts.count(")"), "unbalanced parentheses"
assert "Deno.serve(" in ts
assert 'req.method === "OPTIONS"' in ts, "must handle CORS preflight"
for code in ['"invalid_request"', '"not_found"', '"locked"', '"internal_error"']:
    assert code in ts, f"missing error code: {code}"
assert "createSignedUrl(" in ts
assert '"audio-episodes"' in ts
assert "SIGNED_URL_TTL_SECONDS = 21600" in ts
assert 'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")' in ts
assert 'Deno.env.get("SUPABASE_ANON_KEY")' in ts
assert '.from("plays")' in ts and ".insert(" in ts
assert '.from("unlocks")' in ts
assert '.from("profiles")' in ts
assert "is_premium" in ts and "premium_expires_at" in ts
print("OK: Deno.serve handler present, all error codes covered, signed-url + plays-insert + access-check logic present, braces/parens balanced")
PY
```

Expected: `OK: Deno.serve handler present, all error codes covered, signed-url + plays-insert + access-check logic present, braces/parens balanced`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/get-episode-audio/index.ts
git commit -m "feat: add get-episode-audio edge function"
```

---

### Task 4: Documentation (`docs/media-pipeline.md`, `docs/schema.md`, `docs/rls-policies.md`)

**Files:**

- Create: `docs/media-pipeline.md`
- Modify: `docs/schema.md`
- Modify: `docs/rls-policies.md`

**Interfaces:**

- Consumes: the full storage/media design from Tasks 1–3 (this task only documents it).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write `docs/media-pipeline.md`**

```markdown
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
```

- [ ] **Step 2: Append a `plays` table section to `docs/schema.md`, at the end of the file**

Read the live file first — whitespace may have shifted slightly from
Prettier reformatting. Append this section at the very end of
`docs/schema.md`:

```markdown
## `plays`

One row per successful `get-episode-audio` grant — basic listening
analytics (extended later by Prompt 17's `play_events` table).

| Column       | Type             | Notes                                                                                                 |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `id`         | `uuid`, PK       |                                                                                                       |
| `user_id`    | `uuid`, nullable | FK → `profiles`, `ON DELETE SET NULL`. Null for guest plays.                                          |
| `episode_id` | `uuid`, not null | FK → `episodes`, `ON DELETE CASCADE`.                                                                 |
| `played_at`  | `timestamptz`    | Defaults to `now()`; not auto-maintained (no update trigger — a play is never edited, only inserted). |

Every row is written by the `get-episode-audio` Edge Function using the
service role — no client ever inserts into this table directly.
```

- [ ] **Step 3: Append a `plays` section to `docs/rls-policies.md`, at the end of the file**

```markdown
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
```

- [ ] **Step 4: Verify all three docs reference the new work**

```bash
python3 - <<'PY'
media = open("docs/media-pipeline.md").read()
schema = open("docs/schema.md").read()
rls = open("docs/rls-policies.md").read()

for bucket in ["audio-episodes", "audio-raw", "images", "consent-documents"]:
    assert bucket in media, f"docs/media-pipeline.md missing bucket: {bucket}"

assert "get-episode-audio" in media
assert "21600" in media
assert "plays" in media
assert "zod" in media, "must name the deferred zod validation"
assert "Prompt 18" in media
assert "Prompt 14" in media

assert "`plays`" in schema, "docs/schema.md missing plays table entry"
assert "`plays`" in rls, "docs/rls-policies.md missing plays section"
assert "plays_select_own" in rls
assert "plays_admin_all" in rls

print("OK: media-pipeline.md covers all buckets/function/deferrals; schema.md and rls-policies.md document plays")
PY
```

Expected: `OK: media-pipeline.md covers all buckets/function/deferrals; schema.md and rls-policies.md document plays`

- [ ] **Step 5: Verify no existing content was lost**

```bash
git diff --stat docs/schema.md docs/rls-policies.md
```

Expected: only insertions (`+`) reported for both files — no line should
show as a net content deletion beyond incidental Prettier re-padding. If
anything looks like a real deletion (a whole row/section missing), stop
and investigate before committing.

- [ ] **Step 6: Commit**

```bash
git add docs/media-pipeline.md docs/schema.md docs/rls-policies.md
git commit -m "docs: document storage buckets, plays table, and get-episode-audio"
```

---

## Verification (whole plan)

- Both migration files exist in `supabase/migrations/`, named in applied
  order, each passing its task's structural check above.
- `supabase/functions/get-episode-audio/index.ts` exists and passes its
  structural check (balanced braces/parens, all 5 response codes, the
  full access-check + signed-url + plays-insert logic present).
- `docs/media-pipeline.md` exists and covers every bucket, the function
  contract, the `plays` table, and every deferred item named explicitly.
  `docs/schema.md` and `docs/rls-policies.md` document `plays` like every
  other table, without disturbing existing content.
- No zod dependency, no rate limiting, no admin upload UI was added —
  all three remain explicitly deferred per the approved spec.
- `git log --oneline` shows 4 new commits, one per task.
- Applying the 2 migration files by hand to the real Supabase project,
  after Prompts 2/3/3B's files, and deploying the Edge Function via the
  Supabase Dashboard or CLI, is the authoritative end-to-end test (out of
  this plan's scope, per Global Constraints).
