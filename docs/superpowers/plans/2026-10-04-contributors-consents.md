# Contributors & Consents (Prompt 15A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build append-only consent records whose every write re-checks and hides affected episodes in one transaction, consent-gated contributor photos served through signed links, contributor and source-material admin screens, and the four Prompt 14 QA fixes, all covered by database tests running in CI.

**Architecture:** The rules live in Postgres. One SQL publish check (`episode_publish_check`) is shared by `publish_episode`, the consent functions (`record_consent`, `void_consent`) and protective triggers; consent and publish writes are security-definer functions called with the admin's own session. Contributor photos sit in a private bucket and reach the app only through the `get-contributor-photos` edge function. Tests run against a local Supabase stack in Docker: pgTAP for SQL, a Vitest integration package for concurrency, the edge function and agreement fingerprints.

**Tech Stack:** Supabase (Postgres 17, Storage, Edge Functions on Deno), pgTAP, Supabase CLI 2.111.0, Next.js 16 server actions, React 19, Tailwind v4, react-hook-form + zod, Vitest, `pg` (node-postgres, new, integration tests only), Expo 57 / React Native 0.86, `expo-image`, TanStack Query, Jest.

**Spec:** `docs/superpowers/specs/2026-10-04-contributors-consents-design.md` (approved; commit `9ea8d1f`)

## Global Constraints

- **Nothing touches the live project before Task 28 and the user's explicit approval there.** Every migration in Tasks 1–27 is applied with `--local`. Never run `supabase db push`, `supabase db reset --linked`, `supabase migration up --linked` or `supabase functions deploy` before Task 28. The only `--linked` command allowed earlier is the read-only `supabase migration list --linked` in Task 5, run by the user with their own token.
- **Docker must be running** for any `supabase` command with `--local` and for `supabase test db`. One local stack serves every checkout of this repo (project id `village-fireside`); run database tests from one checkout at a time.
- **Milestone stops:** after Tasks 5, 12, 15, 23, 27 and 29, stop and wait for the user's review before starting the next milestone.
- **Migration files** use the prefix sequence `20261004100000`, `20261004100100`, … in the order given by the tasks. The last pre-15A migration is `20260926100000_admin_actions.sql`. Never edit a migration once it has been committed.
- **Every new function** has `set search_path = public` and ends with `revoke execute on function … from public, anon;` (both, explicitly; see `docs/known-issues.md` on `anon`'s default privileges), followed by an explicit `grant` to exactly the roles the spec names.
- **Consent and publish writes are called with the admin's cookie session** (`createClient` from `apps/admin/src/lib/supabase/server.ts`), never the service-role client, so `auth.uid()` is the real admin. Everything else keeps Prompt 14's pattern (`requireAdmin()`, then service-role writes, then `logAdminAction()`).
- **Error codes** raised by the new SQL, matched by the admin app:

  | SQLSTATE | Meaning                                                                         |
  | -------- | ------------------------------------------------------------------------------- |
  | `42501`  | Caller is not an admin                                                          |
  | `P0002`  | Row not found                                                                   |
  | `VF001`  | Publish check failed (message lists the failing reasons)                        |
  | `VF002`  | Unverified source material needs acknowledgement                                |
  | `VF003`  | Change would break a published episode, or a publish outside `publish_episode`  |
  | `VF004`  | Consent rule violation (missing reason or document, void rules, already voided) |
  | `VF005`  | Append-only table: update, delete or truncate refused                           |

- **`pnpm test` must not need Docker.** Database and integration tests run through `pnpm test:db` and `pnpm test:integration` (root scripts), which CI's `db-tests` job calls.
- **Every task leaves `pnpm typecheck` and `pnpm lint` clean** and ends with a commit: `git commit -m "Prompt 15A: <description>"`.
- **Two deliberate deviations from the spec, flagged here:**
  1. The audit-redaction test is a Vitest unit test of `contributorAuditDetails()` (Task 16), not pgTAP: contributor create and edit are server actions, so the redaction happens in TypeScript, where the test must live.
  2. `episode_publish_check` always returns the `elder_consent` and `source_material` rows (passing when not applicable), so callers always see four rows; the spec's table already describes them as "passes when …".
- **D6 is implemented literally:** voiding a `declined` row is refused whenever, without it, the most recent counted row of that type would be `granted` or `granted_with_conditions`. That also refuses voiding an _older_ `declined` row when a newer grant exists. This never makes consent more permissive; the user may choose to relax it later.

## Review Focus

1. **Saving a published elder-testimony episode with unchanged contributor links** must succeed. Today `replaceContributorLinks` deletes every link and re-inserts them, which the new unlink trigger would refuse mid-way. Task 9 replaces it with a diff and tests the diff.
2. **Deleting a published episode** cascades to `episode_contributors`; the unlink trigger must allow it (the episode row is already gone). Pinned in Task 9's pgTAP.
3. **Voiding or revoking a `photo` consent** must not hide episodes; only `story_recording` affects the publish check. Pinned in Task 8's pgTAP.
4. **Unknown, deleted or photo-less contributor ids** sent to the photo function must simply be absent from a 200 response, never an error that blanks the whole screen. Pinned in Task 13's integration tests.
5. **Re-publishing a consent-hidden episode** after a new `granted` consent must clear `hidden_by_consent_*` and set a fresh `published_at`. Pinned in Task 9's pgTAP.

---

## Milestone 1: Test harness and CI

### Task 1: pgTAP harness with one trivial test

**Files:**

- Create: `supabase/tests/helpers/fixtures.sql`
- Create: `supabase/tests/000_harness.test.sql`
- Create: `docs/testing-database.md`
- Modify: `package.json` (root scripts)
- Modify: `.gitignore` (add `supabase/.branches/`)

**Interfaces:**

- Produces: the `tests` schema helper functions every later pgTAP file includes with `\ir helpers/fixtures.sql`:
  - `tests.create_user(p_role user_role default 'listener') returns uuid`
  - `tests.claims_for(p_user_id uuid) returns void` (sets `request.jwt.claims`; the caller then runs `set local role authenticated`)
  - `tests.create_contributor(p_type contributor_type default 'elder', p_anonymous boolean default false) returns uuid`
  - `tests.create_episode(p_content_source content_source default 'elder_testimony') returns uuid` (with audio, title, description; status `draft`)
  - `tests.link(p_episode_id uuid, p_contributor_id uuid, p_role text default 'narrator') returns void`
  - `tests.add_consent(p_contributor_id uuid, p_type consent_type, p_status consent_status, p_reason text default null) returns uuid` (direct insert, bypassing `record_consent`)
  - `tests.force_publish(p_episode_id uuid) returns void`
  - Root scripts `test:db` and `test:integration`.

- [ ] **Step 1: Write the fixtures helper**

```sql
-- supabase/tests/helpers/fixtures.sql
-- Included by every pgTAP file with \ir. Each file runs inside its own
-- begin/rollback, so everything created here disappears afterwards.

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

create or replace function tests.create_user(p_role user_role default 'listener')
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          v_id::text || '@test.local', '{}'::jsonb, now(), now());
  -- handle_new_user() created the profile as 'listener'. profiles.role can
  -- only change as the service role (profiles_protect_columns trigger).
  if p_role <> 'listener' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update public.profiles set role = p_role where id = v_id;
    perform set_config('request.jwt.claims', '{}', true);
  end if;
  return v_id;
end;
$$;

create or replace function tests.claims_for(p_user_id uuid)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
$$;

create or replace function tests.create_contributor(
  p_type contributor_type default 'elder',
  p_anonymous boolean default false
)
returns uuid
language sql
as $$
  insert into public.contributors (full_name, display_name, contributor_type, is_anonymous)
  values ('Test Contributor', 'Test Contributor', p_type, p_anonymous)
  returning id;
$$;

create or replace function tests.create_episode(
  p_content_source content_source default 'elder_testimony'
)
returns uuid
language plpgsql
as $$
declare
  v_series uuid;
  v_episode uuid;
begin
  insert into public.series (title, slug)
  values ('Test Series', 'test-series-' || gen_random_uuid())
  returning id into v_series;
  insert into public.episodes (series_id, episode_number, title, description, audio_url, content_source)
  values (v_series, 1, 'Test Episode', 'Test description', 'episodes/test.m4a', p_content_source)
  returning id into v_episode;
  return v_episode;
end;
$$;

create or replace function tests.link(
  p_episode_id uuid,
  p_contributor_id uuid,
  p_role text default 'narrator'
)
returns void
language sql
as $$
  insert into public.episode_contributors (episode_id, contributor_id, role)
  values (p_episode_id, p_contributor_id, p_role);
$$;

create or replace function tests.add_consent(
  p_contributor_id uuid,
  p_type consent_type,
  p_status consent_status,
  p_reason text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  -- Before Task 6 adds consents.reason, the reason argument is ignored.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consents' and column_name = 'reason'
  ) then
    execute 'insert into public.consents (contributor_id, consent_type, consent_status, reason)
             values ($1, $2, $3, $4) returning id'
      into v_id using p_contributor_id, p_type, p_status, coalesce(p_reason, case when p_status = 'revoked' then 'test reason' end);
  else
    insert into public.consents (contributor_id, consent_type, consent_status)
    values (p_contributor_id, p_type, p_status)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Publishes directly for fixtures. From Task 9 on, the publish-state
-- trigger only allows this because the flag matches the episode id.
create or replace function tests.force_publish(p_episode_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('app.publishing_episode', p_episode_id::text, true);
  update public.episodes set status = 'published', published_at = now() where id = p_episode_id;
  perform set_config('app.publishing_episode', '', true);
end;
$$;
```

- [ ] **Step 2: Write the trivial test**

```sql
-- supabase/tests/000_harness.test.sql
begin;
\ir helpers/fixtures.sql

select plan(3);

select has_table('public', 'admin_actions', 'the last pre-15A migration is applied');
select isnt(tests.create_user('admin'), null, 'fixture helper creates a user');
select is(
  (select role from public.profiles where id = tests.create_user('teacher')),
  'teacher'::user_role,
  'fixture helper can set a non-listener role'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run it**

Run: `supabase test db` (from the repo root, Docker running, local stack started with `supabase start`)
Expected: `000_harness.test.sql .. ok` and `All tests successful.`

If `\ir` is not supported by the CLI's test runner, stop and report the exact error to the user; every later task depends on the include.

- [ ] **Step 4: Add root scripts**

In the root `package.json` `"scripts"`, add:

```json
"test:db": "supabase test db",
"test:integration": "pnpm --filter @village-fireside/db-integration-tests test"
```

(`test:integration` starts working in Task 2.)

- [ ] **Step 4b: Ignore the Supabase CLI's branch cache**

Append to the root `.gitignore`, under the existing `supabase/.temp/` entry:

```
# Supabase CLI local branch cache, created by `supabase start`
supabase/.branches/
```

Run: `git status --short`
Expected: `supabase/.branches/` no longer listed.

- [ ] **Step 5: Document how to run the database tests**

```markdown
<!-- docs/testing-database.md -->

# Database tests

Database tests run against a local Supabase stack in Docker, never the
live project.

1. Start Docker Desktop.
2. `supabase start` (the first run downloads about 8.4 GB of images).
3. `pnpm test:db` runs every `supabase/tests/*.test.sql` file with pgTAP.
4. `pnpm test:integration` runs `packages/db-integration-tests` (concurrency,
   the photo function, agreement fingerprints).
5. `bash supabase/tests/upgrade/run.sh` resets the local database to the last
   pre-15A migration, loads live-shaped fixtures, applies the newer
   migrations, and checks nothing was lost.

Each pgTAP file runs in `begin … rollback`, so tests leave no data behind.
Shared fixtures live in `supabase/tests/helpers/fixtures.sql`.

Every `supabase db reset` and `supabase migration up` here uses `--local`.
Never use `--linked` for tests.

One local stack serves every checkout of this repo, so run database tests
from one checkout at a time.
```

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/helpers/fixtures.sql supabase/tests/000_harness.test.sql docs/testing-database.md package.json .gitignore
git commit -m "Prompt 15A: add pgTAP harness with one trivial test"
```

### Task 2: Integration-test package with one trivial test

**Files:**

- Create: `packages/db-integration-tests/package.json`
- Create: `packages/db-integration-tests/tsconfig.json`
- Create: `packages/db-integration-tests/vitest.config.ts`
- Create: `packages/db-integration-tests/src/local-stack.ts`
- Create: `packages/db-integration-tests/src/harness.test.ts`

**Interfaces:**

- Produces (`src/local-stack.ts`):
  - `LOCAL_DB_URL: string` (default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, overridable by `LOCAL_DB_URL`)
  - `LOCAL_API_URL: string` (default `http://127.0.0.1:54321`)
  - `localKeys(): { anonKey: string; serviceRoleKey: string }` (from `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` env, else `supabase status -o json`)
  - `connect(): Promise<pg.Client>` (a postgres-superuser client with `statement_timeout = 30s`)
  - `beginAs(client: pg.Client, userId: string): Promise<void>` (begin + claims + `set local role authenticated`)
  - `createUser(client: pg.Client, role: "admin" | "teacher" | "listener"): Promise<string>`

- [ ] **Step 1: Create the package files**

```json
// packages/db-integration-tests/package.json
{
  "name": "@village-fireside/db-integration-tests",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@supabase/supabase-js": "^2.110.7",
    "@types/pg": "^8.11.10",
    "@village-fireside/eslint-config": "workspace:*",
    "@village-fireside/typescript-config": "workspace:*",
    "eslint": "^9.17.0",
    "pg": "^8.13.1",
    "typescript": "^5.7.0",
    "vitest": "^4.1.10"
  }
}
```

Copy `packages/shared/eslint.config.js` into the package unchanged (same lint rules as the other packages).

```json
// packages/db-integration-tests/tsconfig.json
{
  "extends": "@village-fireside/typescript-config/base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "vitest.config.ts"]
}
```

```ts
// packages/db-integration-tests/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Hang guard only. No test asserts on elapsed time.
    testTimeout: 300_000,
    hookTimeout: 120_000,
    // Tests share one local database; run files one at a time.
    fileParallelism: false,
  },
});
```

`pnpm test` (turbo) must not pick this package up, because it needs Docker. Its script is named `test`, so exclude it in the root: change the root `"test"` script from `turbo run test` to `turbo run test --filter=!@village-fireside/db-integration-tests`.

- [ ] **Step 2: Write the local-stack helpers**

```ts
// packages/db-integration-tests/src/local-stack.ts
import { execFileSync } from "node:child_process";

import pg from "pg";

export const LOCAL_DB_URL =
  process.env.LOCAL_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const LOCAL_API_URL = process.env.LOCAL_API_URL ?? "http://127.0.0.1:54321";

let cachedKeys: { anonKey: string; serviceRoleKey: string } | null = null;

export function localKeys(): { anonKey: string; serviceRoleKey: string } {
  if (cachedKeys) {
    return cachedKeys;
  }
  const fromEnv = {
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromEnv.anonKey && fromEnv.serviceRoleKey) {
    cachedKeys = { anonKey: fromEnv.anonKey, serviceRoleKey: fromEnv.serviceRoleKey };
    return cachedKeys;
  }
  const status = JSON.parse(
    execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }),
  ) as { ANON_KEY: string; SERVICE_ROLE_KEY: string };
  cachedKeys = { anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
  return cachedKeys;
}

export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  await client.query("set statement_timeout = '30s'");
  return client;
}

export async function beginAs(client: pg.Client, userId: string): Promise<void> {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("set local role authenticated");
}

export async function createUser(
  client: pg.Client,
  role: "admin" | "teacher" | "listener",
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             gen_random_uuid()::text || '@test.local', '{}'::jsonb, now(), now())
     returning id`,
  );
  const id = rows[0].id;
  if (role !== "listener") {
    await client.query("begin");
    await client.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await client.query("update public.profiles set role = $1 where id = $2", [role, id]);
    await client.query("commit");
  }
  return id;
}
```

- [ ] **Step 3: Write the trivial test**

```ts
// packages/db-integration-tests/src/harness.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";

import { connect, createUser } from "./local-stack";

describe("integration harness", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = await connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("reaches the local database", async () => {
    const { rows } = await client.query<{ ok: number }>("select 1 as ok");
    expect(rows[0].ok).toBe(1);
  });

  it("creates an admin user", async () => {
    const id = await createUser(client, "admin");
    const { rows } = await client.query<{ role: string }>(
      "select role from public.profiles where id = $1",
      [id],
    );
    expect(rows[0].role).toBe("admin");
  });
});
```

- [ ] **Step 4: Install and run**

Run: `pnpm install && pnpm test:integration`
Expected: 2 tests pass. Then `pnpm test` still passes without touching this package (its output must not list `@village-fireside/db-integration-tests`).

Integration tests leave rows in the local database (they commit). That's intended: the local database is disposable, and `supabase db reset --local` clears it.

- [ ] **Step 5: Commit**

```bash
git add packages/db-integration-tests package.json pnpm-lock.yaml
git commit -m "Prompt 15A: add integration-test package with one trivial test"
```

### Task 3: Migration-on-existing-data harness

**Files:**

- Create: `supabase/tests/upgrade/run.sh`
- Create: `supabase/tests/upgrade/fixtures.sql`
- Create: `supabase/tests/upgrade/assertions.sql`

**Interfaces:**

- Produces: `bash supabase/tests/upgrade/run.sh`, which resets the local database to `BASELINE=20260926100000`, loads `fixtures.sql`, applies every newer migration, then runs `assertions.sql` (a series of `do` blocks that raise on failure). Task 12 extends `assertions.sql` with the 15A checks.

The mechanism was verified on 2026-10-04: `supabase db reset --local --version <v>` stops at migration `<v>` (placed after `db reset`, `--version` is the target, not the global version flag), and `supabase migration up --local` applies only the rest, keeping data inserted in between.

- [ ] **Step 1: Write the fixtures (shaped like the live project)**

```sql
-- supabase/tests/upgrade/fixtures.sql
-- Live-shaped data at the pre-15A baseline: the three test accounts, one
-- admin_actions entry of each existing type, and a published
-- elder_testimony episode with no consent (legal before 15A).

do $$
declare
  v_admin uuid := '11111111-1111-1111-1111-111111111111';
  v_teacher uuid := '22222222-2222-2222-2222-222222222222';
  v_listener uuid := '33333333-3333-3333-3333-333333333333';
  v_series uuid := '44444444-4444-4444-4444-444444444444';
  v_episode uuid := '55555555-5555-5555-5555-555555555555';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-test@villagefireside.app', '{}', now(), now()),
    (v_teacher, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teacher-test@villagefireside.app', '{}', now(), now()),
    (v_listener, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test@villagefireside.app', '{}', now(), now());

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update profiles set role = 'admin' where id = v_admin;
  update profiles set role = 'teacher' where id = v_teacher;
  perform set_config('request.jwt.claims', '{}', true);

  insert into series (id, title, slug, is_published) values (v_series, 'Legacy Series', 'legacy-series', true);
  insert into episodes (id, series_id, episode_number, title, description, audio_url, content_source, status, published_at)
  values (v_episode, v_series, 1, 'Legacy Elder Episode', 'Published before 15A', 'episodes/legacy.m4a',
          'elder_testimony', 'published', '2026-09-30 10:00:00+00');

  insert into admin_actions (admin_id, action, entity_type, entity_id, details) values
    (v_admin, 'create', 'series', v_series, '{"title":"Legacy Series"}'),
    (v_admin, 'update', 'series', v_series, '{"title":"Legacy Series"}'),
    (v_admin, 'publish', 'series', v_series, null),
    (v_admin, 'create', 'episode', v_episode, '{"title":"Legacy Elder Episode"}'),
    (v_admin, 'publish', 'episode', v_episode, null);
end;
$$;
```

- [ ] **Step 2: Write the baseline assertions**

```sql
-- supabase/tests/upgrade/assertions.sql
-- Each block raises if its check fails; run.sh fails on the first error.

do $$
begin
  if (select count(*) from auth.users where email like '%@villagefireside.app') <> 3 then
    raise exception 'upgrade: test accounts lost';
  end if;
  if (select role from profiles where id = '11111111-1111-1111-1111-111111111111') <> 'admin' then
    raise exception 'upgrade: admin role lost';
  end if;
  if (select count(*) from admin_actions) <> 5 then
    raise exception 'upgrade: admin_actions rows lost or added';
  end if;
  if (select status from episodes where id = '55555555-5555-5555-5555-555555555555') <> 'published' then
    raise exception 'upgrade: legacy episode is no longer published';
  end if;
  if (select published_at from episodes where id = '55555555-5555-5555-5555-555555555555')
     <> '2026-09-30 10:00:00+00'::timestamptz then
    raise exception 'upgrade: legacy published_at changed';
  end if;
end;
$$;
```

- [ ] **Step 3: Write the runner**

```bash
#!/usr/bin/env bash
# supabase/tests/upgrade/run.sh
# Migration-on-existing-data test. LOCAL ONLY: every command uses --local.
set -euo pipefail

BASELINE=20260926100000
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Resetting local database to baseline ${BASELINE}…"
supabase db reset --local --version "${BASELINE}" --no-seed

echo "Loading live-shaped fixtures…"
supabase db query --local --file "${DIR}/fixtures.sql" > /dev/null

echo "Applying newer migrations…"
supabase migration up --local

echo "Running upgrade assertions…"
supabase db query --local --file "${DIR}/assertions.sql" > /dev/null

echo "Upgrade test passed."
```

Run: `chmod +x supabase/tests/upgrade/run.sh`

- [ ] **Step 4: Prove a failing assertion fails the script**

Temporarily change `<> 3` to `<> 99` in `assertions.sql`, run `bash supabase/tests/upgrade/run.sh`.
Expected: the script exits non-zero with `upgrade: test accounts lost`. If `supabase db query --file` exits 0 on a raised exception, stop and report it: the runner would then need `psql` instead.
Revert the change.

- [ ] **Step 5: Run it for real**

Run: `bash supabase/tests/upgrade/run.sh && pnpm test:db`
Expected: `Upgrade test passed.`, then the harness test still passes (the runner leaves the database fully migrated, with the fixtures in it).

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/upgrade
git commit -m "Prompt 15A: add migration-on-existing-data harness"
```

### Task 4: CI job `db-tests`

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `pnpm test:db`, `pnpm test:integration`, `supabase/tests/upgrade/run.sh` (Tasks 1–3).

- [ ] **Step 1: Add the job**

Add a second job under the existing `jobs:` key in `.github/workflows/ci.yml`, next to `lint-and-typecheck` (unchanged, shown here only as a comment so the indentation is unambiguous):

```yaml
jobs:
  # lint-and-typecheck: … (existing job, unchanged)

  db-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      SUPABASE_CLI_VERSION: 2.111.0
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: ${{ env.SUPABASE_CLI_VERSION }}

      - name: Restore Docker image cache
        id: image-cache
        uses: actions/cache@v4
        with:
          path: /tmp/supabase-images.tar
          key: supabase-images-${{ env.SUPABASE_CLI_VERSION }}-${{ hashFiles('supabase/config.toml') }}

      - name: Load cached Docker images
        if: steps.image-cache.outputs.cache-hit == 'true'
        run: docker load -i /tmp/supabase-images.tar

      - name: Start local Supabase
        run: supabase start -x studio,logflare,vector,mailpit,realtime,imgproxy,supavisor,postgres-meta

      - name: Save Docker images for the cache
        if: steps.image-cache.outputs.cache-hit != 'true'
        run: |
          docker save $(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'supabase/') -o /tmp/supabase-images.tar

      - name: Export local keys
        run: supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=' | sed -e 's/^ANON_KEY=/SUPABASE_ANON_KEY=/' -e 's/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/' >> "$GITHUB_ENV"

      - name: Migration on existing data
        run: bash supabase/tests/upgrade/run.sh

      - name: pgTAP
        run: pnpm test:db

      - name: Integration tests
        run: pnpm test:integration
```

`supabase status -o env` quotes values (`ANON_KEY="…"`). If the exported key includes the quotes, strip them by adding `-e 's/"//g'` to the `sed` command.

- [ ] **Step 2: Push the branch and run CI**

```bash
git add .github/workflows/ci.yml
git commit -m "Prompt 15A: add db-tests CI job"
git push -u origin admin-operations
```

Pushing a branch applies nothing to the live project. CI runs on pull requests, and this session can't open one (no `gh`, no GitHub tools), so ask the user to open a **draft** PR for `admin-operations` from the link `git push` prints. CI then runs on every later push to the branch.

Read the run (no `gh`; use the public API):

```bash
SHA=$(git rev-parse HEAD)
curl -s "https://api.github.com/repos/Dageniusdrap/Village-FireSide-App/actions/runs?head_sha=${SHA}" \
  | python3 -c "import json,sys;[print(r['id'],r['status'],r['conclusion']) for r in json.load(sys.stdin)['workflow_runs']]"
```

Expected: `db-tests` succeeds.

- [ ] **Step 3: Measure the time added**

Get the `db-tests` job's duration twice: the first run (cache miss) and a second run after an empty commit (`git commit --allow-empty -m "Prompt 15A: re-run CI to measure cached db-tests time"` and push), which hits the image cache:

```bash
curl -s "https://api.github.com/repos/Dageniusdrap/Village-FireSide-App/actions/runs/<RUN_ID>/jobs" \
  | python3 -c "
import json,sys
from datetime import datetime
for j in json.load(sys.stdin)['jobs']:
    s=datetime.fromisoformat(j['started_at'].replace('Z','+00:00')); e=datetime.fromisoformat(j['completed_at'].replace('Z','+00:00'))
    print(j['name'], (e-s).seconds, 's')"
```

Report both numbers to the user. The cached run is the number that matters per PR. If the cached `db-tests` job is over 6 minutes, report which step dominates rather than optimizing silently.

### Task 5: Migration drift check against the live project

**Files:**

- Create: `.github/workflows/migration-drift.yml`
- Create: `scripts/check-migration-drift.sh`

**Interfaces:**

- Consumes: GitHub secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`; project ref `dulratrptkkswvbbrffc`.

- [ ] **Step 1: Write the comparison script**

```bash
#!/usr/bin/env bash
# scripts/check-migration-drift.sh
# Fails if the live project's applied migrations differ from the repo's
# migration files. Read-only: `supabase migration list --linked` lists, it
# never applies anything.
set -euo pipefail

supabase link --project-ref "${SUPABASE_PROJECT_REF}" --password "${SUPABASE_DB_PASSWORD}" > /dev/null

supabase migration list --linked --output-format json > /tmp/migrations.json

python3 - <<'PY'
import json, sys
data = json.load(open("/tmp/migrations.json"))
rows = data.get("migrations", data)
local_only = [r["local"] for r in rows if r.get("local") and not r.get("remote")]
remote_only = [r["remote"] for r in rows if r.get("remote") and not r.get("local")]
if local_only or remote_only:
    print("Migration drift detected.")
    print("In the repo but not applied to the live project:", local_only or "none")
    print("Applied to the live project but not in the repo:", remote_only or "none")
    sys.exit(1)
print(f"No drift: {len(rows)} migrations match.")
PY
```

Run: `chmod +x scripts/check-migration-drift.sh`

- [ ] **Step 2: Write the workflow**

```yaml
# .github/workflows/migration-drift.yml
name: Migration drift

on:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * 1" # Mondays 06:00 UTC
  workflow_dispatch:

jobs:
  drift:
    runs-on: ubuntu-latest
    env:
      SUPABASE_PROJECT_REF: dulratrptkkswvbbrffc
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: 2.111.0
      - run: bash scripts/check-migration-drift.sh
```

`workflow_dispatch` lets the user run it once by hand from the Actions tab to confirm the secrets work; it never runs on pull requests.

- [ ] **Step 3: Give the user the token steps, and have them verify it**

Tell the user, exactly:

1. Go to <https://supabase.com/dashboard/account/tokens> and choose **Generate new token**. If the page offers scopes or permissions, pick only project `dulratrptkkswvbbrffc` and read-only database/migrations access; otherwise note that it doesn't.
2. In your own terminal (so the token never passes through this session), run:
   ```sh
   cd "/Users/dradrigapatrick/Villager Fire Side APP/.worktrees/admin-operations"
   SUPABASE_ACCESS_TOKEN=<your-new-token> supabase migration list --linked
   ```
   It may also ask for the database password (Supabase dashboard → Project Settings → Database).
3. Tell me whether it listed the migrations or failed, and paste any error message (not the token).

If it fails, report the exact missing permission from the error and stop for the user's decision (D15). If it works:

4. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Add `SUPABASE_ACCESS_TOKEN` (the token) and `SUPABASE_DB_PASSWORD` (the database password).
5. After this branch merges, the workflow runs on the push to `main`; it can also be run by hand from **Actions → Migration drift → Run workflow**.

Expected after merge: the run fails until Task 28 applies the 15A migrations (the repo has migrations the live project doesn't), then passes. Tell the user to expect that.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/migration-drift.yml scripts/check-migration-drift.sh
git commit -m "Prompt 15A: add weekly and on-main migration drift check"
```

**MILESTONE 1 STOP.** Report: harness results, the measured `db-tests` times (cold and cached), and the token verification outcome. Wait for the user's review.

---

## Milestone 2: Database layer

Every task in this milestone: write the pgTAP file first, run `pnpm test:db` and see it fail, write the migration, apply it with `supabase migration up --local`, run `pnpm test:db` and see it pass. If a migration has to change after being applied locally, `supabase db reset --local` re-applies everything from scratch (local only).

### Task 6: Append-only consents and `consent_voids`

**Files:**

- Create: `supabase/tests/010_consents_append_only.test.sql`
- Create: `supabase/migrations/20261004100000_consents_append_only.sql`

**Interfaces:**

- Produces: `consents.seq` (identity, unique), `consents.reason`, `consents.recorded_by`, `consents.document_sha256`, `consents.document_storage_etag`, `consents.document_size_bytes`; table `consent_voids (id, consent_id unique, reason, voided_by, created_at)`; function `reject_update_delete()`; admin select-only RLS on both tables.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/010_consents_append_only.test.sql
begin;
\ir helpers/fixtures.sql

select plan(14);

select has_column('public', 'consents', 'seq', 'consents.seq exists');
select has_column('public', 'consents', 'reason', 'consents.reason exists');
select has_column('public', 'consents', 'recorded_by', 'consents.recorded_by exists');
select has_column('public', 'consents', 'document_sha256', 'consents.document_sha256 exists');
select has_table('public', 'consent_voids', 'consent_voids exists');

-- seq orders rows written in the same transaction
select tests.create_contributor() as c \gset
select tests.add_consent(:'c', 'photo', 'granted') as first_id \gset
select tests.add_consent(:'c', 'photo', 'declined') as second_id \gset
select ok(
  (select seq from consents where id = :'second_id') > (select seq from consents where id = :'first_id'),
  'seq increases within one transaction even though created_at is equal'
);

-- reason rules
select throws_ok(
  format($$insert into consents (contributor_id, consent_type, consent_status) values (%L, 'photo', 'revoked')$$, :'c'),
  '23514', null, 'a revoked row without a reason is refused'
);
select throws_ok(
  format($$insert into consents (contributor_id, consent_type, consent_status, reason) values (%L, 'photo', 'revoked', repeat('x', 1001))$$, :'c'),
  '23514', null, 'a 1001-character reason is refused'
);
select lives_ok(
  format($$insert into consents (contributor_id, consent_type, consent_status, reason) values (%L, 'photo', 'revoked', repeat('x', 1000))$$, :'c'),
  'a 1000-character reason is accepted'
);

-- append-only
select throws_ok(
  format($$update consents set consent_status = 'declined' where id = %L$$, :'first_id'),
  'VF005', null, 'updating a consent is refused'
);
select throws_ok(
  format($$delete from consents where id = %L$$, :'first_id'),
  'VF005', null, 'deleting a consent is refused'
);

select tests.create_user('admin') as admin_id \gset
insert into consent_voids (consent_id, reason, voided_by) values (:'first_id', 'typo', :'admin_id');
select throws_ok(
  format($$delete from consent_voids where consent_id = %L$$, :'first_id'),
  'VF005', null, 'deleting a void is refused'
);
select throws_ok(
  format($$insert into consent_voids (consent_id, reason, voided_by) values (%L, 'again', %L)$$, :'first_id', :'admin_id'),
  '23505', null, 'a consent can be voided only once'
);

-- admins can read, nobody can write through RLS
select tests.create_user('listener') as listener_id \gset
select tests.claims_for(:'listener_id');
set local role authenticated;
select is((select count(*) from consents), 0::bigint, 'a non-admin sees no consents');
reset role;

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:db`
Expected: `010_consents_append_only.test.sql` fails (`consents.seq exists` not ok, and errors on missing columns).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261004100000_consents_append_only.sql
-- Prompt 15A: consents become append-only, with a recording-order column,
-- revocation reasons, who recorded each row, and agreement fingerprints.
-- Mistakes are corrected by voiding (consent_voids), never by editing.

-- seq: recording order. Backfill existing rows in created_at, id order,
-- then hand the column to an identity starting after the highest value.
alter table consents add column seq bigint;

with ordered as (
  select id, row_number() over (order by created_at, id) as rn from consents
)
update consents c set seq = o.rn from ordered o where o.id = c.id;

alter table consents alter column seq set not null;
alter table consents alter column seq add generated always as identity;
select setval(
  pg_get_serial_sequence('consents', 'seq'),
  coalesce((select max(seq) from consents), 0) + 1,
  false
);
alter table consents add constraint consents_seq_key unique (seq);

alter table consents
  add column reason text,
  add column recorded_by uuid references profiles (id),
  add column document_sha256 text,
  add column document_storage_etag text,
  add column document_size_bytes bigint,
  add constraint consents_reason_length
    check (reason is null or char_length(btrim(reason)) between 1 and 1000),
  add constraint consents_revoked_needs_reason
    check (consent_status <> 'revoked' or reason is not null),
  add constraint consents_document_sha256_format
    check (document_sha256 is null or document_sha256 ~ '^[0-9a-f]{64}$');

comment on column consents.document_url is
  'Path of the signed agreement in the private consent-documents bucket. Never a URL.';

create table consent_voids (
  id uuid primary key default gen_random_uuid(),
  consent_id uuid not null unique references consents (id),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  voided_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

-- Append-only enforcement, for every role.
create function reject_update_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'VF005';
end;
$$;
revoke execute on function reject_update_delete() from public, anon;

create trigger consents_append_only
  before update or delete on consents
  for each row execute function reject_update_delete();
create trigger consents_no_truncate
  before truncate on consents
  for each statement execute function reject_update_delete();
create trigger consent_voids_append_only
  before update or delete on consent_voids
  for each row execute function reject_update_delete();
create trigger consent_voids_no_truncate
  before truncate on consent_voids
  for each statement execute function reject_update_delete();

-- RLS: admins read; nobody writes through RLS. All writes go through
-- record_consent / void_consent (security definer, Task 8).
drop policy consents_admin_all on consents;
create policy consents_admin_select on consents
  for select to authenticated using (is_admin());

alter table consent_voids enable row level security;
create policy consent_voids_admin_select on consent_voids
  for select to authenticated using (is_admin());

revoke insert, update, delete, truncate on consents, consent_voids from anon, authenticated;
```

- [ ] **Step 4: Apply and run the tests**

Run: `supabase migration up --local && pnpm test:db`
Expected: all files pass, including 14 assertions in `010`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261004100000_consents_append_only.sql supabase/tests/010_consents_append_only.test.sql
git commit -m "Prompt 15A: make consents append-only and add consent_voids"
```

### Task 7: The shared publish check

**Files:**

- Create: `supabase/tests/020_publish_check.test.sql`
- Create: `supabase/migrations/20261004100100_publish_check.sql`

**Interfaces:**

- Consumes: `consents.seq`, `consent_voids` (Task 6).
- Produces:
  - `latest_counted_consent(p_contributor_id uuid, p_type consent_type) returns consent_status` (security invoker; null when none)
  - `episode_publish_check(p_episode_id uuid) returns table(key text, label text, passed boolean, blocking boolean, reason text)` (security invoker); always four rows, keys `audio`, `title_description`, `elder_consent`, `source_material`, in that order.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/020_publish_check.test.sql
begin;
\ir helpers/fixtures.sql

select plan(13);

create function pg_temp.passes(p_episode uuid) returns boolean language sql as $$
  select not exists (
    select 1 from episode_publish_check(p_episode) c where c.blocking and not c.passed
  );
$$;
create function pg_temp.elder_ok(p_episode uuid) returns boolean language sql as $$
  select passed from episode_publish_check(p_episode) where key = 'elder_consent';
$$;

select tests.create_user('admin') as admin_id \gset

-- 1. No contributor linked
select tests.create_episode() as e1 \gset
select is(pg_temp.elder_ok(:'e1'), false, 'scenario 1: no contributor linked fails');

-- 2. Elder linked, no consent
select tests.create_episode() as e2 \gset
select tests.create_contributor('elder') as c2 \gset
select tests.link(:'e2', :'c2');
select is(pg_temp.elder_ok(:'e2'), false, 'scenario 2: elder without consent fails');

-- 3. Wrong-type grant and a declined story_recording
select tests.create_episode() as e3 \gset
select tests.create_contributor('elder') as c3 \gset
select tests.link(:'e3', :'c3');
select tests.add_consent(:'c3', 'photo', 'granted');
select tests.add_consent(:'c3', 'story_recording', 'declined');
select is(pg_temp.elder_ok(:'e3'), false, 'scenario 3: wrong-type and declined consents fail');

-- 4. Granted story_recording
select tests.add_consent(:'c3', 'story_recording', 'granted') as c3_grant \gset
select is(pg_temp.elder_ok(:'e3'), true, 'scenario 4: granted story_recording passes');

-- 5. Newer revoked
select tests.add_consent(:'c3', 'story_recording', 'revoked') as c3_revoke \gset
select is(pg_temp.elder_ok(:'e3'), false, 'scenario 5: a newer revoked consent fails');

-- Void of the only granted row fails
select tests.create_episode() as e6 \gset
select tests.create_contributor('elder') as c6 \gset
select tests.link(:'e6', :'c6');
select tests.add_consent(:'c6', 'story_recording', 'granted') as c6_grant \gset
insert into consent_voids (consent_id, reason, voided_by) values (:'c6_grant', 'wrong person', :'admin_id');
select is(pg_temp.elder_ok(:'e6'), false, 'voiding the only granted row fails the check');

-- Void of a newer declined restores an older granted
select tests.create_episode() as e7 \gset
select tests.create_contributor('elder') as c7 \gset
select tests.link(:'e7', :'c7');
select tests.add_consent(:'c7', 'story_recording', 'granted');
select tests.add_consent(:'c7', 'story_recording', 'declined') as c7_declined \gset
select is(pg_temp.elder_ok(:'e7'), false, 'a newer declined row fails');
insert into consent_voids (consent_id, reason, voided_by) values (:'c7_declined', 'typed wrongly', :'admin_id');
select is(pg_temp.elder_ok(:'e7'), true, 'voiding the newer declined row restores the older grant');

-- granted_with_conditions never counts
select tests.create_episode() as e8 \gset
select tests.create_contributor('elder') as c8 \gset
select tests.link(:'e8', :'c8');
select tests.add_consent(:'c8', 'story_recording', 'granted_with_conditions');
select is(pg_temp.elder_ok(:'e8'), false, 'granted_with_conditions does not count');

-- Non-elder episodes pass the elder row
select tests.create_episode('narrated_production') as e9 \gset
select is(pg_temp.elder_ok(:'e9'), true, 'a narrated production passes the elder row');

-- Unverified source material: warning, not blocking
insert into source_materials (id, title, public_domain_verified)
values ('99999999-9999-9999-9999-999999999999', 'Unverified Book', false);
update episodes set source_material_id = '99999999-9999-9999-9999-999999999999' where id = :'e9';
select results_eq(
  format($$select passed, blocking from episode_publish_check(%L) where key = 'source_material'$$, :'e9'),
  $$values (false, false)$$,
  'an unverified source is a non-blocking warning'
);
select is(pg_temp.passes(:'e9'), true, 'the warning does not block');

-- Always four rows, in order
select results_eq(
  format($$select key from episode_publish_check(%L)$$, :'e9'),
  $$values ('audio'), ('title_description'), ('elder_consent'), ('source_material')$$,
  'the check always returns four rows in a fixed order'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:db`
Expected: `020` fails with `function episode_publish_check(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261004100100_publish_check.sql
-- Prompt 15A: the one implementation of the publish check, shared by
-- publish_episode, the consent functions, the protective triggers and the
-- admin publish panel.

-- "Most recent" = highest seq; "counted" = not voided.
create function latest_counted_consent(p_contributor_id uuid, p_type consent_type)
returns consent_status
language sql
stable
security invoker
set search_path = public
as $$
  select c.consent_status
  from consents c
  where c.contributor_id = p_contributor_id
    and c.consent_type = p_type
    and not exists (select 1 from consent_voids v where v.consent_id = c.id)
  order by c.seq desc
  limit 1;
$$;
revoke execute on function latest_counted_consent(uuid, consent_type) from public, anon;
grant execute on function latest_counted_consent(uuid, consent_type) to authenticated;

create function episode_publish_check(p_episode_id uuid)
returns table (key text, label text, passed boolean, blocking boolean, reason text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_episode record;
  v_source record;
begin
  select e.id, e.title, e.description, e.audio_url, e.content_source, e.source_material_id
  into v_episode
  from episodes e
  where e.id = p_episode_id;
  if not found then
    raise exception 'Episode % not found', p_episode_id using errcode = 'P0002';
  end if;

  key := 'audio';
  label := 'Audio file uploaded';
  blocking := true;
  passed := coalesce(btrim(v_episode.audio_url), '') <> '';
  reason := case when passed then null
            else 'No audio file has been uploaded for this episode.' end;
  return next;

  key := 'title_description';
  label := 'Title and description present';
  blocking := true;
  passed := coalesce(btrim(v_episode.title), '') <> ''
            and coalesce(btrim(v_episode.description), '') <> '';
  reason := case when passed then null
            else 'Both a title and a description are required before publishing.' end;
  return next;

  key := 'elder_consent';
  label := 'Elder testimony consent';
  blocking := true;
  passed := v_episode.content_source <> 'elder_testimony' or exists (
    select 1
    from episode_contributors ec
    join contributors c on c.id = ec.contributor_id
    where ec.episode_id = p_episode_id
      and c.contributor_type = 'elder'
      and latest_counted_consent(c.id, 'story_recording') = 'granted'
  );
  reason := case when passed then null
            else 'This episode is elder testimony but no linked elder contributor''s most recent story_recording consent is granted. Link an elder contributor and record their consent before publishing.' end;
  return next;

  key := 'source_material';
  label := 'Source material verified as public domain';
  blocking := false;
  if v_episode.source_material_id is null then
    passed := true;
    reason := null;
  else
    select sm.title, sm.public_domain_verified into v_source
    from source_materials sm where sm.id = v_episode.source_material_id;
    passed := coalesce(v_source.public_domain_verified, false);
    reason := case when passed then null
              else format('%s isn''t verified as public domain.', v_source.title) end;
  end if;
  return next;
end;
$$;
revoke execute on function episode_publish_check(uuid) from public, anon;
grant execute on function episode_publish_check(uuid) to authenticated;
```

- [ ] **Step 4: Apply and run the tests**

Run: `supabase migration up --local && pnpm test:db`
Expected: all pass (13 assertions in `020`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261004100100_publish_check.sql supabase/tests/020_publish_check.test.sql
git commit -m "Prompt 15A: add the shared SQL publish check"
```

### Task 8: Consent writes (`record_consent`, `void_consent`, preview)

**Files:**

- Create: `supabase/tests/030_consent_writes.test.sql`
- Create: `supabase/migrations/20261004100200_consent_writes.sql`

**Interfaces:**

- Consumes: `episode_publish_check`, `latest_counted_consent` (Task 7).
- Produces:
  - `episodes.hidden_by_consent_at timestamptz`, `episodes.hidden_by_consent_action_id uuid` (FK to `admin_actions`, deferrable initially deferred), check constraint `episodes_hidden_by_consent_only_in_review`
  - `record_consent(p_contributor_id uuid, p_consent_type consent_type, p_consent_status consent_status, p_reason text default null, p_conditions text default null, p_signed_date date default null, p_document_path text default null, p_document_sha256 text default null, p_witness_name text default null, p_session_fee_amount bigint default null, p_session_fee_currency text default null, p_fee_paid_date date default null) returns jsonb` → `{ consent_id, hidden_episode_ids }`
  - `void_consent(p_consent_id uuid, p_reason text) returns jsonb` → `{ void_id, hidden_episode_ids }`
  - `preview_consent_change(p_contributor_id uuid, p_consent_type consent_type, p_consent_status consent_status, p_void_consent_id uuid default null) returns uuid[]` (episodes that would be hidden; writes nothing)
  - `admin_actions.action` values `consent_add`, `consent_revoke`, `consent_void`, all with `entity_type = 'consent'`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/030_consent_writes.test.sql
begin;
\ir helpers/fixtures.sql

select plan(34);

select tests.create_user('admin') as admin_id \gset
select tests.create_user('listener') as listener_id \gset

-- A published elder episode with a granted story_recording consent.
select tests.create_contributor('elder') as c \gset
select tests.create_episode() as e \gset
select tests.link(:'e', :'c');
select tests.add_consent(:'c', 'story_recording', 'granted') as grant_id \gset
select tests.force_publish(:'e');

-- A fake agreement in storage for grant tests.
insert into storage.objects (bucket_id, name, metadata)
values ('consent-documents', 'consents/test/agreement.pdf', '{"eTag":"\"abc123\"","size":2048}');

-- Non-admin is refused
select tests.claims_for(:'listener_id');
set local role authenticated;
select throws_ok(
  format($$select record_consent(%L, 'story_recording', 'revoked', 'no')$$, :'c'),
  '42501', null, 'a non-admin cannot record consent'
);
reset role;

select tests.claims_for(:'admin_id');
set local role authenticated;

-- Validation
select throws_ok(
  format($$select record_consent(%L, 'story_recording', 'revoked')$$, :'c'),
  'VF004', null, 'a revocation without a reason is refused'
);
select throws_ok(
  format($$select record_consent(%L, 'story_recording', 'revoked', '   ')$$, :'c'),
  'VF004', null, 'a whitespace-only reason is refused'
);
select throws_ok(
  format($$select record_consent(%L, 'story_recording', 'granted')$$, :'c'),
  'VF004', null, 'a grant without a document is refused'
);
select throws_ok(
  format($$select record_consent(%L, 'story_recording', 'granted', p_document_path => 'consents/missing.pdf')$$, :'c'),
  'VF004', null, 'a document path that is not in consent-documents is refused'
);

-- A grant with a document snapshots the storage etag and size
select (record_consent(:'c', 'photo', 'granted', p_document_path => 'consents/test/agreement.pdf',
        p_document_sha256 => repeat('a', 64))->>'consent_id') as photo_grant \gset
select results_eq(
  format($$select document_storage_etag, document_size_bytes, recorded_by from consents where id = %L$$, :'photo_grant'),
  format($$values ('"abc123"'::text, 2048::bigint, %L::uuid)$$, :'admin_id'),
  'the storage snapshot and recorded_by are written by the function'
);

-- Review focus 3: a photo revoke hides nothing
select is(
  (record_consent(:'c', 'photo', 'revoked', 'withdrawn')->'hidden_episode_ids'),
  '[]'::jsonb,
  'revoking a photo consent hides no episodes'
);
select is((select status::text from episodes where id = :'e'), 'published', 'the episode stays published after a photo revoke');

-- Preview shows the episode without writing anything
select is(
  preview_consent_change(:'c', 'story_recording', 'revoked'),
  array[:'e'::uuid],
  'preview lists the episode a revoke would hide'
);
select is((select count(*) from consents where contributor_id = :'c' and consent_type = 'story_recording'),
  1::bigint, 'preview writes no consent row');
select is((select status::text from episodes where id = :'e'), 'published', 'preview leaves the episode published');

-- Revoke hides, clears published_at, records the hide, one audit entry
select record_consent(:'c', 'story_recording', 'revoked', 'elder withdrew') as revoke_result \gset
select is(:'revoke_result'::jsonb->'hidden_episode_ids', jsonb_build_array(:'e'), 'the revoke reports the hidden episode');
select results_eq(
  format($$select status::text, published_at is null, hidden_by_consent_at is not null from episodes where id = %L$$, :'e'),
  $$values ('review', true, true)$$,
  'the episode is in review with no publish date and a hide timestamp'
);
select is(
  (select count(*) from admin_actions a
   join episodes ep on ep.hidden_by_consent_action_id = a.id
   where ep.id = :'e' and a.action = 'consent_revoke'
     and a.details->'hidden_episode_ids' = jsonb_build_array(:'e')),
  1::bigint,
  'one consent_revoke audit entry, referenced by the episode, lists the hidden episode'
);
select is(
  (select details ? 'reason' from admin_actions where action = 'consent_revoke' order by created_at desc limit 1),
  false,
  'the reason is not copied into the audit log'
);

-- Never re-publishes: a new grant leaves the episode in review
select record_consent(:'c', 'story_recording', 'granted', p_document_path => 'consents/test/agreement.pdf');
select is((select status::text from episodes where id = :'e'), 'review', 'a new grant does not re-publish');

-- Void rules. Fixtures are inserted as postgres (admins have no direct
-- write access to consents); the void_consent calls run as the admin.
reset role;
select tests.add_consent(:'c', 'story_recording', 'revoked', 'test') as revoked_row \gset

select tests.create_contributor('elder') as d \gset
select tests.add_consent(:'d', 'story_recording', 'granted');
select tests.add_consent(:'d', 'story_recording', 'declined') as d_declined \gset

select tests.create_contributor('elder') as f \gset
select tests.add_consent(:'f', 'story_recording', 'revoked', 'test');
select tests.add_consent(:'f', 'story_recording', 'declined') as f_declined \gset

select tests.create_contributor('elder') as g \gset
select tests.create_episode() as ge \gset
select tests.link(:'ge', :'g');
select tests.add_consent(:'g', 'story_recording', 'granted') as g_grant \gset
select tests.force_publish(:'ge');

select tests.claims_for(:'admin_id');
set local role authenticated;

select throws_ok(
  format($$select void_consent(%L, 'mistake')$$, :'revoked_row'),
  'VF004', null, 'a revoked row can never be voided'
);
select throws_ok(
  format($$select void_consent(%L, '  ')$$, :'grant_id'),
  'VF004', null, 'a void needs a reason'
);
select throws_ok(
  format($$select void_consent(%L, 'typed wrongly')$$, :'d_declined'),
  'VF004', null, 'voiding a declined row that would restore a grant is refused'
);
select lives_ok(
  format($$select void_consent(%L, 'typed wrongly')$$, :'f_declined'),
  'voiding a declined row is allowed when the result stays non-permissive'
);
select throws_ok(
  format($$select void_consent(%L, 'again')$$, :'f_declined'),
  'VF004', null, 'a consent can be voided only once'
);

-- The wrong-type fix, the case voiding exists for: a grant recorded as
-- the wrong type can always be voided, and a mistyped latest decline can
-- be voided when no earlier grant of that type exists.
reset role;
select tests.create_contributor('elder') as wt \gset
select tests.create_episode() as wte \gset
select tests.link(:'wte', :'wt');
select tests.add_consent(:'wt', 'story_recording', 'granted');
select tests.add_consent(:'wt', 'photo', 'granted') as wt_photo \gset
select tests.add_consent(:'wt', 'video', 'declined') as wt_video \gset
select tests.force_publish(:'wte');
select tests.claims_for(:'admin_id');
set local role authenticated;
select is(
  (void_consent(:'wt_photo', 'meant story_recording, recorded as photo')->'hidden_episode_ids'),
  '[]'::jsonb,
  'wrong-type fix: voiding a mistyped photo grant succeeds and hides nothing'
);
select lives_ok(
  format($$select void_consent(%L, 'meant photo, recorded as video')$$, :'wt_video'),
  'wrong-type fix: a mistyped latest decline with no earlier grant can be voided'
);
select is(
  (select status::text from episodes where id = :'wte'),
  'published',
  'wrong-type fixes leave the story_recording-backed episode published'
);

-- Voiding the granted row behind a published episode hides it
select is(
  (void_consent(:'g_grant', 'recorded against the wrong person')->'hidden_episode_ids'),
  jsonb_build_array(:'ge'),
  'voiding the only grant hides the episode'
);
select results_eq(
  format($$select status::text, published_at is null from episodes where id = %L$$, :'ge'),
  $$values ('review', true)$$,
  'the void hide also clears published_at'
);
select is(
  (select action from admin_actions where id = (select hidden_by_consent_action_id from episodes where id = :'ge')),
  'consent_void',
  'the hide references a consent_void audit entry'
);
reset role;

-- Rollback leaves nothing: force a failure after the hide
select tests.create_contributor('elder') as h \gset
select tests.create_episode() as he \gset
select tests.link(:'he', :'h');
select tests.add_consent(:'h', 'story_recording', 'granted');
select tests.force_publish(:'he');
create function pg_temp.fail_audit() returns trigger language plpgsql as $$
begin raise exception 'forced audit failure'; end; $$;
create trigger fail_audit before insert on admin_actions
  for each row execute function pg_temp.fail_audit();
select (select count(*) from admin_actions) as audits_before \gset
select tests.claims_for(:'admin_id');
set local role authenticated;
select throws_ok(
  format($$select record_consent(%L, 'story_recording', 'revoked', 'test')$$, :'h'),
  'P0001', 'forced audit failure', 'a failure after the hide raises'
);
reset role;
drop trigger fail_audit on admin_actions;
select is((select count(*) from consents where contributor_id = :'h'), 1::bigint, 'rollback: no consent row was added');
select is((select status::text from episodes where id = :'he'), 'published', 'rollback: the episode is still published');
select is((select hidden_by_consent_at from episodes where id = :'he'), null, 'rollback: no hide timestamp');
select is((select count(*) from admin_actions), :'audits_before'::bigint, 'rollback: no audit entry left behind');

-- hidden_by_consent_* only while in review
select throws_ok(
  format($$update episodes set hidden_by_consent_at = now() where id = %L$$, :'he'),
  '23514', null, 'hidden_by_consent_at cannot be set on a published episode'
);

-- anon cannot execute
set local role anon;
select throws_ok(
  format($$select record_consent(%L, 'story_recording', 'revoked', 'x')$$, :'h'),
  '42501', null, 'anon gets permission denied on record_consent'
);
reset role;

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:db`
Expected: `030` fails with `function record_consent(...) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261004100200_consent_writes.sql
-- Prompt 15A: every consent write (add, revoke, void) re-checks and hides
-- affected published episodes in the same transaction, with one audit
-- entry. Functions only hide; re-publishing is a manual admin action.

alter table episodes
  add column hidden_by_consent_at timestamptz,
  add column hidden_by_consent_action_id uuid
    references admin_actions (id) deferrable initially deferred,
  add constraint episodes_hidden_by_consent_only_in_review check (
    status = 'review'
    or (hidden_by_consent_at is null and hidden_by_consent_action_id is null)
  );

-- Shared routine: re-check, hide, audit. Called only by the functions
-- below; nobody may execute it directly.
create function apply_consent_change(
  p_contributor_id uuid,
  p_action_id uuid,
  p_action text,
  p_entity_id uuid,
  p_details jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hidden uuid[] := '{}';
  v_episode uuid;
begin
  -- Lock order: the caller already holds the contributor row; episodes next.
  for v_episode in
    select e.id
    from episodes e
    where e.status = 'published'
      and exists (
        select 1 from episode_contributors ec
        where ec.episode_id = e.id and ec.contributor_id = p_contributor_id
      )
    order by e.id
    for update of e
  loop
    if exists (
      select 1 from episode_publish_check(v_episode) c where c.blocking and not c.passed
    ) then
      update episodes
      set status = 'review',
          published_at = null,
          hidden_by_consent_at = now(),
          hidden_by_consent_action_id = p_action_id
      where id = v_episode;
      v_hidden := v_hidden || v_episode;
    end if;
  end loop;

  -- The audit entry uses the ID created at the start of the calling
  -- function; the episodes above already reference it (deferred FK).
  insert into admin_actions (id, admin_id, action, entity_type, entity_id, details)
  values (
    p_action_id, auth.uid(), p_action, 'consent', p_entity_id,
    p_details || jsonb_build_object('hidden_episode_ids', to_jsonb(v_hidden))
  );

  return v_hidden;
end;
$$;
revoke execute on function apply_consent_change(uuid, uuid, text, uuid, jsonb)
  from public, anon, authenticated;

create function record_consent(
  p_contributor_id uuid,
  p_consent_type consent_type,
  p_consent_status consent_status,
  p_reason text default null,
  p_conditions text default null,
  p_signed_date date default null,
  p_document_path text default null,
  p_document_sha256 text default null,
  p_witness_name text default null,
  p_session_fee_amount bigint default null,
  p_session_fee_currency text default null,
  p_fee_paid_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_id uuid := gen_random_uuid();
  v_consent_id uuid;
  v_etag text;
  v_size bigint;
  v_hidden uuid[];
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not is_admin() then
    raise exception 'Only admins can record consent' using errcode = '42501';
  end if;

  perform 1 from contributors where id = p_contributor_id for update;
  if not found then
    raise exception 'Contributor % not found', p_contributor_id using errcode = 'P0002';
  end if;

  if p_consent_status = 'revoked' and v_reason is null then
    raise exception 'A revocation needs a reason.' using errcode = 'VF004';
  end if;
  if p_consent_status in ('granted', 'granted_with_conditions') and p_document_path is null then
    raise exception 'A granted consent needs its signed agreement.' using errcode = 'VF004';
  end if;
  if p_document_path is not null then
    select o.metadata->>'eTag', (o.metadata->>'size')::bigint
    into v_etag, v_size
    from storage.objects o
    where o.bucket_id = 'consent-documents' and o.name = p_document_path;
    if not found then
      raise exception 'The agreement % was not found in consent-documents.', p_document_path
        using errcode = 'VF004';
    end if;
  end if;

  insert into consents (
    contributor_id, consent_type, consent_status, reason, conditions, signed_date,
    document_url, document_sha256, document_storage_etag, document_size_bytes,
    witness_name, session_fee_amount, session_fee_currency, fee_paid_date, recorded_by
  )
  values (
    p_contributor_id, p_consent_type, p_consent_status, v_reason, p_conditions, p_signed_date,
    p_document_path, p_document_sha256, v_etag, v_size,
    p_witness_name, p_session_fee_amount, p_session_fee_currency, p_fee_paid_date, auth.uid()
  )
  returning id into v_consent_id;

  v_hidden := apply_consent_change(
    p_contributor_id,
    v_action_id,
    case when p_consent_status = 'revoked' then 'consent_revoke' else 'consent_add' end,
    v_consent_id,
    jsonb_build_object(
      'contributor_id', p_contributor_id,
      'consent_id', v_consent_id,
      'consent_type', p_consent_type,
      'consent_status', p_consent_status
    )
  );

  return jsonb_build_object('consent_id', v_consent_id, 'hidden_episode_ids', to_jsonb(v_hidden));
end;
$$;
revoke execute on function record_consent(uuid, consent_type, consent_status, text, text, date, text, text, text, bigint, text, date)
  from public, anon;
grant execute on function record_consent(uuid, consent_type, consent_status, text, text, date, text, text, text, bigint, text, date)
  to authenticated;

create function void_consent(p_consent_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_id uuid := gen_random_uuid();
  v_target consents%rowtype;
  v_after consent_status;
  v_void_id uuid;
  v_hidden uuid[];
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not is_admin() then
    raise exception 'Only admins can void consent' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'A void needs a reason.' using errcode = 'VF004';
  end if;

  select * into v_target from consents where id = p_consent_id;
  if not found then
    raise exception 'Consent % not found', p_consent_id using errcode = 'P0002';
  end if;

  perform 1 from contributors where id = v_target.contributor_id for update;

  if exists (select 1 from consent_voids where consent_id = p_consent_id) then
    raise exception 'This consent has already been voided.' using errcode = 'VF004';
  end if;
  if v_target.consent_status = 'revoked' then
    raise exception 'A revocation can''t be voided. Record a new granted consent with a new signed agreement instead.'
      using errcode = 'VF004';
  end if;
  if v_target.consent_status = 'declined' then
    select c.consent_status into v_after
    from consents c
    where c.contributor_id = v_target.contributor_id
      and c.consent_type = v_target.consent_type
      and c.id <> v_target.id
      and not exists (select 1 from consent_voids v where v.consent_id = c.id)
    order by c.seq desc
    limit 1;
    if v_after in ('granted', 'granted_with_conditions') then
      raise exception 'Voiding this declined consent would restore an earlier grant. Record a new granted consent with a new signed agreement instead.'
        using errcode = 'VF004';
    end if;
  end if;

  insert into consent_voids (consent_id, reason, voided_by)
  values (p_consent_id, v_reason, auth.uid())
  returning id into v_void_id;

  v_hidden := apply_consent_change(
    v_target.contributor_id,
    v_action_id,
    'consent_void',
    p_consent_id,
    jsonb_build_object(
      'contributor_id', v_target.contributor_id,
      'consent_id', p_consent_id,
      'void_id', v_void_id,
      'consent_type', v_target.consent_type,
      'consent_status', v_target.consent_status
    )
  );

  return jsonb_build_object('void_id', v_void_id, 'hidden_episode_ids', to_jsonb(v_hidden));
end;
$$;
revoke execute on function void_consent(uuid, text) from public, anon;
grant execute on function void_consent(uuid, text) to authenticated;

-- Preview: performs the write inside a subtransaction, runs the real check,
-- then rolls the subtransaction back. Uses the same check as the real
-- write, so preview and result can't drift. Consumes seq values (gaps are
-- harmless; seq only orders rows).
create function preview_consent_change(
  p_contributor_id uuid,
  p_consent_type consent_type,
  p_consent_status consent_status,
  p_void_consent_id uuid default null
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_would_hide uuid[] := '{}';
begin
  if not is_admin() then
    raise exception 'Only admins can preview consent changes' using errcode = '42501';
  end if;

  begin
    if p_void_consent_id is not null then
      insert into consent_voids (consent_id, reason, voided_by)
      values (p_void_consent_id, 'preview', auth.uid());
    else
      insert into consents (contributor_id, consent_type, consent_status, reason, recorded_by)
      values (p_contributor_id, p_consent_type, p_consent_status,
              case when p_consent_status = 'revoked' then 'preview' end, auth.uid());
    end if;

    select coalesce(array_agg(e.id order by e.id), '{}') into v_would_hide
    from episodes e
    where e.status = 'published'
      and exists (
        select 1 from episode_contributors ec
        where ec.episode_id = e.id and ec.contributor_id = p_contributor_id
      )
      and exists (
        select 1 from episode_publish_check(e.id) c where c.blocking and not c.passed
      );

    raise exception using errcode = 'VF999', message = 'preview rollback';
  exception
    when sqlstate 'VF999' then
      null; -- the subtransaction is rolled back; v_would_hide survives
  end;

  return v_would_hide;
end;
$$;
revoke execute on function preview_consent_change(uuid, consent_type, consent_status, uuid) from public, anon;
grant execute on function preview_consent_change(uuid, consent_type, consent_status, uuid) to authenticated;
```

- [ ] **Step 4: Apply and run the tests**

Run: `supabase migration up --local && pnpm test:db`
Expected: all pass (30 assertions in `030`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261004100200_consent_writes.sql supabase/tests/030_consent_writes.test.sql
git commit -m "Prompt 15A: add record_consent, void_consent and preview"
```

### Task 9: Publishing integrity (functions, triggers, admin wiring)

This task also changes two admin files, because the new publish trigger refuses the current service-role publish and the current delete-all-then-reinsert link save. Without these changes the admin app would break between milestones.

**Files:**

- Create: `supabase/tests/040_publishing.test.sql`
- Create: `supabase/migrations/20261004100300_publishing_integrity.sql`
- Create: `apps/admin/src/app/(dashboard)/episodes/contributor-link-diff.ts`
- Create: `apps/admin/src/app/(dashboard)/episodes/contributor-link-diff.test.ts`
- Modify: `apps/admin/src/app/(dashboard)/episodes/actions.ts` (replace `replaceContributorLinks`)
- Modify: `apps/admin/src/app/(dashboard)/episodes/publish-actions.ts` (rewrite)
- Modify: `apps/admin/src/app/(dashboard)/episodes/publish-guard-panel.tsx`
- Delete: `apps/admin/src/app/(dashboard)/episodes/check-publish-requirements.ts`
- Delete: `apps/admin/src/app/(dashboard)/episodes/check-publish-requirements.test.ts`

**Interfaces:**

- Consumes: `episode_publish_check` (Task 7), `hidden_by_consent_*` (Task 8).
- Produces:
  - `publish_episode(p_episode_id uuid, p_acknowledge_unverified_source boolean default false) returns jsonb` (raises `VF001`, `VF002`)
  - `unpublish_episode(p_episode_id uuid) returns jsonb`
  - triggers raising `VF003`
  - TypeScript (`publish-actions.ts`): `type PublishCheck = { key: string; label: string; passed: boolean; blocking: boolean; reason: string | null }`, `validateEpisodeForPublish(episodeId: string): Promise<PublishCheck[]>`, `publishEpisode(episodeId: string, acknowledgeUnverifiedSource?: boolean): Promise<PublishResult>`, `unpublishEpisode(episodeId: string): Promise<ActionResult>`, `type PublishResult = { ok: true } | { ok: false; message: string; needsAcknowledgement?: boolean }`
  - TypeScript (`contributor-link-diff.ts`): `diffContributorLinks(existing: ContributorLink[], desired: ContributorLink[]): { toDelete: ContributorLink[]; toInsert: ContributorLink[] }`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/040_publishing.test.sql
begin;
\ir helpers/fixtures.sql

select plan(21);

select tests.create_user('admin') as admin_id \gset

create function pg_temp.ready_elder_episode() returns uuid language plpgsql as $$
declare v_c uuid; v_e uuid;
begin
  v_c := tests.create_contributor('elder');
  v_e := tests.create_episode();
  perform tests.link(v_e, v_c);
  perform tests.add_consent(v_c, 'story_recording', 'granted');
  return v_e;
end; $$;

-- Direct publish is refused, by an admin session too
select pg_temp.ready_elder_episode() as e \gset
select tests.claims_for(:'admin_id');
set local role authenticated;
select throws_ok(
  format($$update episodes set status = 'published' where id = %L$$, :'e'),
  'VF003', null, 'an admin cannot set published directly'
);
select throws_ok(
  format($$insert into episodes (series_id, episode_number, title, status) select series_id, 99, 'x', 'published' from episodes where id = %L$$, :'e'),
  'VF003', null, 'an episode cannot be inserted as published'
);

-- publish_episode works and sets published_at
select lives_ok(format($$select publish_episode(%L)$$, :'e'), 'publish_episode publishes a passing episode');
select results_eq(
  format($$select status::text, published_at is not null from episodes where id = %L$$, :'e'),
  $$values ('published', true)$$, 'published with a fresh publish date'
);
select is(
  (select count(*) from admin_actions where action = 'publish' and entity_id = :'e'),
  1::bigint, 'publish is audited'
);

-- A failing episode is refused with VF001
select tests.create_episode() as bad \gset
select throws_ok(format($$select publish_episode(%L)$$, :'bad'), 'VF001', null, 'a failing episode is refused');

-- Unverified source needs acknowledgement
select tests.create_episode('narrated_production') as src_ep \gset
reset role;
insert into source_materials (id, title, public_domain_verified)
values ('88888888-8888-8888-8888-888888888888', 'Unverified Book', false);
update episodes set source_material_id = '88888888-8888-8888-8888-888888888888' where id = :'src_ep';
select tests.claims_for(:'admin_id');
set local role authenticated;
select throws_ok(format($$select publish_episode(%L)$$, :'src_ep'), 'VF002', null, 'an unverified source needs acknowledgement');
select lives_ok(format($$select publish_episode(%L, true)$$, :'src_ep'), 'acknowledging publishes');
select is(
  (select details->>'acknowledged_unverified_source' from admin_actions where action = 'publish' and entity_id = :'src_ep'),
  'true', 'the acknowledgement is in the audit entry'
);

-- Unpublish clears published_at
select lives_ok(format($$select unpublish_episode(%L)$$, :'src_ep'), 'unpublish works');
select results_eq(
  format($$select status::text, published_at is null from episodes where id = %L$$, :'src_ep'),
  $$values ('draft', true)$$, 'unpublish clears published_at'
);
reset role;

-- Protective triggers on a published elder episode (:e)
select throws_ok(
  format($$update episodes set audio_url = 'episodes/other.m4a' where id = %L$$, :'e'),
  'VF003', null, 'replacing audio on a published elder episode is refused'
);
select throws_ok(
  format($$update episodes set description = '  ' where id = %L$$, :'e'),
  'VF003', null, 'blanking the description of a published episode is refused'
);
select lives_ok(
  format($$update episodes set title = 'Fixed typo' where id = %L$$, :'e'),
  'fixing a typo in a published title is allowed'
);
select throws_ok(
  format($$delete from episode_contributors where episode_id = %L$$, :'e'),
  'VF003', null, 'unlinking the only elder from a published episode is refused'
);
select throws_ok(
  format($$update contributors set contributor_type = 'historian' where id = (select contributor_id from episode_contributors where episode_id = %L)$$, :'e'),
  'VF003', null, 'changing the elder''s type is refused while the episode is published'
);

-- Unlinking a second, irrelevant contributor is fine
select tests.create_contributor('writer') as w \gset
select tests.link(:'e', :'w', 'writer');
select lives_ok(
  format($$delete from episode_contributors where episode_id = %L and contributor_id = %L$$, :'e', :'w'),
  'unlinking a contributor the check does not depend on is allowed'
);

-- Review focus 2: deleting a published episode cascades its links
select lives_ok(format($$delete from episodes where id = %L$$, :'e'), 'a published episode can be deleted');

-- Review focus 5: re-publishing a consent-hidden episode
select pg_temp.ready_elder_episode() as hid \gset
select tests.force_publish(:'hid');
select contributor_id as hid_c from episode_contributors where episode_id = :'hid' \gset
insert into storage.objects (bucket_id, name, metadata)
values ('consent-documents', 'consents/test/regrant.pdf', '{"eTag":"\"r1\"","size":10}');
select tests.claims_for(:'admin_id');
set local role authenticated;
select record_consent(:'hid_c', 'story_recording', 'revoked', 'withdrawn');
select record_consent(:'hid_c', 'story_recording', 'granted', p_document_path => 'consents/test/regrant.pdf');
select lives_ok(format($$select publish_episode(%L)$$, :'hid'), 'a consent-hidden episode can be re-published after a new grant');
select results_eq(
  format($$select status::text, published_at is not null, hidden_by_consent_at is null, hidden_by_consent_action_id is null from episodes where id = %L$$, :'hid'),
  $$values ('published', true, true, true)$$,
  're-publishing clears the hide columns and sets a fresh publish date'
);
reset role;

-- anon cannot publish
set local role anon;
select throws_ok(format($$select publish_episode(%L)$$, :'hid'), '42501', null, 'anon gets permission denied on publish_episode');
reset role;

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:db`
Expected: `040` fails (`an admin cannot set published directly` not ok, then missing functions).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261004100300_publishing_integrity.sql
-- Prompt 15A: publish_episode is the only way to publish, and no other
-- write may leave a published episode failing the publish check.

create function publish_episode(
  p_episode_id uuid,
  p_acknowledge_unverified_source boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_failures text;
  v_source_reason text;
  v_source_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admins can publish' using errcode = '42501';
  end if;

  -- Lock order shared with the consent functions: contributors (ascending
  -- id), then the episode.
  perform 1 from contributors
  where id in (select contributor_id from episode_contributors where episode_id = p_episode_id)
  order by id
  for update;
  perform 1 from episodes where id = p_episode_id for update;
  if not found then
    raise exception 'Episode % not found', p_episode_id using errcode = 'P0002';
  end if;

  select string_agg(reason, ' ') into v_failures
  from episode_publish_check(p_episode_id)
  where blocking and not passed;
  if v_failures is not null then
    raise exception '%', v_failures using errcode = 'VF001';
  end if;

  select reason into v_source_reason
  from episode_publish_check(p_episode_id)
  where key = 'source_material' and not passed;
  if v_source_reason is not null and not p_acknowledge_unverified_source then
    raise exception '%', v_source_reason using errcode = 'VF002';
  end if;

  perform set_config('app.publishing_episode', p_episode_id::text, true);
  update episodes
  set status = 'published',
      published_at = now(),
      hidden_by_consent_at = null,
      hidden_by_consent_action_id = null
  where id = p_episode_id
  returning source_material_id into v_source_id;
  perform set_config('app.publishing_episode', '', true);

  insert into admin_actions (admin_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'publish', 'episode', p_episode_id,
    case when v_source_reason is not null then
      jsonb_build_object('acknowledged_unverified_source', true, 'source_material_id', v_source_id)
    end
  );

  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function publish_episode(uuid, boolean) from public, anon;
grant execute on function publish_episode(uuid, boolean) to authenticated;

create function unpublish_episode(p_episode_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admins can unpublish' using errcode = '42501';
  end if;

  update episodes
  set status = 'draft',
      published_at = null,
      hidden_by_consent_at = null,
      hidden_by_consent_action_id = null
  where id = p_episode_id and status in ('published', 'review');
  if not found then
    raise exception 'Episode % is not published or in review', p_episode_id using errcode = 'P0002';
  end if;

  insert into admin_actions (admin_id, action, entity_type, entity_id)
  values (auth.uid(), 'unpublish', 'episode', p_episode_id);

  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function unpublish_episode(uuid) from public, anon;
grant execute on function unpublish_episode(uuid) to authenticated;

-- Only publish_episode may make an episode published.
create function guard_episode_publish_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and coalesce(current_setting('app.publishing_episode', true), '') <> new.id::text then
    raise exception 'Episodes can only be published through publish_episode().'
      using errcode = 'VF003';
  end if;
  return new;
end;
$$;
revoke execute on function guard_episode_publish_state() from public, anon;

create trigger episodes_guard_publish_state
  before insert or update on episodes
  for each row execute function guard_episode_publish_state();

-- Edits to a published episode must keep it passing.
create function recheck_published_episode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'published' and new.status = 'published' then
    if (old.content_source = 'elder_testimony' or new.content_source = 'elder_testimony')
       and new.audio_url is distinct from old.audio_url then
      raise exception 'Replacing the audio of a published elder testimony episode isn''t allowed. Unpublish it first.'
        using errcode = 'VF003';
    end if;
    if (new.content_source, new.title, new.description, new.audio_url)
         is distinct from (old.content_source, old.title, old.description, old.audio_url)
       and exists (
         select 1 from episode_publish_check(new.id) c where c.blocking and not c.passed
       ) then
      raise exception 'This change would make a published episode fail its publish check. Unpublish it first.'
        using errcode = 'VF003';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function recheck_published_episode() from public, anon;

create trigger episodes_recheck_published
  after update on episodes
  for each row execute function recheck_published_episode();

-- Unlinking a contributor must keep a published episode passing.
create function recheck_after_unlink()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status episode_status;
begin
  -- Locks the episode so this can't race publish_episode. During an
  -- episode delete the row is already gone, so the cascade is allowed.
  select status into v_status from episodes where id = old.episode_id for update;
  if found and v_status = 'published' and exists (
    select 1 from episode_publish_check(old.episode_id) c where c.blocking and not c.passed
  ) then
    raise exception 'This change would make a published episode fail its publish check. Unpublish it first.'
      using errcode = 'VF003';
  end if;
  return null;
end;
$$;
revoke execute on function recheck_after_unlink() from public, anon;

create trigger episode_contributors_recheck
  after delete or update on episode_contributors
  for each row execute function recheck_after_unlink();

-- Changing a contributor's type must keep their published episodes passing.
create function recheck_after_contributor_type_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.contributor_type is distinct from old.contributor_type and exists (
    select 1
    from episodes e
    join episode_contributors ec on ec.episode_id = e.id
    where ec.contributor_id = new.id
      and e.status = 'published'
      and exists (select 1 from episode_publish_check(e.id) c where c.blocking and not c.passed)
  ) then
    raise exception 'This change would make a published episode fail its publish check. Unpublish it first.'
      using errcode = 'VF003';
  end if;
  return null;
end;
$$;
revoke execute on function recheck_after_contributor_type_change() from public, anon;

create trigger contributors_recheck_type
  after update of contributor_type on contributors
  for each row execute function recheck_after_contributor_type_change();
```

- [ ] **Step 4: Apply and run the pgTAP tests**

Run: `supabase migration up --local && pnpm test:db`
Expected: all pass (22 assertions in `040`; `030` still passes).

- [ ] **Step 5: Write the failing diff test (Review Focus 1)**

```ts
// apps/admin/src/app/(dashboard)/episodes/contributor-link-diff.test.ts
import { describe, expect, it } from "vitest";

import { diffContributorLinks } from "./contributor-link-diff";

const elder = { contributorId: "c1", role: "narrator" };
const writer = { contributorId: "c2", role: "writer" };

describe("diffContributorLinks", () => {
  it("changes nothing when the links are unchanged", () => {
    expect(diffContributorLinks([elder, writer], [writer, elder])).toEqual({
      toDelete: [],
      toInsert: [],
    });
  });

  it("deletes only removed links and inserts only added ones", () => {
    expect(
      diffContributorLinks([elder, writer], [elder, { contributorId: "c3", role: "translator" }]),
    ).toEqual({
      toDelete: [writer],
      toInsert: [{ contributorId: "c3", role: "translator" }],
    });
  });

  it("treats a role change as a delete plus an insert", () => {
    expect(diffContributorLinks([elder], [{ contributorId: "c1", role: "storyteller" }])).toEqual({
      toDelete: [elder],
      toInsert: [{ contributorId: "c1", role: "storyteller" }],
    });
  });

  it("collapses duplicates in the desired list", () => {
    expect(diffContributorLinks([], [elder, elder])).toEqual({ toDelete: [], toInsert: [elder] });
  });
});
```

Run: `pnpm --filter admin test -- contributor-link-diff`
Expected: FAIL (module not found).

- [ ] **Step 6: Write the diff and use it**

```ts
// apps/admin/src/app/(dashboard)/episodes/contributor-link-diff.ts
import type { ContributorLink } from "./actions";

const keyOf = (link: ContributorLink) => `${link.contributorId}\u0000${link.role}`;

// Saving an episode used to delete every link and re-insert them. The
// unlink trigger refuses removing the elder a published episode depends
// on, even momentarily, so saves now touch only the links that changed.
export function diffContributorLinks(
  existing: ContributorLink[],
  desired: ContributorLink[],
): { toDelete: ContributorLink[]; toInsert: ContributorLink[] } {
  const existingKeys = new Set(existing.map(keyOf));
  const desiredByKey = new Map(desired.map((link) => [keyOf(link), link]));
  return {
    toDelete: existing.filter((link) => !desiredByKey.has(keyOf(link))),
    toInsert: [...desiredByKey.values()].filter((link) => !existingKeys.has(keyOf(link))),
  };
}
```

In `apps/admin/src/app/(dashboard)/episodes/actions.ts`, replace the whole `replaceContributorLinks` function with:

```ts
async function replaceContributorLinks(
  supabase: ReturnType<typeof createServiceRoleClient>,
  episodeId: string,
  links: ContributorLink[],
): Promise<{ error: string | null }> {
  const { data: existingRows, error: loadError } = await supabase
    .from("episode_contributors")
    .select("contributor_id, role")
    .eq("episode_id", episodeId);
  if (loadError) {
    return { error: loadError.message };
  }
  const existing = existingRows.map((row) => ({
    contributorId: row.contributor_id,
    role: row.role,
  }));
  const { toDelete, toInsert } = diffContributorLinks(existing, links);

  // Insert before deleting, so swapping one elder for another never leaves
  // a published episode without one in between.
  if (toInsert.length > 0) {
    const { error } = await supabase.from("episode_contributors").insert(
      toInsert.map((link) => ({
        episode_id: episodeId,
        contributor_id: link.contributorId,
        role: link.role,
      })),
    );
    if (error) {
      return { error: error.message };
    }
  }
  for (const link of toDelete) {
    const { error } = await supabase
      .from("episode_contributors")
      .delete()
      .eq("episode_id", episodeId)
      .eq("contributor_id", link.contributorId)
      .eq("role", link.role);
    if (error) {
      return { error: error.message };
    }
  }
  return { error: null };
}
```

and add `import { diffContributorLinks } from "./contributor-link-diff";` to its imports.

- [ ] **Step 7: Rewrite the publish actions to call the database**

Replace `apps/admin/src/app/(dashboard)/episodes/publish-actions.ts` entirely:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/require-admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; message: string };
export type PublishResult =
  { ok: true } | { ok: false; message: string; needsAcknowledgement?: boolean };

export type PublishCheck = {
  key: string;
  label: string;
  passed: boolean;
  blocking: boolean;
  reason: string | null;
};

// Publishing goes through publish_episode() with the admin's own session
// (never the service role), so the database knows who published and the
// shared SQL check is the only implementation.
export async function validateEpisodeForPublish(episodeId: string): Promise<PublishCheck[]> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return [
      {
        key: "authorization",
        label: "Authorization",
        passed: false,
        blocking: true,
        reason: admin.message,
      },
    ];
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("episode_publish_check", { p_episode_id: episodeId });
  if (error) {
    return [
      {
        key: "load",
        label: "Load episode data",
        passed: false,
        blocking: true,
        reason: error.message,
      },
    ];
  }
  return data as PublishCheck[];
}

export async function publishEpisode(
  episodeId: string,
  acknowledgeUnverifiedSource = false,
): Promise<PublishResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_episode", {
    p_episode_id: episodeId,
    p_acknowledge_unverified_source: acknowledgeUnverifiedSource,
  });
  if (error) {
    return { ok: false, message: error.message, needsAcknowledgement: error.code === "VF002" };
  }
  revalidatePath("/episodes");
  return { ok: true };
}

export async function unpublishEpisode(episodeId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("unpublish_episode", { p_episode_id: episodeId });
  if (error) {
    return { ok: false, message: error.message };
  }
  revalidatePath("/episodes");
  return { ok: true };
}
```

Delete `check-publish-requirements.ts` and `check-publish-requirements.test.ts` (`git rm`). Their cases now live in `supabase/tests/020_publish_check.test.sql`.

- [ ] **Step 8: Update the panel**

In `publish-guard-panel.tsx`:

1. Change the import to `import type { PublishCheck } from "./publish-actions";` (merge into the existing `./publish-actions` import).
2. Replace `handleConfirmPublish` with:

```tsx
const handleConfirmPublish = async (acknowledge = false) => {
  setIsPublishing(true);
  setApiError(undefined);
  const result = await publishEpisode(episodeId, acknowledge);
  setIsPublishing(false);
  if (!result.ok) {
    if (result.needsAcknowledgement && window.confirm(`${result.message} Publish anyway?`)) {
      await handleConfirmPublish(true);
      return;
    }
    setApiError(result.message);
    return;
  }
  router.refresh();
  setChecks(null);
};
```

3. Change `allPassed` to `const allPassed = checks !== null && checks.every((check) => check.passed || !check.blocking);`
4. In the checklist, key by `check.key`, and render a non-blocking failure as a warning:

```tsx
<li
  key={check.key}
  className={check.passed ? "text-green-700" : check.blocking ? "text-red-700" : "text-amber-700"}
>
  {check.passed ? "✓" : check.blocking ? "✗" : "!"} {check.label}
  {!check.passed && check.reason && (
    <span className="block text-sm text-gray-600">{check.reason}</span>
  )}
</li>
```

5. Change the published-state block's condition from `status === "published"` to `status === "published" || status === "review"`, and its text to `{status === "review" ? "This episode is in review." : "This episode is published."}`, so a hidden episode can be unpublished to draft.

- [ ] **Step 9: Run every check**

Run: `pnpm test:db && pnpm --filter admin test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20261004100300_publishing_integrity.sql supabase/tests/040_publishing.test.sql apps/admin/src/app/\(dashboard\)/episodes
git commit -m "Prompt 15A: publish only through publish_episode, guard published episodes"
```

### Task 10: Contributor photos and storage rules

**Files:**

- Create: `supabase/tests/050_photos.test.sql`
- Create: `supabase/tests/060_access.test.sql`
- Create: `supabase/migrations/20261004100400_contributor_photos_and_storage.sql`

**Interfaces:**

- Consumes: `latest_counted_consent` (Task 7).
- Produces:
  - column `contributors.photo_path` (renamed from `photo_url`); view `public_contributors` without any photo column
  - bucket `contributor-photos` (private; admin select/insert/delete for `authenticated`)
  - `consent-documents` policies: admin select and admin insert only
  - `contributor_photo_status(p_contributor_id uuid) returns text` (security invoker): `visible`, `anonymous`, `no_photo`, `no_consent`, `consent_revoked`, `consent_declined`, `conditions_unverified`
  - `contributor_photo_paths(p_ids uuid[]) returns table(contributor_id uuid, photo_path text)` (service role only)
  - `consent_document_state(p_consent_id uuid) returns table(present boolean, current_etag text, current_size_bytes bigint, recorded_etag text, recorded_size_bytes bigint, recorded_sha256 text, document_path text)` (admin only; used by Task 20)

The mobile app reads `public_contributors.photo_url` until Task 15. After this migration, contributor screens fail **against the local database only** until Task 15; the live project is untouched until Task 28.

- [ ] **Step 1: Write the failing photo test**

```sql
-- supabase/tests/050_photos.test.sql
begin;
\ir helpers/fixtures.sql

select plan(8);

select tests.create_user('admin') as admin_id \gset

create function pg_temp.with_photo(p_anonymous boolean default false) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := tests.create_contributor('elder', p_anonymous);
  update contributors set photo_path = 'contributors/' || v || '/p.jpg' where id = v;
  return v;
end; $$;

select pg_temp.with_photo() as ok_c \gset
select tests.add_consent(:'ok_c', 'photo', 'granted');
select is(contributor_photo_status(:'ok_c'), 'visible', 'granted photo consent is visible');

select pg_temp.with_photo() as rev_c \gset
select tests.add_consent(:'rev_c', 'photo', 'granted');
select tests.add_consent(:'rev_c', 'photo', 'revoked', 'withdrawn');
select is(contributor_photo_status(:'rev_c'), 'consent_revoked', 'granted then newer revoked is hidden');

select pg_temp.with_photo(true) as anon_c \gset
select tests.add_consent(:'anon_c', 'photo', 'granted');
select is(contributor_photo_status(:'anon_c'), 'anonymous', 'an anonymous contributor is hidden');

select pg_temp.with_photo() as none_c \gset
select is(contributor_photo_status(:'none_c'), 'no_consent', 'no photo consent is hidden');

select pg_temp.with_photo() as cond_c \gset
select tests.add_consent(:'cond_c', 'photo', 'granted_with_conditions');
select is(contributor_photo_status(:'cond_c'), 'conditions_unverified', 'granted_with_conditions only is hidden');

select pg_temp.with_photo() as void_c \gset
select tests.add_consent(:'void_c', 'photo', 'granted') as void_grant \gset
insert into consent_voids (consent_id, reason, voided_by) values (:'void_grant', 'wrong person', :'admin_id');
select is(contributor_photo_status(:'void_c'), 'no_consent', 'a voided grant is hidden');

select set_eq(
  format($$select contributor_id from contributor_photo_paths(array[%L, %L, %L, %L, %L, %L]::uuid[])$$,
         :'ok_c', :'rev_c', :'anon_c', :'none_c', :'cond_c', :'void_c'),
  format($$values (%L::uuid)$$, :'ok_c'),
  'contributor_photo_paths returns only the visible contributor'
);
select is(
  (select count(*) from contributor_photo_paths(array[gen_random_uuid()])),
  0::bigint,
  'an unknown id is simply absent'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Write the failing access test**

```sql
-- supabase/tests/060_access.test.sql
begin;
\ir helpers/fixtures.sql

select plan(17);

select tests.create_user('admin') as admin_id \gset
select tests.create_user('listener') as listener_id \gset

select tests.create_contributor('elder') as c \gset
update contributors set photo_path = 'contributors/secret/p.jpg' where id = :'c';
select tests.create_episode() as e \gset
select tests.link(:'e', :'c');
select tests.add_consent(:'c', 'story_recording', 'granted');
select tests.force_publish(:'e');
insert into storage.objects (bucket_id, name, metadata) values
  ('contributor-photos', 'contributors/secret/p.jpg', '{"size":1}'),
  ('consent-documents', 'consents/x/agreement.pdf', '{"size":1}');

select hasnt_column('public', 'public_contributors', 'photo_url', 'public_contributors has no photo_url');
select hasnt_column('public', 'public_contributors', 'photo_path', 'public_contributors has no photo_path');

-- No function executable by anon or authenticated mentions photo_path,
-- except contributor_photo_status, which returns a status, never a path.
select is(
  (select count(*)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ilike '%photo_path%'
     and p.proname <> 'contributor_photo_status'
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))),
  0::bigint,
  'no guest- or user-executable function exposes photo_path'
);

-- anon
set local role anon;
select is((select count(*) from contributors), 0::bigint, 'anon reads no contributors rows');
select is((select count(*) from storage.objects where bucket_id = 'contributor-photos'), 0::bigint, 'anon cannot list contributor-photos');
select is((select count(*) from storage.objects where bucket_id = 'consent-documents'), 0::bigint, 'anon cannot list consent-documents');
select throws_ok($$select contributor_photo_paths(array[gen_random_uuid()])$$, '42501', null, 'anon cannot call contributor_photo_paths');
select throws_ok(format($$select void_consent(%L, 'x')$$, gen_random_uuid()), '42501', null, 'anon cannot call void_consent');
select throws_ok(format($$select episode_publish_check(%L)$$, :'e'), '42501', null, 'anon cannot call episode_publish_check');
reset role;

-- authenticated non-admin
select tests.claims_for(:'listener_id');
set local role authenticated;
select is((select count(*) from contributors), 0::bigint, 'a non-admin reads no contributors rows');
select is((select count(*) from storage.objects where bucket_id = 'contributor-photos'), 0::bigint, 'a non-admin cannot list contributor-photos');
select throws_ok($$select contributor_photo_paths(array[gen_random_uuid()])$$, '42501', null, 'a non-admin cannot call contributor_photo_paths');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('consent-documents', 'consents/x/forged.pdf')$$,
  '42501', null, 'a non-admin cannot upload an agreement'
);
reset role;

-- admin: read and upload agreements, but never overwrite or delete them
select tests.claims_for(:'admin_id');
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'consent-documents'), 1::bigint, 'an admin can read agreements');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('consent-documents', 'consents/x/second.pdf')$$,
  'an admin can upload an agreement'
);
select is(
  (with u as (update storage.objects set metadata = '{"size":2}' where bucket_id = 'consent-documents' returning 1) select count(*) from u),
  0::bigint, 'an admin cannot overwrite an agreement'
);
select is(
  (with d as (delete from storage.objects where bucket_id = 'consent-documents' returning 1) select count(*) from d),
  0::bigint, 'an admin cannot delete an agreement'
);
reset role;

select * from finish();
rollback;
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm test:db`
Expected: `050` and `060` fail (missing column `photo_path`, missing functions).

- [ ] **Step 4: Write the migration**

```sql
-- supabase/migrations/20261004100400_contributor_photos_and_storage.sql
-- Prompt 15A: contributor photos move to a private bucket and reach the
-- app only through get-contributor-photos (signed links, consent checked
-- on every call). Signed agreements become write-once.

-- The view has no dependents (checked 2026-10-04); drop and recreate it
-- without any photo column.
drop view public_contributors;

alter table contributors rename column photo_url to photo_path;
comment on column contributors.photo_path is
  'Path in the private contributor-photos bucket. Never a URL.';

create view public_contributors as
select
  id,
  display_name,
  contributor_type,
  case when is_anonymous then null else bio end as bio,
  case when is_anonymous then null else district end as district,
  case when is_anonymous then null else country end as country,
  search_vector
from contributors
where exists (
  select 1
  from episode_contributors ec
  join episodes e on e.id = ec.episode_id
  where ec.contributor_id = contributors.id
    and e.status = 'published'
);
grant select on public_contributors to anon, authenticated;

-- Private bucket for contributor photos.
insert into storage.buckets (id, name, public)
values ('contributor-photos', 'contributor-photos', false);

create policy contributor_photos_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'contributor-photos' and is_admin());
create policy contributor_photos_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'contributor-photos' and is_admin());
create policy contributor_photos_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'contributor-photos' and is_admin());

-- Signed agreements: write-once. Admins read and upload; no update or
-- delete policy exists, so the storage API refuses overwrite and delete.
drop policy consent_documents_admin_all on storage.objects;
create policy consent_documents_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'consent-documents' and is_admin());
create policy consent_documents_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'consent-documents' and is_admin());

create function contributor_photo_status(p_contributor_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when c.is_anonymous then 'anonymous'
    when c.photo_path is null then 'no_photo'
    else case latest_counted_consent(c.id, 'photo')
      when 'granted' then 'visible'
      when 'granted_with_conditions' then 'conditions_unverified'
      when 'revoked' then 'consent_revoked'
      when 'declined' then 'consent_declined'
      else 'no_consent'
    end
  end
  from contributors c
  where c.id = p_contributor_id;
$$;
revoke execute on function contributor_photo_status(uuid) from public, anon;
grant execute on function contributor_photo_status(uuid) to authenticated;

-- Evaluated fresh per id on every call. Only get-contributor-photos calls
-- this, with the service role.
create function contributor_photo_paths(p_ids uuid[])
returns table (contributor_id uuid, photo_path text)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, c.photo_path
  from contributors c
  where c.id = any (p_ids)
    and contributor_photo_status(c.id) = 'visible';
$$;
revoke execute on function contributor_photo_paths(uuid[]) from public, anon, authenticated;
grant execute on function contributor_photo_paths(uuid[]) to service_role;

-- Current state of a consent's agreement in storage, for verification.
create function consent_document_state(p_consent_id uuid)
returns table (
  present boolean,
  current_etag text,
  current_size_bytes bigint,
  recorded_etag text,
  recorded_size_bytes bigint,
  recorded_sha256 text,
  document_path text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admins can verify agreements' using errcode = '42501';
  end if;
  return query
  select
    o.id is not null,
    o.metadata->>'eTag',
    (o.metadata->>'size')::bigint,
    c.document_storage_etag,
    c.document_size_bytes,
    c.document_sha256,
    c.document_url
  from consents c
  left join storage.objects o
    on o.bucket_id = 'consent-documents' and o.name = c.document_url
  where c.id = p_consent_id;
end;
$$;
revoke execute on function consent_document_state(uuid) from public, anon;
grant execute on function consent_document_state(uuid) to authenticated;
```

- [ ] **Step 5: Apply and run the tests**

Run: `supabase migration up --local && pnpm test:db`
Expected: all pass (8 in `050`, 17 in `060`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261004100400_contributor_photos_and_storage.sql supabase/tests/050_photos.test.sql supabase/tests/060_access.test.sql
git commit -m "Prompt 15A: private contributor photos and write-once agreements"
```

### Task 11: `storage_cleanup_queue` table

**Files:**

- Create: `supabase/tests/070_cleanup_queue.test.sql`
- Create: `supabase/migrations/20261004100500_storage_cleanup_queue.sql`

**Interfaces:**

- Produces: table `storage_cleanup_queue (id, bucket_id, object_path, source_entity_type, source_entity_id, last_error, attempts, created_at, resolved_at)` with admin select/insert/update RLS and a check refusing `consent-documents`. Used by Task 24.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/070_cleanup_queue.test.sql
begin;
\ir helpers/fixtures.sql

select plan(4);

select has_table('public', 'storage_cleanup_queue', 'storage_cleanup_queue exists');
select throws_ok(
  $$insert into storage_cleanup_queue (bucket_id, object_path) values ('consent-documents', 'consents/x.pdf')$$,
  '23514', null, 'a signed agreement can never be queued for deletion'
);
select lives_ok(
  $$insert into storage_cleanup_queue (bucket_id, object_path) values ('images', 'series/x.jpg')$$,
  'an images file can be queued'
);

select tests.create_user('listener') as listener_id \gset
select tests.claims_for(:'listener_id');
set local role authenticated;
select is((select count(*) from storage_cleanup_queue), 0::bigint, 'a non-admin sees no queue entries');
reset role;

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:db`
Expected: `070` fails (`storage_cleanup_queue exists` not ok).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261004100500_storage_cleanup_queue.sql
-- Prompt 15A: storage deletes that failed, visible and retryable from
-- Settings. Rows are resolved, never deleted.

create table storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null check (bucket_id <> 'consent-documents'),
  object_path text not null,
  source_entity_type text,
  source_entity_id uuid,
  last_error text,
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index storage_cleanup_queue_pending_idx
  on storage_cleanup_queue (created_at) where resolved_at is null;

alter table storage_cleanup_queue enable row level security;

create policy storage_cleanup_queue_admin_select on storage_cleanup_queue
  for select to authenticated using (is_admin());
create policy storage_cleanup_queue_admin_insert on storage_cleanup_queue
  for insert to authenticated with check (is_admin());
create policy storage_cleanup_queue_admin_update on storage_cleanup_queue
  for update to authenticated using (is_admin()) with check (is_admin());

revoke delete, truncate on storage_cleanup_queue from anon, authenticated;
```

- [ ] **Step 4: Apply and run the tests**

Run: `supabase migration up --local && pnpm test:db`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261004100500_storage_cleanup_queue.sql supabase/tests/070_cleanup_queue.test.sql
git commit -m "Prompt 15A: add storage_cleanup_queue"
```

### Task 12: Upgrade assertions and concurrency tests

**Files:**

- Modify: `supabase/tests/upgrade/assertions.sql`
- Create: `packages/db-integration-tests/src/fixtures.ts`
- Create: `packages/db-integration-tests/src/concurrency.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 6–11.
- Produces (`src/fixtures.ts`): `createPublishableElderEpisode(client: pg.Client): Promise<{ episodeId: string; contributorId: string }>` (granted story_recording consent inserted directly; episode left as draft), `latestStoryRecording(client: pg.Client, contributorId: string): Promise<string | null>`, `episodeStatus(client: pg.Client, episodeId: string): Promise<string>`.

- [ ] **Step 1: Extend the upgrade assertions**

Append to `supabase/tests/upgrade/assertions.sql`:

```sql
-- 15A: the migrations added structure without changing legacy data.
do $$
begin
  if (select hidden_by_consent_at from episodes where id = '55555555-5555-5555-5555-555555555555') is not null then
    raise exception 'upgrade: migrations hid the legacy episode';
  end if;
  if to_regclass('public.consent_voids') is null then
    raise exception 'upgrade: consent_voids missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'episodes_guard_publish_state') then
    raise exception 'upgrade: publish guard trigger missing';
  end if;
  if exists (select 1 from information_schema.columns
             where table_name = 'public_contributors' and column_name like 'photo%') then
    raise exception 'upgrade: public_contributors still exposes a photo column';
  end if;
  -- The legacy elder episode has no consent, so it would fail the check.
  -- Migrations never hide retroactively; this is the report an admin uses.
  if not exists (
    select 1 from episodes e
    where e.status = 'published'
      and exists (select 1 from episode_publish_check(e.id) c where c.blocking and not c.passed)
  ) then
    raise exception 'upgrade: the failing-published report should list the legacy episode';
  end if;
end;
$$;
```

Run: `bash supabase/tests/upgrade/run.sh`
Expected: `Upgrade test passed.`

- [ ] **Step 2: Write the fixtures**

```ts
// packages/db-integration-tests/src/fixtures.ts
import type pg from "pg";

export async function createPublishableElderEpisode(
  client: pg.Client,
): Promise<{ episodeId: string; contributorId: string }> {
  const { rows: contributorRows } = await client.query<{ id: string }>(
    `insert into contributors (full_name, display_name, contributor_type)
     values ('Concurrency Elder', 'Concurrency Elder', 'elder') returning id`,
  );
  const contributorId = contributorRows[0].id;
  const { rows: seriesRows } = await client.query<{ id: string }>(
    `insert into series (title, slug) values ('Concurrency', 'concurrency-' || gen_random_uuid()) returning id`,
  );
  const { rows: episodeRows } = await client.query<{ id: string }>(
    `insert into episodes (series_id, episode_number, title, description, audio_url, content_source)
     values ($1, 1, 'Concurrency Episode', 'Description', 'episodes/c.m4a', 'elder_testimony') returning id`,
    [seriesRows[0].id],
  );
  const episodeId = episodeRows[0].id;
  await client.query(
    `insert into episode_contributors (episode_id, contributor_id, role) values ($1, $2, 'narrator')`,
    [episodeId, contributorId],
  );
  await client.query(
    `insert into consents (contributor_id, consent_type, consent_status) values ($1, 'story_recording', 'granted')`,
    [contributorId],
  );
  return { episodeId, contributorId };
}

export async function latestStoryRecording(
  client: pg.Client,
  contributorId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ status: string | null }>(
    `select latest_counted_consent($1, 'story_recording')::text as status`,
    [contributorId],
  );
  return rows[0].status;
}

export async function episodeStatus(client: pg.Client, episodeId: string): Promise<string> {
  const { rows } = await client.query<{ status: string }>(
    "select status::text from episodes where id = $1",
    [episodeId],
  );
  return rows[0].status;
}
```

- [ ] **Step 3: Write the concurrency tests**

```ts
// packages/db-integration-tests/src/concurrency.test.ts
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPublishableElderEpisode, episodeStatus, latestStoryRecording } from "./fixtures";
import { beginAs, connect, createUser } from "./local-stack";

const STRESS_ROUNDS = 50;
const DEADLOCK = "40P01";

// No timing assertions anywhere: only invariants and error codes. A slow
// machine makes these slower, never failing. A failure is a real race.
describe("publish and consent writes under concurrency", () => {
  let setup: pg.Client;
  let a: pg.Client;
  let b: pg.Client;
  let adminId: string;

  beforeAll(async () => {
    setup = await connect();
    a = await connect();
    b = await connect();
    adminId = await createUser(setup, "admin");
  });

  afterAll(async () => {
    await Promise.all([setup.end(), a.end(), b.end()]);
  });

  it("revoke waits for an in-flight publish, then hides the episode", async () => {
    const { episodeId, contributorId } = await createPublishableElderEpisode(setup);

    await beginAs(a, adminId);
    await a.query("select publish_episode($1)", [episodeId]); // holds its locks

    await beginAs(b, adminId);
    const revoke = b.query("select record_consent($1, 'story_recording', 'revoked', 'withdrawn')", [
      contributorId,
    ]);

    await a.query("commit");
    await revoke;
    await b.query("commit");

    expect(await episodeStatus(setup, episodeId)).toBe("review");
  });

  it("publish waits for an in-flight revoke, then is refused", async () => {
    const { episodeId, contributorId } = await createPublishableElderEpisode(setup);

    await beginAs(b, adminId);
    await b.query("select record_consent($1, 'story_recording', 'revoked', 'withdrawn')", [
      contributorId,
    ]);

    await beginAs(a, adminId);
    const publish = a.query("select publish_episode($1)", [episodeId]).then(
      () => null,
      (error: { code?: string }) => error.code ?? "unknown",
    );

    await b.query("commit");
    expect(await publish).toBe("VF001");
    await a.query("rollback");

    expect(await episodeStatus(setup, episodeId)).toBe("draft");
  });

  it("unlink waits for an in-flight publish, then is refused", async () => {
    const { episodeId, contributorId } = await createPublishableElderEpisode(setup);

    await beginAs(a, adminId);
    await a.query("select publish_episode($1)", [episodeId]);

    await b.query("begin");
    const unlink = b
      .query("delete from episode_contributors where episode_id = $1 and contributor_id = $2", [
        episodeId,
        contributorId,
      ])
      .then(
        () => null,
        (error: { code?: string }) => error.code ?? "unknown",
      );

    await a.query("commit");
    expect(await unlink).toBe("VF003");
    await b.query("rollback");

    expect(await episodeStatus(setup, episodeId)).toBe("published");
  });

  it(`never publishes with revoked consent and never deadlocks (${STRESS_ROUNDS} rounds)`, async () => {
    for (let round = 1; round <= STRESS_ROUNDS; round++) {
      const { episodeId, contributorId } = await createPublishableElderEpisode(setup);

      const run = async (client: pg.Client, sql: string, params: unknown[]) => {
        await beginAs(client, adminId);
        try {
          await client.query(sql, params);
          await client.query("commit");
          return null;
        } catch (error) {
          await client.query("rollback");
          return (error as { code?: string }).code ?? "unknown";
        }
      };

      const [publishCode, revokeCode] = await Promise.all([
        run(a, "select publish_episode($1)", [episodeId]),
        run(b, "select record_consent($1, 'story_recording', 'revoked', 'withdrawn')", [
          contributorId,
        ]),
      ]);

      const context = `round ${round}: publish=${publishCode ?? "ok"} revoke=${revokeCode ?? "ok"}`;
      expect(publishCode, context).not.toBe(DEADLOCK);
      expect(revokeCode, context).not.toBe(DEADLOCK);
      expect(revokeCode, context).toBeNull();
      expect([null, "VF001"], context).toContain(publishCode);

      const status = await episodeStatus(setup, episodeId);
      const latest = await latestStoryRecording(setup, contributorId);
      expect(status === "published" && latest !== "granted", context).toBe(false);
    }
  });
});
```

- [ ] **Step 4: Run them**

Run: `pnpm test:integration`
Expected: all pass, including 50 stress rounds. If any round fails, do not retry: report the round's context line to the user as a race.

- [ ] **Step 5: Run the full database suite once more from scratch**

Run: `bash supabase/tests/upgrade/run.sh && pnpm test:db && pnpm test:integration`
Expected: all pass.

- [ ] **Step 6: Commit and push**

```bash
git add supabase/tests/upgrade/assertions.sql packages/db-integration-tests/src
git commit -m "Prompt 15A: upgrade assertions and concurrency tests"
git push
```

Confirm the `db-tests` CI job passes on the push.

**MILESTONE 2 STOP.** Report: every pgTAP file and its assertion count, the upgrade test, the concurrency results (including the stress round count), the CI run, and the reminder that contributor screens fail against the local database until Milestone 3. Wait for the user's review.

---

## Milestone 3: Photo function and mobile changes

### Task 13: `get-contributor-photos` edge function

**Files:**

- Create: `supabase/functions/get-contributor-photos/validate.ts`
- Create: `supabase/functions/get-contributor-photos/index.ts`
- Create: `packages/db-integration-tests/src/validate.test.ts`
- Create: `packages/db-integration-tests/src/photo-function.test.ts`

**Interfaces:**

- Consumes: `contributor_photo_paths(p_ids uuid[])` (Task 10).
- Produces: `POST /functions/v1/get-contributor-photos` with body `{ contributorIds: string[] }` → `200 { photos: Record<string, { url: string; cacheKey: string }> }`, or `400 { error: "invalid_request" }`; header `Cache-Control: no-store`. Constants `MAX_IDS = 50`, `PHOTO_LINK_TTL_SECONDS = 3600`. Pure helpers `parseContributorIds(body: unknown): { ok: true; ids: string[] } | { ok: false }` and `cacheKeyForPath(path: string): string`.

- [ ] **Step 1: Write the failing validation test**

```ts
// packages/db-integration-tests/src/validate.test.ts
import { describe, expect, it } from "vitest";

import {
  cacheKeyForPath,
  MAX_IDS,
  parseContributorIds,
} from "../../../supabase/functions/get-contributor-photos/validate";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("parseContributorIds", () => {
  it("accepts 1 to 50 UUIDs and de-duplicates them", () => {
    expect(parseContributorIds({ contributorIds: [id(1), id(1), id(2)] })).toEqual({
      ok: true,
      ids: [id(1), id(2)],
    });
  });

  it("accepts exactly MAX_IDS", () => {
    const ids = Array.from({ length: MAX_IDS }, (_, i) => id(i));
    expect(parseContributorIds({ contributorIds: ids })).toEqual({ ok: true, ids });
  });

  it.each([
    ["no body", null],
    ["no array", { contributorIds: "x" }],
    ["an empty array", { contributorIds: [] }],
    ["51 ids", { contributorIds: Array.from({ length: MAX_IDS + 1 }, (_, i) => id(i)) }],
    ["a malformed id", { contributorIds: [id(1), "not-a-uuid"] }],
    ["a non-string id", { contributorIds: [42] }],
  ])("rejects %s", (_label, body) => {
    expect(parseContributorIds(body)).toEqual({ ok: false });
  });
});

describe("cacheKeyForPath", () => {
  it("uses the random file id, not the contributor id or the path", () => {
    const key = cacheKeyForPath(`contributors/${id(7)}/9f1c2d3e-aaaa-4bbb-8ccc-123456789abc.jpg`);
    expect(key).toBe("contributor-photo-9f1c2d3e-aaaa-4bbb-8ccc-123456789abc");
    expect(key).not.toContain(id(7));
  });
});
```

Run: `pnpm test:integration -- validate`
Expected: FAIL (module not found).

- [ ] **Step 2: Write the validation module**

```ts
// supabase/functions/get-contributor-photos/validate.ts
// Pure helpers, no Deno APIs, so Vitest can import them too.

export const MAX_IDS = 50;
export const PHOTO_LINK_TTL_SECONDS = 3600;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseContributorIds(body: unknown): { ok: true; ids: string[] } | { ok: false } {
  if (typeof body !== "object" || body === null) {
    return { ok: false };
  }
  const raw = (body as { contributorIds?: unknown }).contributorIds;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_IDS) {
    return { ok: false };
  }
  if (!raw.every((value) => typeof value === "string" && UUID_RE.test(value))) {
    return { ok: false };
  }
  return { ok: true, ids: [...new Set(raw as string[])] };
}

// contributors/<contributor-id>/<random-id>.<ext> → contributor-photo-<random-id>
export function cacheKeyForPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  const randomId = file.replace(/\.[^.]+$/, "");
  return `contributor-photo-${randomId}`;
}
```

Run: `pnpm test:integration -- validate`
Expected: PASS.

- [ ] **Step 3: Write the function**

```ts
// supabase/functions/get-contributor-photos/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { cacheKeyForPath, parseContributorIds, PHOTO_LINK_TTL_SECONDS } from "./validate.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  // Links are short-lived and consent can change at any moment.
  "Cache-Control": "no-store",
};

function respond(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers });
}

// Guests may call this: it only ever returns links for photos that passed
// the consent check on this call. Failures are simply absent, with no
// reason given.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return respond({ error: "invalid_request" }, 400);
  }
  const parsed = parseContributorIds(body);
  if (!parsed.ok) {
    return respond({ error: "invalid_request" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: visible, error } = await supabase.rpc("contributor_photo_paths", {
    p_ids: parsed.ids,
  });
  if (error) {
    console.error("contributor_photo_paths failed:", error);
    return respond({ error: "server_error" }, 500);
  }

  const rows = (visible ?? []) as { contributor_id: string; photo_path: string }[];
  if (rows.length === 0) {
    return respond({ photos: {} }, 200);
  }

  const { data: signed, error: signError } = await supabase.storage
    .from("contributor-photos")
    .createSignedUrls(
      rows.map((row) => row.photo_path),
      PHOTO_LINK_TTL_SECONDS,
    );
  if (signError) {
    console.error("createSignedUrls failed:", signError);
    return respond({ error: "server_error" }, 500);
  }

  const urlByPath = new Map(
    (signed ?? []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]),
  );
  const photos: Record<string, { url: string; cacheKey: string }> = {};
  for (const row of rows) {
    const url = urlByPath.get(row.photo_path);
    // A photo row with a missing file is treated like any other failure.
    if (url) {
      photos[row.contributor_id] = { url, cacheKey: cacheKeyForPath(row.photo_path) };
    }
  }
  return respond({ photos }, 200);
});
```

- [ ] **Step 4: Write the failing end-to-end test**

```ts
// packages/db-integration-tests/src/photo-function.test.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connect, LOCAL_API_URL, localKeys } from "./local-stack";

const FUNCTION_URL = `${LOCAL_API_URL}/functions/v1/get-contributor-photos`;

async function callAsGuest(body: unknown): Promise<Response> {
  return fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: localKeys().anonKey,
      Authorization: `Bearer ${localKeys().anonKey}`,
    },
    body: JSON.stringify(body),
  });
}

describe("get-contributor-photos", () => {
  let db: pg.Client;
  let service: SupabaseClient;
  const ids: Record<string, string> = {};

  async function contributorWithPhoto(name: string, anonymous = false): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into contributors (full_name, display_name, contributor_type, is_anonymous)
       values ($1, $1, 'elder', $2) returning id`,
      [name, anonymous],
    );
    const id = rows[0].id;
    const path = `contributors/${id}/${crypto.randomUUID()}.jpg`;
    const { error } = await service.storage
      .from("contributor-photos")
      .upload(path, new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }));
    if (error) {
      throw error;
    }
    await db.query("update contributors set photo_path = $1 where id = $2", [path, id]);
    return id;
  }

  async function consent(id: string, status: string, reason: string | null = null) {
    await db.query(
      `insert into consents (contributor_id, consent_type, consent_status, reason) values ($1, 'photo', $2, $3) returning id`,
      [id, status, reason],
    );
  }

  beforeAll(async () => {
    db = await connect();
    service = createClient(LOCAL_API_URL, localKeys().serviceRoleKey);

    ids.visible = await contributorWithPhoto("Visible");
    await consent(ids.visible, "granted");

    ids.revoked = await contributorWithPhoto("Revoked");
    await consent(ids.revoked, "granted");
    await consent(ids.revoked, "revoked", "withdrawn");

    ids.anonymous = await contributorWithPhoto("Anonymous", true);
    await consent(ids.anonymous, "granted");

    ids.noConsent = await contributorWithPhoto("No consent");

    ids.conditions = await contributorWithPhoto("Conditions");
    await consent(ids.conditions, "granted_with_conditions");

    ids.voided = await contributorWithPhoto("Voided");
    const { rows } = await db.query<{ id: string }>(
      `insert into consents (contributor_id, consent_type, consent_status) values ($1, 'photo', 'granted') returning id`,
      [ids.voided],
    );
    const { rows: admin } = await db.query<{ id: string }>(
      "select id from profiles where role = 'admin' limit 1",
    );
    await db.query(
      "insert into consent_voids (consent_id, reason, voided_by) values ($1, 'wrong person', $2)",
      [rows[0].id, admin[0].id],
    );
  });

  afterAll(async () => {
    await db.end();
  });

  it("returns a link only for the visible contributor, for a guest caller", async () => {
    const response = await callAsGuest({ contributorIds: Object.values(ids) });
    expect(response.status).toBe(200);
    const { photos } = (await response.json()) as {
      photos: Record<string, { url: string; cacheKey: string }>;
    };
    expect(Object.keys(photos)).toEqual([ids.visible]);
    expect(photos[ids.visible].url).toContain("/storage/v1/object/sign/contributor-photos/");
    expect(photos[ids.visible].cacheKey).toMatch(/^contributor-photo-/);
  });

  it.each(["revoked", "anonymous", "noConsent", "conditions", "voided"])(
    "returns no link for the %s contributor",
    async (key) => {
      const response = await callAsGuest({ contributorIds: [ids[key]] });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ photos: {} });
    },
  );

  it("treats unknown ids as absent, not as an error", async () => {
    const response = await callAsGuest({ contributorIds: [crypto.randomUUID(), ids.visible] });
    expect(response.status).toBe(200);
    const { photos } = (await response.json()) as { photos: Record<string, unknown> };
    expect(Object.keys(photos)).toEqual([ids.visible]);
  });

  it("rejects 51 ids", async () => {
    const response = await callAsGuest({
      contributorIds: Array.from({ length: 51 }, () => crypto.randomUUID()),
    });
    expect(response.status).toBe(400);
  });

  it("rejects malformed UUIDs", async () => {
    const response = await callAsGuest({ contributorIds: ["not-a-uuid"] });
    expect(response.status).toBe(400);
  });

  it("is never cached", async () => {
    const response = await callAsGuest({ contributorIds: [ids.visible] });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
```

The voided case needs at least one admin profile; `harness.test.ts` creates one, and the test files run in order. If this file runs first in some setup, create an admin with `createUser(db, "admin")` instead of the `select`.

- [ ] **Step 5: Run it**

Run: `pnpm test:integration -- photo-function`
Expected: all pass. `supabase start` serves `supabase/functions/*` through its edge runtime. If the function returns 404, check `supabase status` shows the functions URL; if functions aren't served automatically by this CLI version, run `supabase functions serve &` before the tests, and add the same step to the CI job before "Integration tests". Report which was needed.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/get-contributor-photos packages/db-integration-tests/src/validate.test.ts packages/db-integration-tests/src/photo-function.test.ts
git commit -m "Prompt 15A: add get-contributor-photos edge function"
```

### Task 14: Mobile `useContributorPhotos` hook

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-contributor-photos.ts`
- Create: `apps/mobile/src/hooks/queries/use-contributor-photos.test.tsx`

**Interfaces:**

- Consumes: the edge function (Task 13).
- Produces: `type ContributorPhoto = { url: string; cacheKey: string }`; `useContributorPhotos(contributorIds: string[]): { photoFor: (contributorId: string) => ContributorPhoto | null }`; `fetchContributorPhotos(ids: string[]): Promise<Record<string, ContributorPhoto>>` (batches of 50).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/hooks/queries/use-contributor-photos.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import type { ReactNode } from "react";

import { supabase } from "@/lib/supabase";

import { useContributorPhotos } from "./use-contributor-photos";

jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const focusCallbacks: (() => void)[] = [];
jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void) => {
    focusCallbacks.push(callback);
  },
}));

const mockInvoke = supabase.functions.invoke as jest.Mock;
const photo = { url: "https://example.test/signed", cacheKey: "contributor-photo-abc" };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useContributorPhotos", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    focusCallbacks.length = 0;
  });

  it("returns a photo only for contributors in the current response", async () => {
    mockInvoke.mockResolvedValue({ data: { photos: { a: photo } }, error: null });
    const { result } = await renderHook(() => useContributorPhotos(["a", "b"]), { wrapper });
    await waitFor(() => expect(result.current.photoFor("a")).toEqual(photo));
    expect(result.current.photoFor("b")).toBeNull();
  });

  it("drops a photo when a refetch no longer includes it", async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: { photos: { a: photo } }, error: null })
      .mockResolvedValueOnce({ data: { photos: {} }, error: null });
    const { result } = await renderHook(() => useContributorPhotos(["a"]), { wrapper });
    await waitFor(() => expect(result.current.photoFor("a")).toEqual(photo));
    await act(async () => {
      focusCallbacks[focusCallbacks.length - 1]();
    });
    await waitFor(() => expect(result.current.photoFor("a")).toBeNull());
  });

  it("shows no photos when the latest request failed", async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: { photos: { a: photo } }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("offline") });
    const { result } = await renderHook(() => useContributorPhotos(["a"]), { wrapper });
    await waitFor(() => expect(result.current.photoFor("a")).toEqual(photo));
    await act(async () => {
      focusCallbacks[focusCallbacks.length - 1]();
    });
    await waitFor(() => expect(result.current.photoFor("a")).toBeNull());
  });

  it("refetches when the app returns to the foreground", async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    mockInvoke.mockResolvedValue({ data: { photos: {} }, error: null });
    await renderHook(() => useContributorPhotos(["a"]), { wrapper });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
    await act(async () => {
      listener?.("active");
    });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
  });

  it("makes no request with no ids", async () => {
    await renderHook(() => useContributorPhotos([]), { wrapper });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter mobile test -- use-contributor-photos`
Expected: FAIL (module not found).

- [ ] **Step 2: Write the hook**

```ts
// apps/mobile/src/hooks/queries/use-contributor-photos.ts
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { AppState } from "react-native";

import { supabase } from "@/lib/supabase";

export type ContributorPhoto = { url: string; cacheKey: string };

const MAX_IDS_PER_REQUEST = 50;
// Links last an hour (PHOTO_LINK_TTL_SECONDS); refresh well before that.
const REFRESH_INTERVAL_MS = 45 * 60 * 1000;

export async function fetchContributorPhotos(
  ids: string[],
): Promise<Record<string, ContributorPhoto>> {
  const photos: Record<string, ContributorPhoto> = {};
  for (let start = 0; start < ids.length; start += MAX_IDS_PER_REQUEST) {
    const batch = ids.slice(start, start + MAX_IDS_PER_REQUEST);
    const { data, error } = await supabase.functions.invoke<{
      photos: Record<string, ContributorPhoto>;
    }>("get-contributor-photos", { body: { contributorIds: batch } });
    if (error) {
      throw error;
    }
    Object.assign(photos, data?.photos ?? {});
  }
  return photos;
}

// A contributor's photo is shown only if the latest response includes a
// link for them. If the latest request failed, no photos are shown: an
// older response might include a photo whose consent has since been
// revoked.
export function useContributorPhotos(contributorIds: string[]): {
  photoFor: (contributorId: string) => ContributorPhoto | null;
} {
  const key = [...new Set(contributorIds)].sort().join(",");
  const ids = useMemo(() => (key ? key.split(",") : []), [key]);

  const query = useQuery({
    queryKey: ["contributor-photos", key],
    enabled: ids.length > 0,
    staleTime: 0,
    refetchInterval: REFRESH_INTERVAL_MS,
    queryFn: () => fetchContributorPhotos(ids),
  });
  const { refetch } = query;

  useFocusEffect(
    useCallback(() => {
      if (ids.length > 0) {
        void refetch();
      }
    }, [ids.length, refetch]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && ids.length > 0) {
        void refetch();
      }
    });
    return () => subscription.remove();
  }, [ids.length, refetch]);

  const photos = query.isError ? null : query.data;
  return {
    photoFor: (contributorId: string) => photos?.[contributorId] ?? null,
  };
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter mobile test -- use-contributor-photos`
Expected: 5 pass.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/hooks/queries/use-contributor-photos.ts apps/mobile/src/hooks/queries/use-contributor-photos.test.tsx
git commit -m "Prompt 15A: add useContributorPhotos with consent-checked links"
```

### Task 15: Mobile screens use signed photo links

**Files:**

- Modify: `apps/mobile/src/types/content.ts` (`PublicContributor`)
- Modify: `apps/mobile/src/hooks/queries/use-contributor-detail.ts`
- Modify: `apps/mobile/src/hooks/queries/use-cultural-group-detail.ts`
- Modify: `apps/mobile/src/hooks/queries/use-destination-detail.ts`
- Modify: `apps/mobile/src/hooks/queries/use-home-sections.ts`
- Modify: `apps/mobile/src/components/ui/destination-card.tsx`
- Modify: `apps/mobile/src/app/(app)/contributor/[id].tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/index.tsx`
- Modify: `apps/mobile/src/app/(app)/cultural-group/[id].tsx`
- Modify: `apps/mobile/src/app/(app)/destination/[slug].tsx`

**Interfaces:**

- Consumes: `useContributorPhotos` (Task 14).
- Produces: `PublicContributor` without `photoUrl`; `ContributorDetail` without `photoUrl`; `DestinationCard` props `coverImageUrl: string | null`, new optional `coverImageCacheKey?: string` and `coverImageCachePolicy?: "memory" | "memory-disk"`.

- [ ] **Step 1: Remove `photo_url` from every query and type**

- In `types/content.ts`, delete the `photoUrl: string | null;` line from `PublicContributor`.
- In `use-contributor-detail.ts`: delete `photoUrl` from `ContributorDetail`, `photo_url` from `ContributorRow`, `photo_url` from the `.select(...)` string (it becomes `"id, display_name, contributor_type, bio, district, country"`), and `photoUrl: contributor.photo_url,` from the returned object.
- In `use-cultural-group-detail.ts`, `use-destination-detail.ts` and `use-home-sections.ts`: remove `photo_url` from each `public_contributors` `.select(...)` string, from the row type, and from the mapping to `PublicContributor`.

Run: `pnpm --filter mobile typecheck`
Expected: errors only in the four screens that read `photoUrl` (fixed next).

- [ ] **Step 2: Let `DestinationCard` take a cache key and policy**

In `components/ui/destination-card.tsx`, add the two optional props and pass them to `Image`:

```tsx
export function DestinationCard({
  name,
  region,
  coverImageUrl,
  coverImageCacheKey,
  coverImageCachePolicy = "memory-disk",
  onPress,
}: {
  name: string;
  region: string | null;
  coverImageUrl: string | null;
  // Contributor photos pass a stable key and "memory" so they never reach
  // the disk cache (expo-image can't evict a single disk entry).
  coverImageCacheKey?: string;
  coverImageCachePolicy?: "memory" | "memory-disk";
  onPress?: () => void;
}) {
```

and replace the `Image` element with:

```tsx
<Image
  source={{ uri: coverImageUrl, cacheKey: coverImageCacheKey }}
  cachePolicy={coverImageCachePolicy}
  style={styles.cover}
  contentFit="cover"
/>
```

- [ ] **Step 3: Contributor detail screen**

In `app/(app)/contributor/[id].tsx`, add `import { useContributorPhotos } from "@/hooks/queries/use-contributor-photos";`, call it after the detail query:

```tsx
const { photoFor } = useContributorPhotos(contributor ? [contributor.id] : []);
const photo = contributor ? photoFor(contributor.id) : null;
```

(adapt `contributor` to however the screen names the loaded detail), and replace the photo block with:

```tsx
        {photo ? (
          <Image
            source={{ uri: photo.url, cacheKey: photo.cacheKey }}
            cachePolicy="memory"
            style={styles.photo}
            contentFit="cover"
          />
        ) : (
```

keeping the existing placeholder branch after `) : (`.

- [ ] **Step 4: The three list screens**

In each of `(tabs)/index.tsx` (storytellers row), `cultural-group/[id].tsx` and `destination/[slug].tsx`, before the contributor row:

```tsx
const { photoFor } = useContributorPhotos(
  (contributors ?? []).map((contributor) => contributor.id),
);
```

(use the screen's existing variable for the contributor list, e.g. `storytellers.data` on Home), and change each `DestinationCard` for a contributor to:

```tsx
<DestinationCard
  key={contributor.id}
  name={contributor.displayName}
  region={contributor.district}
  coverImageUrl={photoFor(contributor.id)?.url ?? null}
  coverImageCacheKey={photoFor(contributor.id)?.cacheKey}
  coverImageCachePolicy="memory"
  onPress={() => goToContributor(contributor.id)}
/>
```

Hooks must be called unconditionally at the top level of the component; if a screen returns early before the list is loaded, place the `useContributorPhotos` call above the early return, passing `[]` until data exists.

- [ ] **Step 5: Verify**

Run: `pnpm --filter mobile typecheck && pnpm --filter mobile lint && pnpm --filter mobile test`
Expected: all pass. Then `grep -rn "photo_url\|photoUrl" apps/mobile/src` returns nothing.

- [ ] **Step 6: Commit and push**

```bash
git add apps/mobile/src
git commit -m "Prompt 15A: mobile contributor photos come from signed links only"
git push
```

Confirm CI passes on the push.

**MILESTONE 3 STOP.** Report: the photo function's test results (each of the five consent cases, the cap, bad UUIDs, guest access, `no-store`), whether functions were served automatically by `supabase start`, the hook tests, the screens changed, and the reminder that "photos never reach disk" is a manual check for the development-build session. Wait for the user's review.

---

## Milestone 4: Admin screens

Precedent from Prompt 14 holds: pure logic gets Vitest tests; pages, components and I/O-orchestrating server actions don't. The database behaviour behind every screen is already covered by Milestone 2's pgTAP tests.

### Task 16: Shared admin pieces (schemas, audit redaction, summaries, errors)

**Files:**

- Create: `supabase/tests/080_admin_summaries.test.sql`
- Create: `supabase/migrations/20261004100600_admin_contributor_summaries.sql`
- Create: `apps/admin/src/lib/contributor-audit.ts`
- Create: `apps/admin/src/lib/contributor-audit.test.ts`
- Create: `apps/admin/src/lib/db-errors.ts`
- Create: `apps/admin/src/lib/db-errors.test.ts`
- Create: `apps/admin/src/lib/image-resize.ts`
- Create: `apps/admin/src/lib/image-resize.test.ts`
- Modify: `apps/admin/src/lib/validation.ts`

**Interfaces:**

- Produces:
  - SQL `admin_contributor_summaries() returns table(contributor_id uuid, latest_story_recording consent_status, latest_photo consent_status, photo_status text, episode_count bigint)` (security invoker; non-admins get no rows)
  - `contributorAuditDetails(before: Record<string, unknown> | null, after: Record<string, unknown>): { changed_fields: string[]; values: Record<string, unknown> }`
  - `REDACTED_CONTRIBUTOR_FIELDS: ReadonlySet<string>` = `full_name`, `phone`, `approximate_birth_year`, `village`
  - `dbErrorMessage(error: { code?: string; message: string }): string`
  - `fitWithin(width: number, height: number, maxWidth: number): { width: number; height: number }`, `resizeImage(file: File, maxWidth?: number): Promise<Blob>` (JPEG, max 512 px wide)
  - zod: `contributorSchema`/`ContributorInput`, `consentSchema`/`ConsentInput`, `sourceMaterialSchema`/`SourceMaterialInput`, `CONSENT_TYPES`, `CONSENT_STATUSES`, `CONTRIBUTOR_TYPES`

- [ ] **Step 1: Write the failing summaries test**

```sql
-- supabase/tests/080_admin_summaries.test.sql
begin;
\ir helpers/fixtures.sql

select plan(3);

select tests.create_contributor('elder') as c \gset
update contributors set photo_path = 'contributors/x/p.jpg' where id = :'c';
select tests.add_consent(:'c', 'story_recording', 'granted');
select tests.add_consent(:'c', 'photo', 'granted_with_conditions');
select tests.create_episode() as e \gset
select tests.link(:'e', :'c');

select results_eq(
  format($$select latest_story_recording::text, latest_photo::text, photo_status, episode_count
           from admin_contributor_summaries() where contributor_id = %L$$, :'c'),
  $$values ('granted', 'granted_with_conditions', 'conditions_unverified', 1::bigint)$$,
  'the summary uses the same latest-counted rule as the checks'
);

select tests.create_user('listener') as listener_id \gset
select tests.claims_for(:'listener_id');
set local role authenticated;
select is((select count(*) from admin_contributor_summaries()), 0::bigint, 'a non-admin gets no summaries');
reset role;

set local role anon;
select throws_ok($$select * from admin_contributor_summaries()$$, '42501', null, 'anon cannot call it');
reset role;

select * from finish();
rollback;
```

Run: `pnpm test:db`
Expected: `080` fails (function missing).

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20261004100600_admin_contributor_summaries.sql
-- Prompt 15A: read helper for the admin contributor list, so the screen
-- uses the same "latest counted consent" rule as every check instead of
-- re-implementing it in TypeScript.

create function admin_contributor_summaries()
returns table (
  contributor_id uuid,
  latest_story_recording consent_status,
  latest_photo consent_status,
  photo_status text,
  episode_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    latest_counted_consent(c.id, 'story_recording'),
    latest_counted_consent(c.id, 'photo'),
    contributor_photo_status(c.id),
    (select count(*) from episode_contributors ec where ec.contributor_id = c.id)
  from contributors c;
$$;
revoke execute on function admin_contributor_summaries() from public, anon;
grant execute on function admin_contributor_summaries() to authenticated;
```

Run: `supabase migration up --local && pnpm test:db`
Expected: all pass.

- [ ] **Step 3: Write the failing TypeScript tests**

```ts
// apps/admin/src/lib/contributor-audit.test.ts
import { describe, expect, it } from "vitest";

import { contributorAuditDetails } from "./contributor-audit";

const sensitive = {
  full_name: "Nalubega Sarah",
  phone: "+256700000000",
  approximate_birth_year: 1941,
  village: "Kibuye",
};

describe("contributorAuditDetails", () => {
  it("never records values of sensitive fields on create", () => {
    const details = contributorAuditDetails(null, {
      ...sensitive,
      display_name: "Jajja Sarah",
      is_anonymous: false,
    });
    const serialized = JSON.stringify(details);
    for (const value of Object.values(sensitive)) {
      expect(serialized).not.toContain(String(value));
    }
    expect(details.changed_fields).toEqual(expect.arrayContaining(Object.keys(sensitive)));
    expect(details.values).toEqual({ display_name: "Jajja Sarah", is_anonymous: false });
  });

  it("records only changed fields on edit, still without sensitive values", () => {
    const before = { ...sensitive, display_name: "Jajja Sarah", bio: "old" };
    const after = { ...sensitive, phone: "+256711111111", display_name: "Jajja Sarah", bio: "new" };
    const details = contributorAuditDetails(before, after);
    expect(details.changed_fields.sort()).toEqual(["bio", "phone"]);
    expect(details.values).toEqual({ bio: "new" });
    expect(JSON.stringify(details)).not.toContain("+256711111111");
  });

  it("redacts regardless of anonymity", () => {
    const details = contributorAuditDetails(null, {
      full_name: "Visible Name",
      is_anonymous: false,
    });
    expect(JSON.stringify(details)).not.toContain("Visible Name");
  });
});
```

```ts
// apps/admin/src/lib/db-errors.test.ts
import { describe, expect, it } from "vitest";

import { dbErrorMessage } from "./db-errors";

describe("dbErrorMessage", () => {
  it("explains a permission error", () => {
    expect(dbErrorMessage({ code: "42501", message: "x" })).toBe(
      "You don't have permission to do that.",
    );
  });

  it("passes rule messages from the database through", () => {
    expect(dbErrorMessage({ code: "VF004", message: "A revocation needs a reason." })).toBe(
      "A revocation needs a reason.",
    );
  });

  it("explains an append-only refusal", () => {
    expect(dbErrorMessage({ code: "VF005", message: "x" })).toBe(
      "Consent records can't be edited or deleted. Void the entry and add a corrected one instead.",
    );
  });
});
```

```ts
// apps/admin/src/lib/image-resize.test.ts
import { describe, expect, it } from "vitest";

import { fitWithin } from "./image-resize";

describe("fitWithin", () => {
  it("scales a wide image down to the max width, keeping the aspect ratio", () => {
    expect(fitWithin(2048, 1536, 512)).toEqual({ width: 512, height: 384 });
  });

  it("never scales a small image up", () => {
    expect(fitWithin(300, 400, 512)).toEqual({ width: 300, height: 400 });
  });
});
```

Run: `pnpm --filter admin test`
Expected: the three new files fail (modules not found).

- [ ] **Step 4: Write the implementations**

```ts
// apps/admin/src/lib/contributor-audit.ts
// Audit entries record which contributor fields changed. Values are kept
// only for non-sensitive fields: these four are always name-only,
// whether or not the contributor is anonymous.
export const REDACTED_CONTRIBUTOR_FIELDS: ReadonlySet<string> = new Set([
  "full_name",
  "phone",
  "approximate_birth_year",
  "village",
]);

export function contributorAuditDetails(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): { changed_fields: string[]; values: Record<string, unknown> } {
  const changed = Object.keys(after).filter(
    (field) => before === null || before[field] !== after[field],
  );
  const values = Object.fromEntries(
    changed
      .filter((field) => !REDACTED_CONTRIBUTOR_FIELDS.has(field))
      .map((field) => [field, after[field]]),
  );
  return { changed_fields: changed, values };
}
```

```ts
// apps/admin/src/lib/db-errors.ts
// Turns database errors into messages an admin can act on. Rule
// violations (VF001–VF004) already carry a plain-language message from
// the SQL function, so those pass through.
export function dbErrorMessage(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "42501":
      return "You don't have permission to do that.";
    case "VF005":
      return "Consent records can't be edited or deleted. Void the entry and add a corrected one instead.";
    default:
      return error.message;
  }
}
```

```ts
// apps/admin/src/lib/image-resize.ts
export const CONTRIBUTOR_PHOTO_MAX_WIDTH = 512;

export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Browser only. Contributor photos are re-downloaded after every app
// launch (they're kept out of the phone's disk cache), so keep them small.
export async function resizeImage(
  file: File,
  maxWidth = CONTRIBUTOR_PHOTO_MAX_WIDTH,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const size = fitWithin(bitmap.width, bitmap.height, maxWidth);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare the image.");
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))),
      "image/jpeg",
      0.85,
    );
  });
}
```

Append to `apps/admin/src/lib/validation.ts`:

```ts
export const CONTRIBUTOR_TYPES = [
  "elder",
  "voice_artist",
  "writer",
  "tour_guide",
  "historian",
  "translator",
] as const;
export const CONSENT_TYPES = [
  "story_recording",
  "voice_cloning",
  "photo",
  "video",
  "translation",
  "archive",
] as const;
export const CONSENT_STATUSES = [
  "granted",
  "granted_with_conditions",
  "declined",
  "revoked",
] as const;

const optionalText = z.string().trim().optional();

export const contributorSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  displayName: z.string().trim().min(1, "Display name is required"),
  contributorType: z.enum(CONTRIBUTOR_TYPES),
  isAnonymous: z.boolean(),
  bio: optionalText,
  village: optionalText,
  district: optionalText,
  country: optionalText,
  approximateBirthYear: z.coerce.number().int().min(1850).max(2030).optional().or(z.literal("")),
  phone: optionalText,
  isDeceased: z.boolean(),
});
export type ContributorInput = z.infer<typeof contributorSchema>;

export const consentSchema = z
  .object({
    consentType: z.enum(CONSENT_TYPES),
    consentStatus: z.enum(["granted", "granted_with_conditions", "declined"]),
    conditions: optionalText,
    signedDate: optionalText,
    witnessName: optionalText,
    sessionFeeAmount: z.coerce.number().int().min(0).optional().or(z.literal("")),
    sessionFeeCurrency: optionalText,
    feePaidDate: optionalText,
    documentPath: optionalText,
  })
  .refine((value) => value.consentStatus === "declined" || Boolean(value.documentPath), {
    message: "Upload the signed agreement for a granted consent",
    path: ["documentPath"],
  });
export type ConsentInput = z.infer<typeof consentSchema>;

export const reasonSchema = z
  .string()
  .trim()
  .min(1, "A reason is required")
  .max(1000, "Keep the reason under 1000 characters");

export const sourceMaterialSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  author: optionalText,
  publicationYear: z.coerce.number().int().min(1).max(2100).optional().or(z.literal("")),
  publicDomainVerified: z.boolean(),
  verificationNotes: optionalText,
  sourceUrl: z.string().trim().url("Enter a full URL").optional().or(z.literal("")),
});
export type SourceMaterialInput = z.infer<typeof sourceMaterialSchema>;
```

Revocations aren't in `consentSchema`'s statuses: the add form records grants and declines; revoking has its own dialog with `reasonSchema`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter admin test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261004100600_admin_contributor_summaries.sql supabase/tests/080_admin_summaries.test.sql apps/admin/src/lib
git commit -m "Prompt 15A: shared admin pieces for contributors and consents"
```

### Task 17: Contributors list, create, edit, photo and delete

**Files:**

- Create: `apps/admin/src/lib/storage-cleanup.ts`
- Create: `apps/admin/src/app/(dashboard)/contributors/actions.ts`
- Create: `apps/admin/src/app/(dashboard)/contributors/contributor-form.tsx`
- Create: `apps/admin/src/app/(dashboard)/contributors/contributors-table.tsx`
- Create: `apps/admin/src/app/(dashboard)/contributors/photo-uploader.tsx`
- Create: `apps/admin/src/app/(dashboard)/contributors/photo-badge.tsx`
- Create: `apps/admin/src/app/(dashboard)/contributors/new/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/contributors/[id]/edit/page.tsx`
- Modify: `apps/admin/src/app/(dashboard)/contributors/page.tsx` (replace the placeholder)

**Interfaces:**

- Consumes: `contributorSchema`, `contributorAuditDetails`, `resizeImage`, `admin_contributor_summaries` (Task 16).
- Produces:
  - `removeStorageObjects(bucket: string, paths: string[], source: { entityType: string; entityId: string }): Promise<string[]>` (returns paths that failed; Task 24 adds queueing)
  - server actions `createContributor(input: ContributorInput): Promise<ActionResult & { id?: string }>`, `updateContributor(id: string, input: ContributorInput): Promise<ActionResult>`, `deleteContributor(id: string): Promise<ActionResult>`, `setContributorPhoto(id: string, photoPath: string): Promise<ActionResult>`
  - `PHOTO_STATUS_MESSAGES: Record<string, string>` and `<PhotoBadge status={…} />`

- [ ] **Step 1: Storage removal helper (first version)**

```ts
// apps/admin/src/lib/storage-cleanup.ts
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Removes storage objects after the row that pointed to them is gone or
// replaced. Returns the paths that could not be removed. Task 24 records
// those in storage_cleanup_queue; until then they are logged.
export async function removeStorageObjects(
  bucket: string,
  paths: string[],
  source: { entityType: string; entityId: string },
): Promise<string[]> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) {
    return [];
  }
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage.from(bucket).remove(unique);
  if (error) {
    console.error(
      `removeStorageObjects(${bucket}) failed for ${source.entityType} ${source.entityId}:`,
      error,
    );
    return unique;
  }
  return [];
}
```

- [ ] **Step 2: Server actions**

```ts
// apps/admin/src/app/(dashboard)/contributors/actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { contributorAuditDetails } from "@/lib/contributor-audit";
import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import { removeStorageObjects } from "@/lib/storage-cleanup";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { ContributorInput } from "@/lib/validation";

export type ActionResult = { ok: true } | { ok: false; message: string };

function toRow(input: ContributorInput) {
  return {
    full_name: input.fullName,
    display_name: input.displayName,
    contributor_type: input.contributorType,
    is_anonymous: input.isAnonymous,
    bio: input.bio || null,
    village: input.village || null,
    district: input.district || null,
    country: input.country || null,
    approximate_birth_year:
      input.approximateBirthYear === "" ? null : (input.approximateBirthYear ?? null),
    phone: input.phone || null,
    is_deceased: input.isDeceased,
  };
}

export async function createContributor(
  input: ContributorInput,
): Promise<ActionResult & { id?: string }> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = createServiceRoleClient();
  const row = toRow(input);
  const { data, error } = await supabase.from("contributors").insert(row).select("id").single();
  if (error) {
    return { ok: false, message: error.message };
  }
  await logAdminAction(
    admin.adminId,
    "create",
    "contributor",
    data.id,
    contributorAuditDetails(null, row),
  );
  revalidatePath("/contributors");
  return { ok: true, id: data.id };
}

export async function updateContributor(
  id: string,
  input: ContributorInput,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = createServiceRoleClient();
  const { data: before, error: loadError } = await supabase
    .from("contributors")
    .select(
      "full_name, display_name, contributor_type, is_anonymous, bio, village, district, country, approximate_birth_year, phone, is_deceased",
    )
    .eq("id", id)
    .single();
  if (loadError) {
    return { ok: false, message: loadError.message };
  }
  const row = toRow(input);
  const { error } = await supabase.from("contributors").update(row).eq("id", id);
  if (error) {
    // VF003 from the type-change trigger carries its own explanation.
    return { ok: false, message: error.message };
  }
  await logAdminAction(
    admin.adminId,
    "update",
    "contributor",
    id,
    contributorAuditDetails(before, row),
  );
  revalidatePath("/contributors");
  revalidatePath(`/contributors/${id}`);
  return { ok: true };
}

export async function deleteContributor(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = createServiceRoleClient();

  const { count: consentCount, error: consentError } = await supabase
    .from("consents")
    .select("id", { count: "exact", head: true })
    .eq("contributor_id", id);
  if (consentError) {
    return { ok: false, message: consentError.message };
  }
  if ((consentCount ?? 0) > 0) {
    return {
      ok: false,
      message: "This contributor has consent records, which are permanent. They can't be deleted.",
    };
  }

  const { count: linkCount, error: linkError } = await supabase
    .from("episode_contributors")
    .select("episode_id", { count: "exact", head: true })
    .eq("contributor_id", id);
  if (linkError) {
    return { ok: false, message: linkError.message };
  }
  if ((linkCount ?? 0) > 0) {
    return { ok: false, message: "Unlink this contributor from its episodes first." };
  }

  const { data: contributor, error: loadError } = await supabase
    .from("contributors")
    .select("photo_path")
    .eq("id", id)
    .single();
  if (loadError) {
    return { ok: false, message: loadError.message };
  }

  const { error } = await supabase.from("contributors").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }
  if (contributor.photo_path) {
    await removeStorageObjects("contributor-photos", [contributor.photo_path], {
      entityType: "contributor",
      entityId: id,
    });
  }
  await logAdminAction(admin.adminId, "delete", "contributor", id);
  revalidatePath("/contributors");
  return { ok: true };
}

export async function setContributorPhoto(id: string, photoPath: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  if (!photoPath.startsWith(`contributors/${id}/`)) {
    return { ok: false, message: "That photo doesn't belong to this contributor." };
  }
  const supabase = createServiceRoleClient();
  const { data: before, error: loadError } = await supabase
    .from("contributors")
    .select("photo_path")
    .eq("id", id)
    .single();
  if (loadError) {
    return { ok: false, message: loadError.message };
  }
  const { error } = await supabase
    .from("contributors")
    .update({ photo_path: photoPath })
    .eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }
  // New path saved first; only then remove the old file.
  if (before.photo_path && before.photo_path !== photoPath) {
    await removeStorageObjects("contributor-photos", [before.photo_path], {
      entityType: "contributor",
      entityId: id,
    });
  }
  await logAdminAction(admin.adminId, "update", "contributor", id, {
    changed_fields: ["photo_path"],
    values: {},
  });
  revalidatePath(`/contributors/${id}`);
  return { ok: true };
}
```

- [ ] **Step 3: Photo badge**

```tsx
// apps/admin/src/app/(dashboard)/contributors/photo-badge.tsx
export const PHOTO_STATUS_MESSAGES: Record<string, string> = {
  visible: "Shown in the app",
  anonymous: "Hidden from app: contributor is anonymous",
  no_photo: "No photo uploaded",
  no_consent: "Hidden from app: no photo consent recorded",
  consent_revoked: "Hidden from app: the photo consent was revoked",
  consent_declined: "Hidden from app: the photo consent was declined",
  conditions_unverified:
    "Hidden from app: consent was granted with conditions. The photo stays hidden until someone verifies the conditions and records a plain granted consent.",
};

export function PhotoBadge({ status }: { status: string | null }) {
  const key = status ?? "no_photo";
  const visible = key === "visible";
  return (
    <span className={`text-sm ${visible ? "text-green-700" : "text-gray-600"}`}>
      {PHOTO_STATUS_MESSAGES[key] ?? key}
    </span>
  );
}
```

- [ ] **Step 4: Contributor form**

```tsx
// apps/admin/src/app/(dashboard)/contributors/contributor-form.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/button";
import { Select } from "@/components/select";
import { Textarea } from "@/components/textarea";
import { TextInput } from "@/components/text-input";
import { Toggle } from "@/components/toggle";
import { CONTRIBUTOR_TYPES, type ContributorInput, contributorSchema } from "@/lib/validation";

import { createContributor, updateContributor } from "./actions";

export type ContributorRow = {
  id: string;
  full_name: string;
  display_name: string;
  contributor_type: (typeof CONTRIBUTOR_TYPES)[number];
  is_anonymous: boolean;
  bio: string | null;
  village: string | null;
  district: string | null;
  country: string | null;
  approximate_birth_year: number | null;
  phone: string | null;
  is_deceased: boolean;
};

export function ContributorForm({ contributor }: { contributor?: ContributorRow }) {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContributorInput>({
    resolver: zodResolver(contributorSchema),
    defaultValues: {
      fullName: contributor?.full_name ?? "",
      displayName: contributor?.display_name ?? "",
      contributorType: contributor?.contributor_type ?? "elder",
      isAnonymous: contributor?.is_anonymous ?? false,
      bio: contributor?.bio ?? "",
      village: contributor?.village ?? "",
      district: contributor?.district ?? "",
      country: contributor?.country ?? "",
      approximateBirthYear: contributor?.approximate_birth_year ?? "",
      phone: contributor?.phone ?? "",
      isDeceased: contributor?.is_deceased ?? false,
    },
  });

  const onSubmit = async (values: ContributorInput) => {
    setApiError(undefined);
    if (contributor) {
      const result = await updateContributor(contributor.id, values);
      if (!result.ok) {
        setApiError(result.message);
        return;
      }
      router.push(`/contributors/${contributor.id}`);
      return;
    }
    const result = await createContributor(values);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.push(`/contributors/${result.id}`);
  };

  const field = (label: string, name: keyof ContributorInput, input: React.ReactNode) => (
    <label className="flex flex-col gap-1">
      {label}
      {input}
      {errors[name] && <p className="text-sm text-red-600">{errors[name]?.message as string}</p>}
    </label>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-3">
      {field("Full name (admin only)", "fullName", <TextInput {...register("fullName")} />)}
      {field(
        "Display name (shown in the app)",
        "displayName",
        <TextInput {...register("displayName")} />,
      )}
      {field(
        "Type",
        "contributorType",
        <Select {...register("contributorType")}>
          {CONTRIBUTOR_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace("_", " ")}
            </option>
          ))}
        </Select>,
      )}
      <Toggle
        label="Anonymous (hide bio, location and photo in the app)"
        {...register("isAnonymous")}
      />
      {field("Bio", "bio", <Textarea rows={3} {...register("bio")} />)}
      {field("Village (admin only)", "village", <TextInput {...register("village")} />)}
      {field("District", "district", <TextInput {...register("district")} />)}
      {field("Country", "country", <TextInput {...register("country")} />)}
      {field(
        "Approximate birth year (admin only)",
        "approximateBirthYear",
        <TextInput inputMode="numeric" {...register("approximateBirthYear")} />,
      )}
      {field("Phone (admin only)", "phone", <TextInput {...register("phone")} />)}
      <Toggle label="Deceased" {...register("isDeceased")} />
      {apiError && <p className="text-sm text-red-600">{apiError}</p>}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Photo uploader (edit page only, since the path needs the contributor's id)**

```tsx
// apps/admin/src/app/(dashboard)/contributors/photo-uploader.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { resizeImage } from "@/lib/image-resize";
import { createClient } from "@/lib/supabase/client";

import { setContributorPhoto } from "./actions";

export function PhotoUploader({ contributorId }: { contributorId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(undefined);
    try {
      const blob = await resizeImage(file);
      const path = `contributors/${contributorId}/${crypto.randomUUID()}.jpg`;
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("contributor-photos")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }
      const result = await setContributorPhoto(contributorId, path);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="flex flex-col gap-1">
      Photo (resized to 512 px wide; shown in the app only with a granted photo consent)
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void handleFile(file);
          }
        }}
      />
      {busy && <span className="text-sm text-gray-500">Uploading…</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </label>
  );
}
```

- [ ] **Step 6: List table and pages**

```tsx
// apps/admin/src/app/(dashboard)/contributors/contributors-table.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DataTable } from "@/components/data-table";
import { Select } from "@/components/select";
import { CONTRIBUTOR_TYPES } from "@/lib/validation";

import { deleteContributor } from "./actions";
import { PhotoBadge } from "./photo-badge";

export type ContributorListRow = {
  id: string;
  display_name: string;
  full_name: string;
  contributor_type: string;
  is_anonymous: boolean;
  latest_story_recording: string | null;
  latest_photo: string | null;
  photo_status: string | null;
  episode_count: number;
};

export function ContributorsTable({ rows }: { rows: ContributorListRow[] }) {
  const router = useRouter();
  const [type, setType] = useState("");
  const [error, setError] = useState<string | undefined>();
  const filtered = type ? rows.filter((row) => row.contributor_type === type) : rows;

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this contributor? This cannot be undone.")) {
      return;
    }
    setError(undefined);
    const result = await deleteContributor(id);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <Select value={type} onChange={(e) => setType(e.target.value)} className="max-w-xs">
        <option value="">All types</option>
        {CONTRIBUTOR_TYPES.map((value) => (
          <option key={value} value={value}>
            {value.replace("_", " ")}
          </option>
        ))}
      </Select>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <DataTable
        rows={filtered}
        getRowKey={(row) => row.id}
        searchPlaceholder="Search by name…"
        filterRow={(row, query) =>
          row.display_name.toLowerCase().includes(query) ||
          row.full_name.toLowerCase().includes(query)
        }
        columns={[
          {
            header: "Name",
            cell: (row) => (
              <Link href={`/contributors/${row.id}`} className="hover:underline">
                {row.display_name}
                <span className="block text-sm text-gray-500">{row.full_name}</span>
              </Link>
            ),
          },
          { header: "Type", cell: (row) => row.contributor_type.replace("_", " ") },
          { header: "Anonymous", cell: (row) => (row.is_anonymous ? "Yes" : "") },
          { header: "Photo", cell: (row) => <PhotoBadge status={row.photo_status} /> },
          { header: "Story consent", cell: (row) => row.latest_story_recording ?? "none" },
          { header: "Photo consent", cell: (row) => row.latest_photo ?? "none" },
          { header: "Episodes", cell: (row) => row.episode_count },
          {
            header: "Actions",
            cell: (row) => (
              <button
                type="button"
                onClick={() => void handleDelete(row.id)}
                className="text-sm text-red-700 hover:underline"
              >
                Delete
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}
```

```tsx
// apps/admin/src/app/(dashboard)/contributors/page.tsx
import Link from "next/link";

import { Button } from "@/components/button";
import { createClient } from "@/lib/supabase/server";

import { type ContributorListRow, ContributorsTable } from "./contributors-table";

export default async function ContributorsPage() {
  const supabase = await createClient();
  const [contributorsResult, summariesResult] = await Promise.all([
    supabase
      .from("contributors")
      .select("id, display_name, full_name, contributor_type, is_anonymous")
      .order("display_name"),
    supabase.rpc("admin_contributor_summaries"),
  ]);
  if (contributorsResult.error || summariesResult.error) {
    return (
      <p className="text-red-600">
        Failed to load contributors: {(contributorsResult.error ?? summariesResult.error)?.message}
      </p>
    );
  }
  const summaries = new Map(
    (
      summariesResult.data as {
        contributor_id: string;
        latest_story_recording: string | null;
        latest_photo: string | null;
        photo_status: string | null;
        episode_count: number;
      }[]
    ).map((summary) => [summary.contributor_id, summary]),
  );
  const rows: ContributorListRow[] = contributorsResult.data.map((contributor) => {
    const summary = summaries.get(contributor.id);
    return {
      ...contributor,
      latest_story_recording: summary?.latest_story_recording ?? null,
      latest_photo: summary?.latest_photo ?? null,
      photo_status: summary?.photo_status ?? null,
      episode_count: Number(summary?.episode_count ?? 0),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Contributors</h1>
        <Link href="/contributors/new">
          <Button>New Contributor</Button>
        </Link>
      </div>
      <ContributorsTable rows={rows} />
    </div>
  );
}
```

```tsx
// apps/admin/src/app/(dashboard)/contributors/new/page.tsx
import { ContributorForm } from "../contributor-form";

export default function NewContributorPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New Contributor</h1>
      <p className="text-sm text-gray-600">You can add a photo after saving.</p>
      <ContributorForm />
    </div>
  );
}
```

```tsx
// apps/admin/src/app/(dashboard)/contributors/[id]/edit/page.tsx
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { ContributorForm, type ContributorRow } from "../../contributor-form";
import { PhotoUploader } from "../../photo-uploader";

export default async function EditContributorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contributors")
    .select(
      "id, full_name, display_name, contributor_type, is_anonymous, bio, village, district, country, approximate_birth_year, phone, is_deceased",
    )
    .eq("id", id)
    .single();
  if (error || !data) {
    notFound();
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Edit Contributor</h1>
      <ContributorForm contributor={data as ContributorRow} />
      <PhotoUploader contributorId={id} />
    </div>
  );
}
```

- [ ] **Step 7: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter admin build` (with the placeholder env vars from `ci.yml` if `.env.local` isn't present)
Expected: all pass; `/contributors`, `/contributors/new` and `/contributors/[id]/edit` appear in the build output.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/lib/storage-cleanup.ts apps/admin/src/app/\(dashboard\)/contributors
git commit -m "Prompt 15A: contributors list, create, edit, photo and delete"
```

### Task 18: Contributor detail page and consent history

**Files:**

- Create: `apps/admin/src/app/(dashboard)/contributors/[id]/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/contributors/[id]/consent-history.tsx`
- Create: `apps/admin/src/app/(dashboard)/contributors/load-consent-history.ts`

**Interfaces:**

- Consumes: `PhotoBadge` (Task 17), `contributor_photo_status` (Task 10).
- Produces: `type ConsentHistoryRow = { id: string; seq: number; consent_type: string; consent_status: string; conditions: string | null; signed_date: string | null; witness_name: string | null; session_fee_amount: number | null; session_fee_currency: string | null; fee_paid_date: string | null; document_url: string | null; reason: string | null; created_at: string; recorded_by_name: string | null; void: { reason: string; created_at: string; voided_by_name: string | null } | null }`; `loadConsentHistory(contributorId: string): Promise<{ ok: true; rows: ConsentHistoryRow[] } | { ok: false; message: string }>`; `<ConsentHistory rows={…} contributorId={…} actions={ReactNode slot per row} />`.

- [ ] **Step 1: Loader**

```ts
// apps/admin/src/app/(dashboard)/contributors/load-consent-history.ts
import { createClient } from "@/lib/supabase/server";

export type ConsentHistoryRow = {
  id: string;
  seq: number;
  consent_type: string;
  consent_status: string;
  conditions: string | null;
  signed_date: string | null;
  witness_name: string | null;
  session_fee_amount: number | null;
  session_fee_currency: string | null;
  fee_paid_date: string | null;
  document_url: string | null;
  reason: string | null;
  created_at: string;
  recorded_by_name: string | null;
  void: { reason: string; created_at: string; voided_by_name: string | null } | null;
};

type Row = Omit<ConsentHistoryRow, "recorded_by_name" | "void"> & {
  recorder: { display_name: string } | null;
  consent_voids: { reason: string; created_at: string; voider: { display_name: string } | null }[];
};

export async function loadConsentHistory(
  contributorId: string,
): Promise<{ ok: true; rows: ConsentHistoryRow[] } | { ok: false; message: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consents")
    .select(
      "id, seq, consent_type, consent_status, conditions, signed_date, witness_name, session_fee_amount, session_fee_currency, fee_paid_date, document_url, reason, created_at, recorder:profiles!consents_recorded_by_fkey(display_name), consent_voids(reason, created_at, voider:profiles!consent_voids_voided_by_fkey(display_name))",
    )
    .eq("contributor_id", contributorId)
    .order("seq", { ascending: true })
    .returns<Row[]>();
  if (error) {
    return { ok: false, message: error.message };
  }
  return {
    ok: true,
    rows: data.map(({ recorder, consent_voids, ...row }) => ({
      ...row,
      recorded_by_name: recorder?.display_name ?? null,
      void: consent_voids[0]
        ? {
            reason: consent_voids[0].reason,
            created_at: consent_voids[0].created_at,
            voided_by_name: consent_voids[0].voider?.display_name ?? null,
          }
        : null,
    })),
  };
}
```

If PostgREST reports an ambiguous or unknown relationship name, run `supabase db query --local "select conname from pg_constraint where conrelid in ('consents'::regclass, 'consent_voids'::regclass)"` and use the real foreign-key names.

- [ ] **Step 2: History component**

```tsx
// apps/admin/src/app/(dashboard)/contributors/[id]/consent-history.tsx
import type { ReactNode } from "react";

import type { ConsentHistoryRow } from "../load-consent-history";

const date = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "—");

export function ConsentHistory({
  rows,
  rowActions,
}: {
  rows: ConsentHistoryRow[];
  rowActions?: (row: ConsentHistoryRow) => ReactNode;
}) {
  if (rows.length === 0) {
    return <p className="text-gray-500">No consent recorded yet.</p>;
  }
  const byType = new Map<string, ConsentHistoryRow[]>();
  for (const row of rows) {
    byType.set(row.consent_type, [...(byType.get(row.consent_type) ?? []), row]);
  }
  return (
    <div className="flex flex-col gap-6">
      {[...byType.entries()].map(([type, typeRows]) => (
        <section key={type} className="flex flex-col gap-2">
          <h3 className="font-medium">{type.replace("_", " ")}</h3>
          <ol className="flex flex-col gap-2">
            {typeRows.map((row) => (
              <li key={row.id} className="rounded border border-gray-200 p-3">
                <div className={row.void ? "text-gray-400 line-through" : ""}>
                  <span className="font-medium">
                    #{row.seq} {row.consent_status.replaceAll("_", " ")}
                  </span>
                  <span className="ml-2 text-sm">
                    signed {date(row.signed_date)} · recorded {date(row.created_at)} by{" "}
                    {row.recorded_by_name ?? "unknown"}
                  </span>
                  {row.conditions && <p className="text-sm">Conditions: {row.conditions}</p>}
                  {row.witness_name && <p className="text-sm">Witness: {row.witness_name}</p>}
                  {row.session_fee_amount !== null && (
                    <p className="text-sm">
                      Fee: {row.session_fee_amount} {row.session_fee_currency ?? ""}, paid{" "}
                      {date(row.fee_paid_date)}
                    </p>
                  )}
                  {row.reason && <p className="text-sm">Reason: {row.reason}</p>}
                </div>
                {row.void && (
                  <p className="mt-1 text-sm text-gray-700">
                    Voided {date(row.void.created_at)} by {row.void.voided_by_name ?? "unknown"}:{" "}
                    {row.void.reason}
                  </p>
                )}
                {rowActions?.(row)}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Detail page**

```tsx
// apps/admin/src/app/(dashboard)/contributors/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { loadConsentHistory } from "../load-consent-history";
import { PhotoBadge } from "../photo-badge";
import { ConsentHistory } from "./consent-history";

export default async function ContributorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [contributorResult, statusResult, linksResult, history] = await Promise.all([
    supabase
      .from("contributors")
      .select(
        "id, display_name, full_name, contributor_type, is_anonymous, bio, district, country, photo_path",
      )
      .eq("id", id)
      .single(),
    supabase.rpc("contributor_photo_status", { p_contributor_id: id }),
    supabase
      .from("episode_contributors")
      .select("role, episodes(id, title, status, hidden_by_consent_at)")
      .eq("contributor_id", id),
    loadConsentHistory(id),
  ]);
  if (contributorResult.error || !contributorResult.data) {
    notFound();
  }
  const contributor = contributorResult.data;

  let photoUrl: string | null = null;
  if (contributor.photo_path) {
    const { data } = await supabase.storage
      .from("contributor-photos")
      .createSignedUrl(contributor.photo_path, 3600);
    photoUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{contributor.display_name}</h1>
        <Link href={`/contributors/${id}/edit`} className="hover:underline">
          Edit
        </Link>
      </div>

      <section className="flex gap-4">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img
            src={photoUrl}
            alt={contributor.display_name}
            className="h-32 w-32 rounded object-cover"
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded bg-gray-100 text-sm text-gray-500">
            No photo
          </div>
        )}
        <div className="flex flex-col gap-1">
          <p className="text-sm text-gray-600">
            {contributor.full_name} · {contributor.contributor_type.replace("_", " ")}
          </p>
          {contributor.is_anonymous && <p className="text-sm">Anonymous in the app</p>}
          <PhotoBadge status={statusResult.data as string | null} />
          {contributor.bio && <p>{contributor.bio}</p>}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Linked episodes</h2>
        {linksResult.error ? (
          <p className="text-red-600">Failed to load episodes: {linksResult.error.message}</p>
        ) : linksResult.data.length === 0 ? (
          <p className="text-gray-500">Not linked to any episode.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {linksResult.data.map((link) => {
              const episode = link.episodes as unknown as {
                id: string;
                title: string;
                status: string;
                hidden_by_consent_at: string | null;
              } | null;
              return episode ? (
                <li key={`${episode.id}-${link.role}`}>
                  <Link href={`/episodes/${episode.id}/edit`} className="hover:underline">
                    {episode.title}
                  </Link>{" "}
                  <span className="text-sm text-gray-600">
                    {link.role} · {episode.status}
                    {episode.hidden_by_consent_at && " · hidden because consent changed"}
                  </span>
                </li>
              ) : null;
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Consent history</h2>
        {history.ok ? (
          <ConsentHistory rows={history.rows} />
        ) : (
          <p className="text-red-600">{history.message}</p>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm --filter admin build`
Expected: pass; `/contributors/[id]` in the build output.

```bash
git add apps/admin/src/app/\(dashboard\)/contributors
git commit -m "Prompt 15A: contributor detail page with consent history"
```

### Task 19: Consent actions (add, revoke, void)

**Files:**

- Create: `apps/admin/src/app/(dashboard)/contributors/consent-actions.ts`
- Create: `apps/admin/src/app/(dashboard)/contributors/[id]/add-consent-form.tsx`
- Create: `apps/admin/src/app/(dashboard)/contributors/[id]/reason-dialog.tsx`
- Create: `apps/admin/src/app/(dashboard)/contributors/[id]/consent-row-actions.tsx`
- Modify: `apps/admin/src/app/(dashboard)/contributors/[id]/page.tsx`

**Interfaces:**

- Consumes: `record_consent`, `void_consent`, `preview_consent_change` (Task 8); `consentSchema`, `reasonSchema`, `dbErrorMessage` (Task 16); `ConsentHistoryRow` (Task 18).
- Produces: server actions `recordConsent(contributorId: string, input: ConsentInput): Promise<ConsentActionResult>`, `revokeConsent(contributorId: string, consentType: string, reason: string): Promise<ConsentActionResult>`, `voidConsent(consentId: string, reason: string): Promise<ConsentActionResult>`, `previewConsentChange(contributorId: string, consentType: string, consentStatus: string, voidConsentId?: string): Promise<{ ok: true; episodes: { id: string; title: string }[] } | { ok: false; message: string }>`; `type ConsentActionResult = { ok: true; hiddenEpisodeCount: number } | { ok: false; message: string }`; a file-private `sha256Hex(bytes: ArrayBuffer): Promise<string>` (Task 20 adds `openAgreement` to the same file and reuses it).

- [ ] **Step 1: Server actions**

```ts
// apps/admin/src/app/(dashboard)/contributors/consent-actions.ts
"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { dbErrorMessage } from "@/lib/db-errors";
import { requireAdmin } from "@/lib/require-admin";
import { createClient } from "@/lib/supabase/server";
import type { ConsentInput } from "@/lib/validation";

export type ConsentActionResult =
  { ok: true; hiddenEpisodeCount: number } | { ok: false; message: string };

// Not exported: anything exported from a "use server" file becomes a
// callable server action.
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function hiddenCount(result: unknown): number {
  const ids = (result as { hidden_episode_ids?: unknown[] } | null)?.hidden_episode_ids;
  return Array.isArray(ids) ? ids.length : 0;
}

// Every consent write goes through the database functions with the admin's
// own session, so the database records who did it and applies the hide in
// the same transaction.
export async function recordConsent(
  contributorId: string,
  input: ConsentInput,
): Promise<ConsentActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = await createClient();

  // Fingerprint computed here, from the stored file, never in the browser.
  let documentSha256: string | null = null;
  if (input.documentPath) {
    const { data: file, error: downloadError } = await supabase.storage
      .from("consent-documents")
      .download(input.documentPath);
    if (downloadError || !file) {
      return {
        ok: false,
        message: `Couldn't read the uploaded agreement: ${downloadError?.message ?? "missing"}`,
      };
    }
    documentSha256 = await sha256Hex(await file.arrayBuffer());
  }

  const { data, error } = await supabase.rpc("record_consent", {
    p_contributor_id: contributorId,
    p_consent_type: input.consentType,
    p_consent_status: input.consentStatus,
    p_conditions: input.conditions || null,
    p_signed_date: input.signedDate || null,
    p_document_path: input.documentPath || null,
    p_document_sha256: documentSha256,
    p_witness_name: input.witnessName || null,
    p_session_fee_amount: input.sessionFeeAmount === "" ? null : (input.sessionFeeAmount ?? null),
    p_session_fee_currency: input.sessionFeeCurrency || null,
    p_fee_paid_date: input.feePaidDate || null,
  });
  if (error) {
    return { ok: false, message: dbErrorMessage(error) };
  }
  revalidatePath(`/contributors/${contributorId}`);
  revalidatePath("/consents");
  return { ok: true, hiddenEpisodeCount: hiddenCount(data) };
}

export async function revokeConsent(
  contributorId: string,
  consentType: string,
  reason: string,
): Promise<ConsentActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_consent", {
    p_contributor_id: contributorId,
    p_consent_type: consentType,
    p_consent_status: "revoked",
    p_reason: reason,
  });
  if (error) {
    return { ok: false, message: dbErrorMessage(error) };
  }
  revalidatePath(`/contributors/${contributorId}`);
  revalidatePath("/consents");
  revalidatePath("/episodes");
  return { ok: true, hiddenEpisodeCount: hiddenCount(data) };
}

export async function voidConsent(consentId: string, reason: string): Promise<ConsentActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_consent", {
    p_consent_id: consentId,
    p_reason: reason,
  });
  if (error) {
    return { ok: false, message: dbErrorMessage(error) };
  }
  revalidatePath("/contributors", "layout");
  revalidatePath("/consents");
  revalidatePath("/episodes");
  return { ok: true, hiddenEpisodeCount: hiddenCount(data) };
}

export async function previewConsentChange(
  contributorId: string,
  consentType: string,
  consentStatus: string,
  voidConsentId?: string,
): Promise<
  { ok: true; episodes: { id: string; title: string }[] } | { ok: false; message: string }
> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = await createClient();
  const { data: ids, error } = await supabase.rpc("preview_consent_change", {
    p_contributor_id: contributorId,
    p_consent_type: consentType,
    p_consent_status: consentStatus,
    p_void_consent_id: voidConsentId ?? null,
  });
  if (error) {
    return { ok: false, message: dbErrorMessage(error) };
  }
  const episodeIds = (ids as string[] | null) ?? [];
  if (episodeIds.length === 0) {
    return { ok: true, episodes: [] };
  }
  const { data: episodes, error: loadError } = await supabase
    .from("episodes")
    .select("id, title")
    .in("id", episodeIds);
  if (loadError) {
    return { ok: false, message: loadError.message };
  }
  return { ok: true, episodes };
}
```

- [ ] **Step 2: Reason dialog (shared by revoke and void)**

```tsx
// apps/admin/src/app/(dashboard)/contributors/[id]/reason-dialog.tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { reasonSchema } from "@/lib/validation";

// Inline confirm step: loads the preview, requires a reason, shows the
// episodes that will be hidden, then runs the action.
export function ReasonDialog({
  title,
  confirmLabel,
  loadPreview,
  onConfirm,
  onClose,
}: {
  title: string;
  confirmLabel: string;
  loadPreview: () => Promise<
    { ok: true; episodes: { id: string; title: string }[] } | { ok: false; message: string }
  >;
  onConfirm: (
    reason: string,
  ) => Promise<{ ok: true; hiddenEpisodeCount: number } | { ok: false; message: string }>;
  onClose: (message?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [preview, setPreview] = useState<{ id: string; title: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const handlePreview = async () => {
    const result = await loadPreview();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPreview(result.episodes);
  };

  const handleConfirm = async () => {
    const parsed = reasonSchema.safeParse(reason);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await onConfirm(parsed.data);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onClose(
      result.hiddenEpisodeCount === 0
        ? "Saved. No episodes were affected."
        : `Saved. ${result.hiddenEpisodeCount} episode${result.hiddenEpisodeCount === 1 ? " was" : "s were"} hidden.`,
    );
  };

  return (
    <div className="mt-2 flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3">
      <p className="font-medium">{title}</p>
      {preview === null ? (
        <Button type="button" variant="secondary" onClick={() => void handlePreview()}>
          Show what this will change
        </Button>
      ) : preview.length === 0 ? (
        <p className="text-sm">No published episodes will be hidden.</p>
      ) : (
        <div className="text-sm">
          These published episodes will be hidden:
          <ul className="list-disc pl-5">
            {preview.map((episode) => (
              <li key={episode.id}>{episode.title}</li>
            ))}
          </ul>
        </div>
      )}
      <Textarea
        rows={3}
        maxLength={1000}
        placeholder="Reason (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="danger"
          disabled={busy || preview === null}
          onClick={() => void handleConfirm()}
        >
          {busy ? "Saving…" : confirmLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={() => onClose()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Row actions (revoke on the latest counted row of a type, void where allowed)**

```tsx
// apps/admin/src/app/(dashboard)/contributors/[id]/consent-row-actions.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { previewConsentChange, revokeConsent, voidConsent } from "../consent-actions";
import type { ConsentHistoryRow } from "../load-consent-history";
import { ReasonDialog } from "./reason-dialog";

// canRevoke/canVoid are computed by the page from the history (latest
// counted row per type, D6). The database enforces the same rules, so a
// wrong button would only produce a refusal, never a bad write.
export function ConsentRowActions({
  row,
  contributorId,
  canRevoke,
  canVoid,
}: {
  row: ConsentHistoryRow;
  contributorId: string;
  canRevoke: boolean;
  canVoid: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"revoke" | "void" | null>(null);
  const [notice, setNotice] = useState<string | undefined>();

  const close = (message?: string) => {
    setOpen(null);
    if (message) {
      setNotice(message);
      router.refresh();
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex gap-3 text-sm">
        {canRevoke && (
          <button
            type="button"
            className="text-red-700 hover:underline"
            onClick={() => setOpen("revoke")}
          >
            Revoke
          </button>
        )}
        {canVoid && (
          <button
            type="button"
            className="text-gray-700 hover:underline"
            onClick={() => setOpen("void")}
          >
            Void (entered in error)
          </button>
        )}
      </div>
      {notice && <p className="text-sm text-green-700">{notice}</p>}
      {open === "revoke" && (
        <ReasonDialog
          title={`Revoke ${row.consent_type.replace("_", " ")} consent`}
          confirmLabel="Revoke consent"
          loadPreview={() => previewConsentChange(contributorId, row.consent_type, "revoked")}
          onConfirm={(reason) => revokeConsent(contributorId, row.consent_type, reason)}
          onClose={close}
        />
      )}
      {open === "void" && (
        <ReasonDialog
          title={`Void entry #${row.seq}. It stays in the history, crossed out, and every check ignores it.`}
          confirmLabel="Void entry"
          loadPreview={() =>
            previewConsentChange(contributorId, row.consent_type, row.consent_status, row.id)
          }
          onConfirm={(reason) => voidConsent(row.id, reason)}
          onClose={close}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add-consent form**

```tsx
// apps/admin/src/app/(dashboard)/contributors/[id]/add-consent-form.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/button";
import { Select } from "@/components/select";
import { Textarea } from "@/components/textarea";
import { TextInput } from "@/components/text-input";
import { createClient } from "@/lib/supabase/client";
import { CONSENT_TYPES, type ConsentInput, consentSchema } from "@/lib/validation";

import { recordConsent } from "../consent-actions";

export function AddConsentForm({ contributorId }: { contributorId: string }) {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ConsentInput>({
    resolver: zodResolver(consentSchema),
    defaultValues: { consentType: "story_recording", consentStatus: "granted", documentPath: "" },
  });
  const consentType = watch("consentType");
  const consentStatus = watch("consentStatus");
  const documentPath = watch("documentPath");

  const handleUpload = async (file: File) => {
    setUploading(true);
    setApiError(undefined);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `consents/${contributorId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await createClient().storage.from("consent-documents").upload(path, file);
    setUploading(false);
    if (error) {
      setApiError(error.message);
      return;
    }
    // Kept if saving fails, so a retry reuses this upload instead of
    // leaving another permanent copy behind.
    setValue("documentPath", path, { shouldValidate: true });
  };

  const onSubmit = async (values: ConsentInput) => {
    setApiError(undefined);
    setNotice(undefined);
    const result = await recordConsent(contributorId, values);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    reset({ consentType: values.consentType, consentStatus: "granted", documentPath: "" });
    setNotice(
      result.hiddenEpisodeCount === 0
        ? "Consent recorded."
        : `Consent recorded. ${result.hiddenEpisodeCount} episode(s) were hidden.`,
    );
    router.refresh();
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex max-w-lg flex-col gap-3 rounded border border-gray-200 p-4"
    >
      <h3 className="font-medium">Add consent</h3>
      <label className="flex flex-col gap-1">
        Type
        <Select {...register("consentType")}>
          {CONSENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace("_", " ")}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        Status
        <Select {...register("consentStatus")}>
          <option value="granted">Granted</option>
          <option value="granted_with_conditions">Granted with conditions</option>
          <option value="declined">Declined</option>
        </Select>
      </label>
      {consentType === "photo" && consentStatus === "granted_with_conditions" && (
        <p className="rounded bg-amber-50 p-2 text-sm">
          This photo will stay hidden in the app until someone verifies these conditions and records
          a plain granted consent.
        </p>
      )}
      <label className="flex flex-col gap-1">
        Conditions
        <Textarea rows={2} {...register("conditions")} />
      </label>
      <label className="flex flex-col gap-1">
        Signed date
        <TextInput type="date" {...register("signedDate")} />
      </label>
      <label className="flex flex-col gap-1">
        Witness
        <TextInput {...register("witnessName")} />
      </label>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          Session fee
          <TextInput inputMode="numeric" {...register("sessionFeeAmount")} />
        </label>
        <label className="flex w-28 flex-col gap-1">
          Currency
          <TextInput placeholder="UGX" {...register("sessionFeeCurrency")} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        Fee paid date
        <TextInput type="date" {...register("feePaidDate")} />
      </label>
      <label className="flex flex-col gap-1">
        Signed agreement
        <span className="text-sm text-gray-600">
          Uploaded agreements can&apos;t be replaced or deleted.
        </span>
        <input
          type="file"
          accept="application/pdf,image/*"
          disabled={uploading || Boolean(documentPath)}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleUpload(file);
            }
          }}
        />
        {uploading && <span className="text-sm text-gray-500">Uploading…</span>}
        {documentPath && <span className="text-sm text-green-700">Agreement uploaded.</span>}
        {errors.documentPath && (
          <span className="text-sm text-red-600">{errors.documentPath.message}</span>
        )}
      </label>
      {apiError && <p className="text-sm text-red-600">{apiError}</p>}
      {notice && <p className="text-sm text-green-700">{notice}</p>}
      <Button type="submit" disabled={isSubmitting || uploading}>
        {isSubmitting ? "Saving…" : "Record consent"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Wire into the detail page**

In `contributors/[id]/page.tsx`, import `AddConsentForm` and `ConsentRowActions`, and replace the consent-history section with:

```tsx
<section className="flex flex-col gap-2">
  <h2 className="font-semibold">Consent history</h2>
  {history.ok ? (
    <ConsentHistory
      rows={history.rows}
      rowActions={(row) => {
        const counted = history.rows.filter((r) => r.consent_type === row.consent_type && !r.void);
        const latest = counted[counted.length - 1];
        const isLatest = latest?.id === row.id;
        const canRevoke =
          isLatest &&
          (row.consent_status === "granted" || row.consent_status === "granted_with_conditions");
        const withoutRow = counted.filter((r) => r.id !== row.id);
        const afterVoid = withoutRow[withoutRow.length - 1]?.consent_status;
        const canVoid =
          !row.void &&
          row.consent_status !== "revoked" &&
          !(
            row.consent_status === "declined" &&
            (afterVoid === "granted" || afterVoid === "granted_with_conditions")
          );
        return canRevoke || canVoid ? (
          <ConsentRowActions row={row} contributorId={id} canRevoke={canRevoke} canVoid={canVoid} />
        ) : null;
      }}
    />
  ) : (
    <p className="text-red-600">{history.message}</p>
  )}
  <AddConsentForm contributorId={id} />
</section>
```

`history.rows` is in `seq` order, so the last counted row of a type is the latest.

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm --filter admin build`
Expected: pass.

```bash
git add apps/admin/src/app/\(dashboard\)/contributors
git commit -m "Prompt 15A: add, revoke and void consent from the contributor page"
```

### Task 20: Agreement verification on open

**Files:**

- Create: `apps/admin/src/lib/agreement-verification.ts`
- Create: `apps/admin/src/lib/agreement-verification.test.ts`
- Create: `apps/admin/src/app/(dashboard)/contributors/[id]/agreement-link.tsx`
- Modify: `apps/admin/src/app/(dashboard)/contributors/consent-actions.ts` (add `openAgreement`)
- Modify: `apps/admin/src/app/(dashboard)/contributors/[id]/consent-history.tsx` (render `AgreementLink`)
- Create: `packages/db-integration-tests/src/agreement-fingerprint.test.ts`

**Interfaces:**

- Consumes: `consent_document_state` (Task 10), the file-private `sha256Hex` in `consent-actions.ts` (Task 19).
- Produces: `type AgreementVerdict = "verified" | "changed" | "missing"`; `verifyAgreement(state: { present: boolean; current_etag: string | null; current_size_bytes: number | null; recorded_etag: string | null; recorded_size_bytes: number | null; recorded_sha256: string | null }, downloadedSha256: string | null): AgreementVerdict`; server action `openAgreement(consentId: string): Promise<{ ok: true; verdict: AgreementVerdict; url: string | null } | { ok: false; message: string }>`.

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/admin/src/lib/agreement-verification.test.ts
import { describe, expect, it } from "vitest";

import { verifyAgreement } from "./agreement-verification";

const recorded = {
  present: true,
  current_etag: '"e1"',
  current_size_bytes: 100,
  recorded_etag: '"e1"',
  recorded_size_bytes: 100,
  recorded_sha256: "a".repeat(64),
};

describe("verifyAgreement", () => {
  it("is verified when the file, the storage snapshot and the SHA-256 all match", () => {
    expect(verifyAgreement(recorded, "a".repeat(64))).toBe("verified");
  });

  it("is missing when the file is gone", () => {
    expect(
      verifyAgreement(
        { ...recorded, present: false, current_etag: null, current_size_bytes: null },
        null,
      ),
    ).toBe("missing");
  });

  it("is changed when the SHA-256 differs", () => {
    expect(verifyAgreement(recorded, "b".repeat(64))).toBe("changed");
  });

  it("is changed when storage's own checksum differs, even if a SHA-256 was forged to match", () => {
    expect(verifyAgreement({ ...recorded, current_etag: '"e2"' }, "a".repeat(64))).toBe("changed");
  });

  it("is changed when the size differs", () => {
    expect(verifyAgreement({ ...recorded, current_size_bytes: 101 }, "a".repeat(64))).toBe(
      "changed",
    );
  });
});
```

Run: `pnpm --filter admin test -- agreement-verification`
Expected: FAIL.

- [ ] **Step 2: Implement**

```ts
// apps/admin/src/lib/agreement-verification.ts
export type AgreementVerdict = "verified" | "changed" | "missing";

// Compares the stored file now with what was recorded: storage's own
// checksum and size (written by Supabase, unforgeable by the caller) and
// the SHA-256 the server computed at upload time.
export function verifyAgreement(
  state: {
    present: boolean;
    current_etag: string | null;
    current_size_bytes: number | null;
    recorded_etag: string | null;
    recorded_size_bytes: number | null;
    recorded_sha256: string | null;
  },
  downloadedSha256: string | null,
): AgreementVerdict {
  if (!state.present) {
    return "missing";
  }
  if (state.recorded_etag !== null && state.current_etag !== state.recorded_etag) {
    return "changed";
  }
  if (
    state.recorded_size_bytes !== null &&
    Number(state.current_size_bytes) !== Number(state.recorded_size_bytes)
  ) {
    return "changed";
  }
  if (state.recorded_sha256 !== null && downloadedSha256 !== state.recorded_sha256) {
    return "changed";
  }
  return "verified";
}
```

Run: `pnpm --filter admin test -- agreement-verification`
Expected: 5 pass.

- [ ] **Step 3: Server action and link**

Append to `contributors/consent-actions.ts`:

```ts
import { type AgreementVerdict, verifyAgreement } from "@/lib/agreement-verification";

export async function openAgreement(
  consentId: string,
): Promise<
  { ok: true; verdict: AgreementVerdict; url: string | null } | { ok: false; message: string }
> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consent_document_state", { p_consent_id: consentId });
  if (error) {
    return { ok: false, message: dbErrorMessage(error) };
  }
  const state = (
    data as (Parameters<typeof verifyAgreement>[0] & { document_path: string | null })[]
  )[0];
  if (!state?.document_path) {
    return { ok: false, message: "No agreement was recorded for this consent." };
  }
  if (!state.present) {
    return { ok: true, verdict: "missing", url: null };
  }
  const { data: file, error: downloadError } = await supabase.storage
    .from("consent-documents")
    .download(state.document_path);
  const downloadedSha256 =
    downloadError || !file ? null : await sha256Hex(await file.arrayBuffer());
  const verdict = verifyAgreement(state, downloadedSha256);
  const { data: signed } = await supabase.storage
    .from("consent-documents")
    .createSignedUrl(state.document_path, 300);
  return { ok: true, verdict, url: signed?.signedUrl ?? null };
}
```

(Move the `import` to the top of the file with the others.)

```tsx
// apps/admin/src/app/(dashboard)/contributors/[id]/agreement-link.tsx
"use client";

import { useState } from "react";

import type { AgreementVerdict } from "@/lib/agreement-verification";

import { openAgreement } from "../consent-actions";

const VERDICT_TEXT: Record<AgreementVerdict, string> = {
  verified: "Verified",
  changed: "File has changed since it was recorded",
  missing: "File missing",
};

export function AgreementLink({ consentId }: { consentId: string }) {
  const [verdict, setVerdict] = useState<AgreementVerdict | null>(null);
  const [error, setError] = useState<string | undefined>();

  const handleOpen = async () => {
    setError(undefined);
    const result = await openAgreement(consentId);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setVerdict(result.verdict);
    if (result.url) {
      window.open(result.url, "_blank", "noopener");
    }
  };

  return (
    <span className="text-sm">
      <button type="button" className="hover:underline" onClick={() => void handleOpen()}>
        Open signed agreement
      </button>
      {verdict && (
        <span
          className={
            verdict === "verified" ? "ml-2 text-green-700" : "ml-2 font-medium text-red-700"
          }
        >
          {VERDICT_TEXT[verdict]}
        </span>
      )}
      {error && <span className="ml-2 text-red-600">{error}</span>}
    </span>
  );
}
```

In `consent-history.tsx`, import `AgreementLink` and render `{row.document_url && <AgreementLink consentId={row.id} />}` after the reason line.

- [ ] **Step 4: Integration test for the database side of fingerprints**

```ts
// packages/db-integration-tests/src/agreement-fingerprint.test.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { beginAs, connect, createUser, LOCAL_API_URL, localKeys } from "./local-stack";

type State = {
  present: boolean;
  current_etag: string | null;
  recorded_etag: string | null;
  current_size_bytes: string | null;
  recorded_size_bytes: string | null;
};

describe("signed agreement fingerprints", () => {
  let db: pg.Client;
  let service: SupabaseClient;
  let adminId: string;
  let consentId: string;
  const path = `consents/fingerprint/${crypto.randomUUID()}.pdf`;

  async function state(): Promise<State> {
    await beginAs(db, adminId);
    const { rows } = await db.query<State>("select * from consent_document_state($1)", [consentId]);
    await db.query("commit");
    return rows[0];
  }

  beforeAll(async () => {
    db = await connect();
    service = createClient(LOCAL_API_URL, localKeys().serviceRoleKey);
    adminId = await createUser(db, "admin");
    const { rows } = await db.query<{ id: string }>(
      "insert into contributors (full_name, display_name, contributor_type) values ('F', 'F', 'elder') returning id",
    );
    const { error } = await service.storage
      .from("consent-documents")
      .upload(path, new Blob(["original agreement"]));
    if (error) {
      throw error;
    }
    await beginAs(db, adminId);
    const { rows: result } = await db.query<{ r: { consent_id: string } }>(
      "select record_consent($1, 'story_recording', 'granted', p_document_path => $2, p_document_sha256 => $3) as r",
      [rows[0].id, path, "0".repeat(64)],
    );
    await db.query("commit");
    consentId = result[0].r.consent_id;
  });

  afterAll(async () => {
    await db.end();
  });

  it("records the storage checksum and size at record time", async () => {
    const s = await state();
    expect(s.present).toBe(true);
    expect(s.recorded_etag).toBeTruthy();
    expect(s.current_etag).toBe(s.recorded_etag);
    expect(s.current_size_bytes).toBe(s.recorded_size_bytes);
  });

  it("detects a file changed with the full-access key", async () => {
    const { error } = await service.storage
      .from("consent-documents")
      .upload(path, new Blob(["tampered agreement, longer"]), { upsert: true });
    expect(error).toBeNull();
    const s = await state();
    expect(s.current_etag).not.toBe(s.recorded_etag);
  });

  it("detects a missing file", async () => {
    const { error } = await service.storage.from("consent-documents").remove([path]);
    expect(error).toBeNull();
    expect((await state()).present).toBe(false);
  });
});
```

Run: `pnpm test:integration -- agreement-fingerprint`
Expected: 3 pass. (Admins can't overwrite or delete agreements; the test uses the service role on purpose, standing in for "changes outside the app".)

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter admin test && pnpm typecheck && pnpm lint`

```bash
git add apps/admin/src packages/db-integration-tests/src/agreement-fingerprint.test.ts
git commit -m "Prompt 15A: verify signed agreements when opened"
```

### Task 21: Consents list page

**Files:**

- Create: `apps/admin/src/lib/latest-per-contributor.ts`
- Create: `apps/admin/src/lib/latest-per-contributor.test.ts`
- Modify: `apps/admin/src/app/(dashboard)/consents/page.tsx` (replace the placeholder)
- Create: `apps/admin/src/app/(dashboard)/consents/consent-filters.tsx`

**Interfaces:**

- Produces: `latestPerContributor<T extends { contributor_id: string; consent_type: string; seq: number; voided: boolean }>(rows: T[]): T[]` (highest-`seq` non-voided row per contributor and type; display filter only).

- [ ] **Step 1: Failing test, then implementation**

```ts
// apps/admin/src/lib/latest-per-contributor.test.ts
import { describe, expect, it } from "vitest";

import { latestPerContributor } from "./latest-per-contributor";

const row = (contributor_id: string, consent_type: string, seq: number, voided = false) => ({
  contributor_id,
  consent_type,
  seq,
  voided,
});

describe("latestPerContributor", () => {
  it("keeps the highest-seq non-voided row per contributor and type", () => {
    const rows = [
      row("a", "photo", 1),
      row("a", "photo", 2),
      row("a", "story_recording", 3),
      row("b", "photo", 4, true),
      row("b", "photo", 5),
    ];
    expect(
      latestPerContributor(rows)
        .map((r) => r.seq)
        .sort(),
    ).toEqual([2, 3, 5]);
  });

  it("skips voided rows even when they are newest", () => {
    expect(
      latestPerContributor([row("a", "photo", 1), row("a", "photo", 2, true)]).map((r) => r.seq),
    ).toEqual([1]);
  });
});
```

```ts
// apps/admin/src/lib/latest-per-contributor.ts
// Display filter for /consents only. Every rule that matters (checks,
// photos, publishing) uses SQL's latest_counted_consent(); this mirrors
// its definition (highest seq, voided rows ignored) for the list view.
export function latestPerContributor<
  T extends { contributor_id: string; consent_type: string; seq: number; voided: boolean },
>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (row.voided) {
      continue;
    }
    const key = `${row.contributor_id}\u0000${row.consent_type}`;
    const current = latest.get(key);
    if (!current || row.seq > current.seq) {
      latest.set(key, row);
    }
  }
  return [...latest.values()];
}
```

Run: `pnpm --filter admin test -- latest-per-contributor`
Expected: 2 pass.

- [ ] **Step 2: Filters (client, writes search params)**

```tsx
// apps/admin/src/app/(dashboard)/consents/consent-filters.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select } from "@/components/select";
import { Toggle } from "@/components/toggle";
import { CONSENT_STATUSES, CONSENT_TYPES } from "@/lib/validation";

export function ConsentFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={params.get("type") ?? ""} onChange={(e) => set("type", e.target.value)}>
        <option value="">All types</option>
        {CONSENT_TYPES.map((type) => (
          <option key={type} value={type}>
            {type.replace("_", " ")}
          </option>
        ))}
      </Select>
      <Select value={params.get("status") ?? ""} onChange={(e) => set("status", e.target.value)}>
        <option value="">All statuses</option>
        {CONSENT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status.replaceAll("_", " ")}
          </option>
        ))}
      </Select>
      <Toggle
        label="Latest per contributor only"
        checked={params.get("latest") === "1"}
        onChange={(e) => set("latest", e.target.checked ? "1" : "")}
      />
    </div>
  );
}
```

- [ ] **Step 3: Page (full history by default)**

```tsx
// apps/admin/src/app/(dashboard)/consents/page.tsx
import Link from "next/link";

import { latestPerContributor } from "@/lib/latest-per-contributor";
import { createClient } from "@/lib/supabase/server";

import { ConsentFilters } from "./consent-filters";

type Row = {
  id: string;
  seq: number;
  contributor_id: string;
  consent_type: string;
  consent_status: string;
  reason: string | null;
  signed_date: string | null;
  created_at: string;
  contributors: { display_name: string } | null;
  consent_voids: { reason: string; created_at: string }[];
};

export default async function ConsentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; latest?: string }>;
}) {
  const { type, status, latest } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("consents")
    .select(
      "id, seq, contributor_id, consent_type, consent_status, reason, signed_date, created_at, contributors(display_name), consent_voids(reason, created_at)",
    )
    .order("seq", { ascending: false });
  if (type) {
    query = query.eq("consent_type", type);
  }
  const { data, error } = await query.returns<Row[]>();
  if (error) {
    return <p className="text-red-600">Failed to load consents: {error.message}</p>;
  }

  let rows = data.map((row) => ({ ...row, voided: row.consent_voids.length > 0 }));
  // "Latest" is computed before the status filter, so "latest = revoked"
  // means the current state is revoked, not "the latest revoked row".
  if (latest === "1") {
    rows = latestPerContributor(rows).sort((a, b) => b.seq - a.seq);
  }
  if (status) {
    rows = rows.filter((row) => row.consent_status === status);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Consents</h1>
      <p className="text-sm text-gray-600">
        Full history by default, including voided and superseded entries. Consent records can&apos;t
        be edited or deleted.
      </p>
      <ConsentFilters />
      {rows.length === 0 ? (
        <p className="text-gray-500">No consents match.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b">
              <th className="py-2">#</th>
              <th className="py-2">Contributor</th>
              <th className="py-2">Type</th>
              <th className="py-2">Status</th>
              <th className="py-2">Signed</th>
              <th className="py-2">Reason / void</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const voidEntry = row.consent_voids[0];
              const note = voidEntry ? `Voided: ${voidEntry.reason}` : row.reason;
              return (
                <tr key={row.id} className={`border-b ${row.voided ? "text-gray-400" : ""}`}>
                  <td className="py-2">{row.seq}</td>
                  <td className="py-2">
                    <Link href={`/contributors/${row.contributor_id}`} className="hover:underline">
                      {row.contributors?.display_name ?? row.contributor_id}
                    </Link>
                  </td>
                  <td className="py-2">{row.consent_type.replace("_", " ")}</td>
                  <td className={`py-2 ${row.voided ? "line-through" : ""}`}>
                    {row.consent_status.replaceAll("_", " ")}
                  </td>
                  <td className="py-2">{row.signed_date ?? "—"}</td>
                  <td className="py-2 text-sm">
                    {note && (
                      <details>
                        <summary className="cursor-pointer">
                          {note.length > 80 ? `${note.slice(0, 80)}…` : note}
                        </summary>
                        {note}
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter admin test && pnpm typecheck && pnpm lint && pnpm --filter admin build`

```bash
git add apps/admin/src/lib/latest-per-contributor.ts apps/admin/src/lib/latest-per-contributor.test.ts apps/admin/src/app/\(dashboard\)/consents
git commit -m "Prompt 15A: consents list with full history by default"
```

### Task 22: Source materials

**Files:**

- Create: `apps/admin/src/app/(dashboard)/source-materials/actions.ts`
- Create: `apps/admin/src/app/(dashboard)/source-materials/source-material-form.tsx`
- Create: `apps/admin/src/app/(dashboard)/source-materials/source-materials-table.tsx`
- Create: `apps/admin/src/app/(dashboard)/source-materials/new/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/source-materials/[id]/edit/page.tsx`
- Modify: `apps/admin/src/app/(dashboard)/source-materials/page.tsx` (replace the placeholder)
- Modify: `apps/admin/src/app/(dashboard)/episodes/episode-form.tsx` (dropdown labels)

**Interfaces:**

- Consumes: `sourceMaterialSchema` (Task 16).
- Produces: server actions `createSourceMaterial(input)`, `updateSourceMaterial(id, input)`, `deleteSourceMaterial(id)`, all `Promise<ActionResult>`.

- [ ] **Step 1: Server actions**

```ts
// apps/admin/src/app/(dashboard)/source-materials/actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SourceMaterialInput } from "@/lib/validation";

export type ActionResult = { ok: true } | { ok: false; message: string };

function toRow(input: SourceMaterialInput) {
  return {
    title: input.title,
    author: input.author || null,
    publication_year: input.publicationYear === "" ? null : (input.publicationYear ?? null),
    public_domain_verified: input.publicDomainVerified,
    verification_notes: input.verificationNotes || null,
    source_url: input.sourceUrl || null,
  };
}

export async function createSourceMaterial(input: SourceMaterialInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("source_materials")
    .insert(toRow(input))
    .select("id")
    .single();
  if (error) {
    return { ok: false, message: error.message };
  }
  await logAdminAction(admin.adminId, "create", "source_material", data.id, {
    title: input.title,
    public_domain_verified: input.publicDomainVerified,
  });
  revalidatePath("/source-materials");
  return { ok: true };
}

export async function updateSourceMaterial(
  id: string,
  input: SourceMaterialInput,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("source_materials").update(toRow(input)).eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }
  await logAdminAction(admin.adminId, "update", "source_material", id, {
    title: input.title,
    public_domain_verified: input.publicDomainVerified,
  });
  revalidatePath("/source-materials");
  return { ok: true };
}

export async function deleteSourceMaterial(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("source_materials").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }
  await logAdminAction(admin.adminId, "delete", "source_material", id);
  revalidatePath("/source-materials");
  return { ok: true };
}
```

- [ ] **Step 2: Form, table and pages**

```tsx
// apps/admin/src/app/(dashboard)/source-materials/source-material-form.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { TextInput } from "@/components/text-input";
import { Toggle } from "@/components/toggle";
import { type SourceMaterialInput, sourceMaterialSchema } from "@/lib/validation";

import { createSourceMaterial, updateSourceMaterial } from "./actions";

export type SourceMaterialRow = {
  id: string;
  title: string;
  author: string | null;
  publication_year: number | null;
  public_domain_verified: boolean;
  verification_notes: string | null;
  source_url: string | null;
};

export function SourceMaterialForm({ sourceMaterial }: { sourceMaterial?: SourceMaterialRow }) {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SourceMaterialInput>({
    resolver: zodResolver(sourceMaterialSchema),
    defaultValues: {
      title: sourceMaterial?.title ?? "",
      author: sourceMaterial?.author ?? "",
      publicationYear: sourceMaterial?.publication_year ?? "",
      publicDomainVerified: sourceMaterial?.public_domain_verified ?? false,
      verificationNotes: sourceMaterial?.verification_notes ?? "",
      sourceUrl: sourceMaterial?.source_url ?? "",
    },
  });

  const onSubmit = async (values: SourceMaterialInput) => {
    setApiError(undefined);
    const result = sourceMaterial
      ? await updateSourceMaterial(sourceMaterial.id, values)
      : await createSourceMaterial(values);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.push("/source-materials");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-3">
      <label className="flex flex-col gap-1">
        Title
        <TextInput {...register("title")} />
        {errors.title && <p className="text-sm text-red-600">{errors.title.message}</p>}
      </label>
      <label className="flex flex-col gap-1">
        Author
        <TextInput {...register("author")} />
      </label>
      <label className="flex flex-col gap-1">
        Publication year
        <TextInput inputMode="numeric" {...register("publicationYear")} />
        {errors.publicationYear && (
          <p className="text-sm text-red-600">{errors.publicationYear.message}</p>
        )}
      </label>
      <Toggle label="Verified as public domain" {...register("publicDomainVerified")} />
      <label className="flex flex-col gap-1">
        Verification notes
        <Textarea rows={3} {...register("verificationNotes")} />
      </label>
      <label className="flex flex-col gap-1">
        Source URL
        <TextInput {...register("sourceUrl")} />
        {errors.sourceUrl && <p className="text-sm text-red-600">{errors.sourceUrl.message}</p>}
      </label>
      {apiError && <p className="text-sm text-red-600">{apiError}</p>}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
```

```tsx
// apps/admin/src/app/(dashboard)/source-materials/source-materials-table.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable } from "@/components/data-table";

import { deleteSourceMaterial } from "./actions";

export type SourceMaterialListRow = {
  id: string;
  title: string;
  author: string | null;
  public_domain_verified: boolean;
  episode_count: number;
};

export function SourceMaterialsTable({ rows }: { rows: SourceMaterialListRow[] }) {
  const router = useRouter();

  const handleDelete = async (row: SourceMaterialListRow) => {
    const warning =
      row.episode_count > 0
        ? `${row.episode_count} episode(s) link to this source; their link will be cleared. Delete anyway?`
        : "Delete this source material?";
    if (!confirm(warning)) {
      return;
    }
    await deleteSourceMaterial(row.id);
    router.refresh();
  };

  return (
    <DataTable
      rows={rows}
      getRowKey={(row) => row.id}
      searchPlaceholder="Search by title or author…"
      filterRow={(row, query) =>
        row.title.toLowerCase().includes(query) || (row.author ?? "").toLowerCase().includes(query)
      }
      columns={[
        { header: "Title", cell: (row) => row.title },
        { header: "Author", cell: (row) => row.author ?? "" },
        {
          header: "Public domain",
          cell: (row) =>
            row.public_domain_verified ? (
              <span className="text-green-700">Verified</span>
            ) : (
              <span className="text-amber-700">Unverified</span>
            ),
        },
        { header: "Episodes", cell: (row) => row.episode_count },
        {
          header: "Actions",
          cell: (row) => (
            <span className="flex gap-3 text-sm">
              <Link href={`/source-materials/${row.id}/edit`} className="hover:underline">
                Edit
              </Link>
              <button
                type="button"
                className="text-red-700 hover:underline"
                onClick={() => void handleDelete(row)}
              >
                Delete
              </button>
            </span>
          ),
        },
      ]}
    />
  );
}
```

```tsx
// apps/admin/src/app/(dashboard)/source-materials/page.tsx
import Link from "next/link";

import { Button } from "@/components/button";
import { createClient } from "@/lib/supabase/server";

import { type SourceMaterialListRow, SourceMaterialsTable } from "./source-materials-table";

export default async function SourceMaterialsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("source_materials")
    .select("id, title, author, public_domain_verified, episodes(count)")
    .order("title");
  if (error) {
    return <p className="text-red-600">Failed to load source materials: {error.message}</p>;
  }
  const rows: SourceMaterialListRow[] = data.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    public_domain_verified: row.public_domain_verified,
    episode_count: (row.episodes as unknown as { count: number }[])[0]?.count ?? 0,
  }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Source Materials</h1>
        <Link href="/source-materials/new">
          <Button>New Source Material</Button>
        </Link>
      </div>
      <SourceMaterialsTable rows={rows} />
    </div>
  );
}
```

```tsx
// apps/admin/src/app/(dashboard)/source-materials/new/page.tsx
import { SourceMaterialForm } from "../source-material-form";

export default function NewSourceMaterialPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New Source Material</h1>
      <SourceMaterialForm />
    </div>
  );
}
```

```tsx
// apps/admin/src/app/(dashboard)/source-materials/[id]/edit/page.tsx
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { SourceMaterialForm, type SourceMaterialRow } from "../../source-material-form";

export default async function EditSourceMaterialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("source_materials")
    .select(
      "id, title, author, publication_year, public_domain_verified, verification_notes, source_url",
    )
    .eq("id", id)
    .single();
  if (error || !data) {
    notFound();
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Edit Source Material</h1>
      <SourceMaterialForm sourceMaterial={data as SourceMaterialRow} />
    </div>
  );
}
```

- [ ] **Step 3: Mark unverified sources in the episode form**

In `episodes/episode-form.tsx`, in the `sourceMaterialOptions.map((sm) => …)` at about line 250, change the option label to:

```tsx
{
  sm.title;
}
{
  sm.public_domain_verified ? "" : " (unverified)";
}
```

The existing warning below the select (line 256) and the publish-time acknowledgement (Task 9) stay as they are.

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm --filter admin build`

```bash
git add apps/admin/src/app/\(dashboard\)/source-materials apps/admin/src/app/\(dashboard\)/episodes/episode-form.tsx
git commit -m "Prompt 15A: source materials and unverified-source marking"
```

### Task 23: "Hidden because consent changed" banner

**Files:**

- Create: `apps/admin/src/app/(dashboard)/episodes/consent-hidden-banner.tsx`
- Modify: `apps/admin/src/app/(dashboard)/episodes/[id]/edit/page.tsx`
- Modify: `apps/admin/src/app/(dashboard)/episodes/page.tsx` and `episode-table.tsx`

**Interfaces:**

- Consumes: `hidden_by_consent_at`, `hidden_by_consent_action_id` (Task 8), `episode_publish_check` (Task 7), `PublishCheck` (Task 9).

- [ ] **Step 1: Banner (server component)**

```tsx
// apps/admin/src/app/(dashboard)/episodes/consent-hidden-banner.tsx
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

import type { PublishCheck } from "./publish-actions";

// Shown only when the episode is in review AND was hidden by a consent
// change. Episodes in review for other reasons don't get this banner.
export async function ConsentHiddenBanner({
  episodeId,
  hiddenAt,
  actionId,
}: {
  episodeId: string;
  hiddenAt: string;
  actionId: string | null;
}) {
  const supabase = await createClient();
  const [checksResult, actionResult] = await Promise.all([
    supabase.rpc("episode_publish_check", { p_episode_id: episodeId }),
    actionId
      ? supabase.from("admin_actions").select("details").eq("id", actionId).single()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const contributorId = (actionResult.data?.details as { contributor_id?: string } | null)
    ?.contributor_id;
  const checks = (checksResult.data ?? []) as PublishCheck[];

  return (
    <div className="flex flex-col gap-2 rounded border border-red-300 bg-red-50 p-4">
      <p className="font-medium">Hidden because consent changed</p>
      <p className="text-sm">
        Hidden on {new Date(hiddenAt).toLocaleString()}.{" "}
        {contributorId && (
          <Link href={`/contributors/${contributorId}`} className="underline">
            View the contributor&apos;s consent history
          </Link>
        )}
      </p>
      {checksResult.error ? (
        <p className="text-sm text-red-600">
          Couldn&apos;t load the checklist: {checksResult.error.message}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {checks.map((check) => (
            <li
              key={check.key}
              className={
                check.passed ? "text-green-700" : check.blocking ? "text-red-700" : "text-amber-700"
              }
            >
              {check.passed ? "✓" : check.blocking ? "✗" : "!"} {check.label}
              {!check.passed && check.reason && (
                <span className="block text-gray-700">{check.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Use it on the edit page**

In `episodes/[id]/edit/page.tsx`, add `hidden_by_consent_at, hidden_by_consent_action_id` to the episode `.select(...)` string, import `ConsentHiddenBanner`, and render above `<EpisodeForm …>`:

```tsx
{
  episodeResult.data.status === "review" && episodeResult.data.hidden_by_consent_at && (
    <ConsentHiddenBanner
      episodeId={episodeResult.data.id}
      hiddenAt={episodeResult.data.hidden_by_consent_at}
      actionId={episodeResult.data.hidden_by_consent_action_id}
    />
  );
}
```

- [ ] **Step 3: Show it in the episode list**

In `episodes/page.tsx` change the select to `"id, title, status, hidden_by_consent_at, series(title)"`. In `episode-table.tsx` add `hidden_by_consent_at: string | null;` to `EpisodeListRow` and change the status cell to:

```tsx
        {
          header: "Status",
          cell: (row) => (row.hidden_by_consent_at ? "Hidden: consent changed" : row.status),
        },
```

(If the table has no Status column yet, add this one after Series.)

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm --filter admin build`

```bash
git add apps/admin/src/app/\(dashboard\)/episodes
git commit -m "Prompt 15A: banner and checklist for consent-hidden episodes"
git push
```

Confirm CI passes.

**MILESTONE 4 STOP.** Report the screens built, the unit tests added, and anything that needed adjusting (for example PostgREST relationship names in Task 18). Wait for the user's review.

---

## Milestone 5: The fixes and the cleanup queue

### Task 24: Cleanup queue (record failures, retry from Settings)

**Files:**

- Create: `apps/admin/src/lib/cleanup-retry.ts`
- Create: `apps/admin/src/lib/cleanup-retry.test.ts`
- Modify: `apps/admin/src/lib/storage-cleanup.ts`
- Create: `apps/admin/src/app/(dashboard)/settings/cleanup-actions.ts`
- Create: `apps/admin/src/app/(dashboard)/settings/cleanup-panel.tsx`
- Modify: `apps/admin/src/app/(dashboard)/settings/page.tsx` (replace the placeholder)

**Interfaces:**

- Consumes: `storage_cleanup_queue` (Task 11), `removeStorageObjects` (Task 17).
- Produces: `retryOutcome(result: { error: { message: string } | null }): { resolved: boolean; error: string | null }`; `removeStorageObjects` now queues failures (same signature); server action `retryCleanup(id: string): Promise<ActionResult>`.

- [ ] **Step 1: Failing test**

```ts
// apps/admin/src/lib/cleanup-retry.test.ts
import { describe, expect, it } from "vitest";

import { retryOutcome } from "./cleanup-retry";

describe("retryOutcome", () => {
  it("resolves when the file was removed", () => {
    expect(retryOutcome({ error: null })).toEqual({ resolved: true, error: null });
  });

  it("resolves when the file was already gone", () => {
    // Supabase's remove() returns no error and an empty list for a path
    // that doesn't exist.
    expect(retryOutcome({ error: null })).toEqual({ resolved: true, error: null });
  });

  it("stays pending with the error when removal failed", () => {
    expect(retryOutcome({ error: { message: "network down" } })).toEqual({
      resolved: false,
      error: "network down",
    });
  });
});
```

Run: `pnpm --filter admin test -- cleanup-retry`
Expected: FAIL.

- [ ] **Step 2: Implement the decision and the queueing**

```ts
// apps/admin/src/lib/cleanup-retry.ts
// A retry either removes the file or finds it already gone; both mean
// there's nothing left to clean up. Only an error keeps the entry pending.
export function retryOutcome(result: { error: { message: string } | null }): {
  resolved: boolean;
  error: string | null;
} {
  return result.error
    ? { resolved: false, error: result.error.message }
    : { resolved: true, error: null };
}
```

Replace `apps/admin/src/lib/storage-cleanup.ts` with:

```ts
// apps/admin/src/lib/storage-cleanup.ts
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Removes storage objects after the row that pointed to them is gone or
// replaced. Failures are recorded in storage_cleanup_queue, where an admin
// can see and retry them from Settings. Signed agreements are never
// removed (consent-documents is write-once; the queue refuses it too).
export async function removeStorageObjects(
  bucket: string,
  paths: string[],
  source: { entityType: string; entityId: string },
): Promise<string[]> {
  if (bucket === "consent-documents") {
    throw new Error("Signed agreements are never deleted.");
  }
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) {
    return [];
  }
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage.from(bucket).remove(unique);
  if (!error) {
    return [];
  }
  const { error: queueError } = await supabase.from("storage_cleanup_queue").insert(
    unique.map((objectPath) => ({
      bucket_id: bucket,
      object_path: objectPath,
      source_entity_type: source.entityType,
      source_entity_id: source.entityId,
      last_error: error.message,
    })),
  );
  if (queueError) {
    console.error("removeStorageObjects: failed to queue cleanup:", queueError, unique);
  }
  return unique;
}
```

Run: `pnpm --filter admin test -- cleanup-retry`
Expected: 3 pass.

- [ ] **Step 3: Retry action**

```ts
// apps/admin/src/app/(dashboard)/settings/cleanup-actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { retryOutcome } from "@/lib/cleanup-retry";
import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function retryCleanup(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = createServiceRoleClient();
  const { data: entry, error: loadError } = await supabase
    .from("storage_cleanup_queue")
    .select("bucket_id, object_path, attempts, resolved_at")
    .eq("id", id)
    .single();
  if (loadError) {
    return { ok: false, message: loadError.message };
  }
  if (entry.resolved_at) {
    return { ok: true };
  }

  const removal = await supabase.storage.from(entry.bucket_id).remove([entry.object_path]);
  const outcome = retryOutcome({ error: removal.error });
  const { error: updateError } = await supabase
    .from("storage_cleanup_queue")
    .update(
      outcome.resolved
        ? { resolved_at: new Date().toISOString(), attempts: entry.attempts + 1, last_error: null }
        : { attempts: entry.attempts + 1, last_error: outcome.error },
    )
    .eq("id", id);
  if (updateError) {
    return { ok: false, message: updateError.message };
  }
  await logAdminAction(admin.adminId, "retry_cleanup", "storage_cleanup", id, {
    resolved: outcome.resolved,
    bucket_id: entry.bucket_id,
  });
  revalidatePath("/settings");
  return outcome.resolved ? { ok: true } : { ok: false, message: outcome.error ?? "Retry failed." };
}
```

- [ ] **Step 4: Panel and page**

```tsx
// apps/admin/src/app/(dashboard)/settings/cleanup-panel.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/button";

import { retryCleanup } from "./cleanup-actions";

export type CleanupEntry = {
  id: string;
  bucket_id: string;
  object_path: string;
  source_entity_type: string | null;
  last_error: string | null;
  attempts: number;
  created_at: string;
};

export function CleanupPanel({ entries }: { entries: CleanupEntry[] }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleRetry = async (id: string) => {
    const result = await retryCleanup(id);
    setErrors((current) => {
      const next = { ...current };
      if (result.ok) {
        delete next[id];
      } else {
        next[id] = result.message;
      }
      return next;
    });
    router.refresh();
  };

  if (entries.length === 0) {
    return <p className="text-gray-500">Nothing waiting to be cleaned up.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-1 rounded border border-gray-200 p-3">
          <span className="font-mono text-sm">
            {entry.bucket_id}/{entry.object_path}
          </span>
          <span className="text-sm text-gray-600">
            From a {entry.source_entity_type ?? "record"} · {entry.attempts} attempt(s) ·{" "}
            {entry.last_error}
          </span>
          {errors[entry.id] && <span className="text-sm text-red-600">{errors[entry.id]}</span>}
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => void handleRetry(entry.id)}
          >
            Retry
          </Button>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// apps/admin/src/app/(dashboard)/settings/page.tsx
import { createClient } from "@/lib/supabase/server";

import { type CleanupEntry, CleanupPanel } from "./cleanup-panel";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storage_cleanup_queue")
    .select("id, bucket_id, object_path, source_entity_type, last_error, attempts, created_at")
    .is("resolved_at", null)
    .order("created_at");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Storage cleanup</h2>
        <p className="text-sm text-gray-600">
          Files that couldn&apos;t be removed when their record was deleted or replaced.
        </p>
        {error ? (
          <p className="text-red-600">Failed to load: {error.message}</p>
        ) : (
          <CleanupPanel entries={data as CleanupEntry[]} />
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter admin test && pnpm typecheck && pnpm lint && pnpm --filter admin build`

```bash
git add apps/admin/src/lib/cleanup-retry.ts apps/admin/src/lib/cleanup-retry.test.ts apps/admin/src/lib/storage-cleanup.ts apps/admin/src/app/\(dashboard\)/settings
git commit -m "Prompt 15A: record failed storage deletes and retry them from Settings"
```

### Task 25: Remove files when episodes, series and destinations are deleted or replaced

**Files:**

- Create: `apps/admin/src/lib/storage-paths.ts`
- Create: `apps/admin/src/lib/storage-paths.test.ts`
- Modify: `apps/admin/src/app/(dashboard)/episodes/actions.ts` (`updateEpisode`, `deleteEpisode`)
- Modify: `apps/admin/src/app/(dashboard)/series/actions.ts` (`updateSeries`, `deleteSeries`)
- Modify: `apps/admin/src/app/(dashboard)/destinations/actions.ts` (`updateDestination`, `deleteDestination`)
- Modify: `apps/admin/src/app/(dashboard)/destinations/media-actions.ts` (`deleteDestinationMedia`)

**Interfaces:**

- Consumes: `removeStorageObjects` (Task 24).
- Produces: `publicUrlToPath(url: string | null, bucket: string): string | null`.

- [ ] **Step 1: Failing test**

```ts
// apps/admin/src/lib/storage-paths.test.ts
import { describe, expect, it } from "vitest";

import { publicUrlToPath } from "./storage-paths";

describe("publicUrlToPath", () => {
  it("extracts the object path from a public URL", () => {
    expect(
      publicUrlToPath(
        "https://x.supabase.co/storage/v1/object/public/images/series/abc-cover.jpg",
        "images",
      ),
    ).toBe("series/abc-cover.jpg");
  });

  it("decodes URL-encoded characters", () => {
    expect(
      publicUrlToPath(
        "https://x.supabase.co/storage/v1/object/public/images/series/a%20b.jpg",
        "images",
      ),
    ).toBe("series/a b.jpg");
  });

  it("returns null for another bucket, a foreign URL or nothing", () => {
    expect(
      publicUrlToPath("https://x.supabase.co/storage/v1/object/public/other/a.jpg", "images"),
    ).toBeNull();
    expect(publicUrlToPath("https://example.com/a.jpg", "images")).toBeNull();
    expect(publicUrlToPath(null, "images")).toBeNull();
  });
});
```

Run: `pnpm --filter admin test -- storage-paths`
Expected: FAIL.

- [ ] **Step 2: Implement**

```ts
// apps/admin/src/lib/storage-paths.ts
// Series and destination images are stored as public URLs; deleting the
// file needs the object path inside the bucket.
export function publicUrlToPath(url: string | null, bucket: string): string | null {
  if (!url) {
    return null;
  }
  const marker = `/storage/v1/object/public/${bucket}/`;
  const index = url.indexOf(marker);
  if (index === -1) {
    return null;
  }
  return decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
}
```

Run: `pnpm --filter admin test -- storage-paths`
Expected: 3 pass.

- [ ] **Step 3: Episodes**

In `episodes/actions.ts`, add imports `import { removeStorageObjects } from "@/lib/storage-cleanup";`. In `updateEpisode`, before the update, load the old audio path:

```ts
const { data: before, error: loadError } = await supabase
  .from("episodes")
  .select("audio_url")
  .eq("id", id)
  .single();
if (loadError) {
  return { ok: false, message: loadError.message };
}
```

and after the contributor links are saved successfully (just before `logAdminAction`):

```ts
const newAudio = input.audioUrl || null;
if (before.audio_url && before.audio_url !== newAudio) {
  await removeStorageObjects("audio-episodes", [before.audio_url], {
    entityType: "episode",
    entityId: id,
  });
}
```

Replace `deleteEpisode` with:

```ts
export async function deleteEpisode(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }
  const supabase = createServiceRoleClient();
  const { data: episode, error: loadError } = await supabase
    .from("episodes")
    .select("audio_url")
    .eq("id", id)
    .single();
  if (loadError) {
    return { ok: false, message: loadError.message };
  }
  // Row first: a row pointing at a missing file is worse than an orphan.
  const { error } = await supabase.from("episodes").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }
  if (episode.audio_url) {
    await removeStorageObjects("audio-episodes", [episode.audio_url], {
      entityType: "episode",
      entityId: id,
    });
  }
  await logAdminAction(admin.adminId, "delete", "episode", id);
  revalidatePath("/episodes");
  return { ok: true };
}
```

`audio_url` already holds a storage path (Prompt 14 fix), so no URL conversion is needed.

- [ ] **Step 4: Series**

In `series/actions.ts`, import `removeStorageObjects` and `publicUrlToPath`. In `updateSeries`, load `cover_image_url` before the update; after a successful update:

```ts
const oldCover = publicUrlToPath(before.cover_image_url, "images");
if (oldCover && before.cover_image_url !== (input.coverImageUrl || null)) {
  await removeStorageObjects("images", [oldCover], { entityType: "series", entityId: id });
}
```

Replace `deleteSeries`'s body after `requireAdmin` with: load `cover_image_url`; delete the row (return on error); then

```ts
const cover = publicUrlToPath(series.cover_image_url, "images");
if (cover) {
  await removeStorageObjects("images", [cover], { entityType: "series", entityId: id });
}
```

then log and revalidate as before.

- [ ] **Step 5: Destinations**

In `destinations/actions.ts`, import both helpers. `updateDestination`: same cover-replacement handling as series (`entityType: "destination"`). Replace `deleteDestination`'s body after `requireAdmin` with:

```ts
const supabase = createServiceRoleClient();
const [destinationResult, mediaResult] = await Promise.all([
  supabase.from("destinations").select("cover_image_url").eq("id", id).single(),
  supabase.from("destination_media").select("media_url").eq("destination_id", id),
]);
if (destinationResult.error) {
  return { ok: false, message: destinationResult.error.message };
}
if (mediaResult.error) {
  return { ok: false, message: mediaResult.error.message };
}

// Gallery rows go with the destination (on delete cascade); their files don't.
const { error } = await supabase.from("destinations").delete().eq("id", id);
if (error) {
  return { ok: false, message: error.message };
}

const paths = [
  publicUrlToPath(destinationResult.data.cover_image_url, "images"),
  ...mediaResult.data.map((media) => publicUrlToPath(media.media_url, "images")),
].filter((path): path is string => path !== null);
await removeStorageObjects("images", paths, { entityType: "destination", entityId: id });

await logAdminAction(admin.adminId, "delete", "destination", id);
revalidatePath("/destinations");
return { ok: true };
```

- [ ] **Step 6: Gallery photo delete uses the shared helpers**

In `media-actions.ts` `deleteDestinationMedia`, replace the `marker`/`indexOf` block and its `remove` call with:

```ts
const objectPath = publicUrlToPath(mediaRow.media_url, "images");
if (objectPath) {
  await removeStorageObjects("images", [objectPath], {
    entityType: "destination",
    entityId: destinationId,
  });
}
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm --filter admin test && pnpm typecheck && pnpm lint`

```bash
git add apps/admin/src/lib/storage-paths.ts apps/admin/src/lib/storage-paths.test.ts apps/admin/src/app/\(dashboard\)
git commit -m "Prompt 15A: remove storage files when records are deleted or replaced"
```

### Task 26: Dashboard counts and duplicate contributor links

**Files:**

- Create: `apps/admin/src/lib/count-display.ts`
- Create: `apps/admin/src/lib/count-display.test.ts`
- Modify: `apps/admin/src/app/(dashboard)/page.tsx`
- Modify: `apps/admin/src/app/(dashboard)/episodes/contributor-link-diff.ts` (add `findDuplicate`)
- Modify: `apps/admin/src/app/(dashboard)/episodes/contributor-link-diff.test.ts`
- Modify: `apps/admin/src/app/(dashboard)/episodes/contributor-linker.tsx`
- Modify: `apps/admin/src/app/(dashboard)/episodes/actions.ts` (`replaceContributorLinks` 23505 handling)

**Interfaces:**

- Produces: `countDisplay(result: { count: number | null; error: { message: string } | null }): { value: string; error: string | null }`; `findDuplicate(links: ContributorLink[], candidate: ContributorLink): boolean`.

- [ ] **Step 1: Failing tests**

```ts
// apps/admin/src/lib/count-display.test.ts
import { describe, expect, it } from "vitest";

import { countDisplay } from "./count-display";

describe("countDisplay", () => {
  it("shows the count", () => {
    expect(countDisplay({ count: 12, error: null })).toEqual({ value: "12", error: null });
  });

  it("shows a real zero as 0", () => {
    expect(countDisplay({ count: 0, error: null })).toEqual({ value: "0", error: null });
  });

  it("shows — and the error instead of 0 when the query failed", () => {
    expect(countDisplay({ count: null, error: { message: "timeout" } })).toEqual({
      value: "—",
      error: "timeout",
    });
  });
});
```

Append to `contributor-link-diff.test.ts`:

```ts
import { findDuplicate } from "./contributor-link-diff";

describe("findDuplicate", () => {
  it("finds the same contributor in the same role", () => {
    expect(
      findDuplicate([{ contributorId: "c1", role: "narrator" }], {
        contributorId: "c1",
        role: "narrator",
      }),
    ).toBe(true);
  });

  it("allows the same contributor in a different role", () => {
    expect(
      findDuplicate([{ contributorId: "c1", role: "narrator" }], {
        contributorId: "c1",
        role: "translator",
      }),
    ).toBe(false);
  });

  it("compares roles case- and space-insensitively", () => {
    expect(
      findDuplicate([{ contributorId: "c1", role: "Narrator" }], {
        contributorId: "c1",
        role: " narrator ",
      }),
    ).toBe(true);
  });
});
```

Run: `pnpm --filter admin test`
Expected: the new tests fail.

- [ ] **Step 2: Implement**

```ts
// apps/admin/src/lib/count-display.ts
// A failed count must never read as "0".
export function countDisplay(result: { count: number | null; error: { message: string } | null }): {
  value: string;
  error: string | null;
} {
  if (result.error) {
    return { value: "—", error: result.error.message };
  }
  return { value: String(result.count ?? 0), error: null };
}
```

Append to `contributor-link-diff.ts`:

```ts
const normalizeRole = (role: string) => role.trim().toLowerCase();

export function findDuplicate(links: ContributorLink[], candidate: ContributorLink): boolean {
  return links.some(
    (link) =>
      link.contributorId === candidate.contributorId &&
      normalizeRole(link.role) === normalizeRole(candidate.role),
  );
}
```

Run: `pnpm --filter admin test`
Expected: all pass.

- [ ] **Step 3: Dashboard**

In `(dashboard)/page.tsx`, import `countDisplay`, and replace the two cards with:

```tsx
const series = countDisplay(seriesCount);
const publishedSeries = countDisplay(publishedSeriesCount);
const episodes = countDisplay(episodeCount);
const publishedEpisodes = countDisplay(publishedEpisodeCount);
const loadErrors = [series, publishedSeries, episodes, publishedEpisodes]
  .map((item) => item.error)
  .filter((message): message is string => message !== null);

return (
  <div className="flex flex-col gap-4">
    <h1 className="text-xl font-semibold">Dashboard</h1>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="rounded border border-gray-200 p-4">
        <p className="text-sm text-gray-500">Series</p>
        <p className="text-2xl font-semibold">{series.value}</p>
        <p className="text-xs text-gray-400">{publishedSeries.value} published</p>
      </div>
      <div className="rounded border border-gray-200 p-4">
        <p className="text-sm text-gray-500">Episodes</p>
        <p className="text-2xl font-semibold">{episodes.value}</p>
        <p className="text-xs text-gray-400">{publishedEpisodes.value} published</p>
      </div>
    </div>
    {loadErrors.length > 0 && (
      <p className="text-sm text-red-600">Couldn&apos;t load: {loadErrors.join("; ")}</p>
    )}
  </div>
);
```

- [ ] **Step 4: Linker refuses duplicates**

In `contributor-linker.tsx`, import `findDuplicate` from `./contributor-link-diff`, add `const [linkError, setLinkError] = useState<string | undefined>();`, and change `handleAdd` to:

```tsx
const handleAdd = () => {
  if (!selectedContributorId || !role.trim()) {
    return;
  }
  const candidate = { contributorId: selectedContributorId, role: role.trim() };
  if (findDuplicate(links, candidate)) {
    const name = optionsById.get(selectedContributorId)?.display_name ?? "This contributor";
    setLinkError(`${name} is already linked as ${candidate.role}.`);
    return;
  }
  setLinkError(undefined);
  onChange([...links, candidate]);
  setSelectedContributorId("");
  setRole("");
};
```

Move the `optionsById` declaration above `handleAdd`, and render `{linkError && <p className="text-sm text-red-600">{linkError}</p>}` under the add row.

- [ ] **Step 5: Server maps a duplicate-key error to the same message**

In `episodes/actions.ts` `replaceContributorLinks`, replace the insert-error return with:

```ts
if (error) {
  if (error.code === "23505") {
    const duplicate = toInsert[0];
    const { data: contributor } = await supabase
      .from("contributors")
      .select("display_name")
      .eq("id", duplicate.contributorId)
      .single();
    return {
      error: `${contributor?.display_name ?? "This contributor"} is already linked as ${duplicate.role}.`,
    };
  }
  return { error: error.message };
}
```

(With `diffContributorLinks` collapsing duplicates, this only triggers if another admin linked the same pair at the same moment; the message names the first inserted link, which is exact when one link is added at a time.)

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter admin test && pnpm typecheck && pnpm lint`

```bash
git add apps/admin/src
git commit -m "Prompt 15A: dashboard counts show errors, duplicate links explained"
```

### Task 27: Known issues and documentation

**Files:**

- Modify: `docs/known-issues.md`
- Modify: `docs/media-pipeline.md` (bucket table)
- Modify: `docs/schema.md` (consents, consent_voids, episodes, contributors, storage_cleanup_queue)

- [ ] **Step 1: Close the fixed entries**

In `docs/known-issues.md`, delete the entries now fixed, and add a one-line note under each removed heading's former section that it was fixed in Prompt 15A:

- "Deleting an episode, series, or destination leaves its files in storage"
- "Unpublishing an episode leaves `published_at` set"
- In "The CDN keeps serving deleted public images for up to an hour", replace the "Fix shape" paragraph with "Built in Prompt 15A: contributor photos are private and served by `get-contributor-photos`. Series and destination images stay public with one-hour caching, by decision." and keep the entry (the public-image caching behaviour remains true).

- [ ] **Step 2: Add the new limitations**

Append under `## Admin` (one entry each, in this file's format: what, **Fix shape**, **Severity**):

1. **Consent records can't be erased from the admin** — append-only by design; a legal erasure request needs a reviewed developer migration. Severity: low until a request arrives; plan the process before real data.
2. **A wrong uploaded agreement stays in storage** — `consent-documents` is write-once; void the consent row instead. Severity: low.
3. **Hidden contributor photos remain stored** — files stay in the private bucket when a contributor becomes anonymous or loses photo consent; only `get-contributor-photos` refusing to issue a link hides them. Severity: low.
4. **A shown photo can stay in a phone's memory until the app restarts** — never on disk (`cachePolicy="memory"`); verify on a development build (manual check). Severity: low.
5. **No guest rate limiting on `get-contributor-photos`** — bounded by the 50-id cap and one-hour links; per-IP limits would block listeners behind shared mobile-carrier IPs. **Fix shape:** Prompt 18. Severity: low.
6. **Agreement fingerprint trust** — `document_sha256` comes from the admin server action; an admin calling `record_consent` directly could supply a false value. The storage checksum snapshot can't be forged by the caller.
7. **Changes outside the app** — anyone with dashboard or service-role access can still alter or remove storage files; fingerprints detect it but can't prevent it.
8. **Voiding an older declined row is refused when a newer grant exists** — D6 is implemented literally (see the plan's Global Constraints); it never makes consent more permissive, but blocks correcting an old mistyped decline. **Fix shape:** relax to "refuse only if the latest counted status would change to permissive" if this ever gets in the way.

- [ ] **Step 3: Update the reference docs**

- `docs/media-pipeline.md`: add `contributor-photos` (private, admin-only; served via `get-contributor-photos` signed links) to the bucket table, and mark `consent-documents` as write-once (admin select and insert only).
- `docs/schema.md`: add `consents.seq`, `reason`, `recorded_by`, `document_sha256`, `document_storage_etag`, `document_size_bytes`; the `consent_voids` and `storage_cleanup_queue` tables; `episodes.hidden_by_consent_at` and `hidden_by_consent_action_id`; `contributors.photo_url` → `photo_path`; and a short "Consent and publishing functions" list (`record_consent`, `void_consent`, `preview_consent_change`, `episode_publish_check`, `latest_counted_consent`, `publish_episode`, `unpublish_episode`, `contributor_photo_status`, `contributor_photo_paths`, `consent_document_state`, `admin_contributor_summaries`).
- `docs/schema.md`, same section: "Publishing goes only through `publish_episode()`; a trigger refuses any other change to `published`. Prompt 19's seed data must publish through `publish_episode()` too."

- [ ] **Step 4: Verify and commit**

Run: `npx prettier --check docs`

```bash
git add docs
git commit -m "Prompt 15A: known issues and reference docs"
git push
```

Confirm CI passes.

**MILESTONE 5 STOP.** Report the fixes, the cleanup queue, and the documentation changes. Wait for the user's review.

---

## Milestone 6: Rollout to the live project

Nothing in this milestone runs without the user's explicit approval at Task 28 Step 2.

### Task 28: Apply to the live project (approval required)

- [ ] **Step 1: Pre-flight (read-only)**

Confirm, and report each to the user:

1. CI is green on the latest commit of `admin-operations`, including `db-tests`.
2. `bash supabase/tests/upgrade/run.sh && pnpm test:db && pnpm test:integration` pass locally on a fresh `supabase db reset --local`.
3. The live project still holds only test data:
   `supabase db query --linked "select (select count(*) from consents) consents, (select count(*) from contributors) contributors, (select count(*) from episodes) episodes"`
4. What will be applied: `supabase db push --dry-run` (lists the seven 15A migrations, `20261004100000` to `20261004100600`, and nothing else).
5. The live project has no backups (see `known-issues.md`): if something goes wrong, there is no restore. State this plainly.

- [ ] **Step 2: Ask for approval**

Ask the user, in these words: "Ready to apply the seven Prompt 15A migrations to the live project and deploy `get-contributor-photos`. The live project has no backups. Approve?" Wait for an explicit yes. Anything else is a no.

- [ ] **Step 3: Apply**

```bash
supabase db push
supabase functions deploy get-contributor-photos
```

- [ ] **Step 4: Verify**

1. `supabase migration list --linked` shows local and remote identical.
2. Repeat Step 1's row-count query: counts unchanged.
3. Call the deployed function as a guest with one random UUID; expect `200 {"photos":{}}` and `Cache-Control: no-store`.
4. After the PR merges to `main`, the Migration drift workflow runs on the push; confirm it passes.

Report each result. If anything fails, stop and report; do not attempt fixes against the live project without the user's approval.

### Task 29: Browser QA (local) and a read-only live smoke check

Decided with the user (2026-10-04): the full QA pass runs against **local Supabase**, so no consent row, test or otherwise, is ever written to the live project. The live project only gets a read-only smoke check.

- [ ] **Step 1: Point the admin app at the local stack**

```bash
supabase db reset --local
eval "$(supabase status -o env | sed -E 's/^([A-Z_]+)=/export LOCAL_\1=/')"
cd apps/admin
NEXT_PUBLIC_SUPABASE_URL="$LOCAL_API_URL" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$LOCAL_ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SERVICE_ROLE_KEY" \
TEST_ADMIN_PASSWORD=local-admin-pass TEST_TEACHER_PASSWORD=local-teacher-pass TEST_LISTENER_PASSWORD=local-listener-pass \
  pnpm provision:test-accounts
NEXT_PUBLIC_SUPABASE_URL="$LOCAL_API_URL" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$LOCAL_ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SERVICE_ROLE_KEY" \
  pnpm dev
```

Environment variables set on the command line take precedence over `.env.local`, so these never touch the live project. Before signing in, confirm the app is on the local stack: the browser's network requests go to `127.0.0.1:54321`, not `*.supabase.co`. If they don't, stop.

- [ ] **Step 2: Run the pass with `playwright-cli`**

Sign in as `admin-test@villagefireside.app` / `local-admin-pass` and check:

1. Add an elder contributor; upload a photo; badge reads "Hidden from app: no photo consent recorded".
2. Add a `photo` consent `granted_with_conditions` with an agreement: the conditions message shows; badge reads the conditions text.
3. Add `photo` `granted`: badge "Shown in the app"; the local photo function returns a link for this contributor.
4. Create an elder-testimony episode, link the elder, add `story_recording` `granted` with an agreement, publish.
5. Revoke `story_recording` with a reason: the preview lists the episode; afterwards the episode shows "Hidden because consent changed" with the checklist; `published_at` is empty in the database.
6. Open the agreement: "Verified".
7. Try to void the revoked row: no Void button; a direct `void_consent` call is refused.
8. Record a `photo` grant by mistake and void it as a wrong-type entry: it shows crossed out with the reason; nothing is hidden.
9. Link an unverified source material to another episode and publish: the acknowledgement dialog appears; the audit entry records it.
10. Delete the QA episode, series and destination: their files are gone from local storage; Settings shows no pending cleanup.
11. `/consents` shows the full history by default, with reasons.

- [ ] **Step 3: Read-only smoke check on the live project**

Writes nothing:

1. `supabase migration list --linked`: local and remote identical.
2. `supabase db query --linked "select (select count(*) from consents) consents, (select count(*) from contributors) contributors, (select count(*) from episodes) episodes"`: same counts as Task 28 Step 1.
3. Call the deployed `get-contributor-photos` as a guest with one random UUID: `200 {"photos":{}}` and `Cache-Control: no-store`.
4. Sign in to the live admin as the test admin and open `/contributors`, `/consents`, `/source-materials` and `/settings` without creating anything: each loads without an error.

- [ ] **Step 4: Report**

Report each check's result and anything unexpected. Nothing is left behind on the live project; the local QA data disappears with the next `supabase db reset --local`.

**MILESTONE 6 STOP.** Then use superpowers:finishing-a-development-branch.
