# Daily Engagement: Today's Story, Streaks & Quizzes (Prompt 13B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Tonight at the Fireside" (a daily featured free episode), listening streaks with a rolling-7-day protected miss, episode quizzes with a teacher aggregate view, and `docs/content-craft.md`.

**Architecture:** Three independent data-layer migrations (daily-featured-episode override + auto-rotation, an atomic streak-recording RPC, quiz tables + a teacher-aggregate RPC), a shared client-local-date utility everything else depends on, a small `daily-engagement-store` carrying two finish-triggered UI states (streak milestone toast, pending quiz prompt), and additive UI on Home/Profile/the existing teacher class-detail screen. No new npm dependencies.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, TanStack Query, Zustand, Postgres (`plpgsql` functions, `security definer`), TypeScript throughout.

**Spec:** `docs/superpowers/specs/2026-09-22-daily-engagement-design.md` — read it if any task below is unclear about intent. It also carries the full reasoning behind the timezone design (client-local date, never server/UTC), the rolling-7-day ember cooldown, and the deliberate trust extended to the client-supplied date — this plan assumes that reasoning without repeating it.

## Global Constraints

- **"Today" is always the user's local calendar date**, computed via `getLocalDateString()` (Task 4) — never `toISOString()`, never a server-side `current_date`. Every task that needs "today" imports this function.
- **No new npm dependencies.** Flame/quiz UI uses existing `Pressable`/`ThemedText`/`Card` primitives and emoji glyphs.
- **Every task must leave `pnpm typecheck` clean.**
- **Migration timestamps continue this repo's `supabase/migrations/YYYYMMDDHHmmss` sequence** — the last one is `20260803100200`; this plan's three migrations use `20260922100000`, `20260922100100`, `20260922100200`.
- **Commit after every task**, following this repo's convention: `git commit -m "Prompt 13B: <description>"`.
- **The RLS policies, the `record_listening_day` defensive date bound, and its row-locking `for update` are load-bearing** — copy the spec's SQL verbatim, do not simplify them away.
- **No automated tests for query hooks, screens, or component prop additions** — matches this codebase's established precedent (confirmed: no test file exists for any `use-*.ts` query hook or screen component anywhere in this app). Pure logic (date math, tick-accumulation math) does get real Jest tests, following the precedent set by `local-listening-progress.test.ts`, which tests only its pure `resolveResumePosition` and leaves the `expo-file-system`-backed read/write functions untested — this codebase has no `expo-file-system` mocking infrastructure anywhere, so this plan follows the same split rather than introducing new mocking infra.

---

### Task 1: Migration — `daily_featured_episodes`

**Files:**

- Create: `supabase/migrations/20260922100000_daily_featured_episodes_table.sql`

**Interfaces:**

- Produces: `daily_featured_episodes` table (`feature_date` PK, `episode_id`). Consumed by Task 6's `useTodaysFeaturedEpisode`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260922100000_daily_featured_episodes_table.sql

create table daily_featured_episodes (
  feature_date date primary key,
  episode_id uuid not null references episodes (id),
  created_at timestamptz not null default now()
);

alter table daily_featured_episodes enable row level security;

create policy daily_featured_episodes_select_anyone
  on daily_featured_episodes for select
  using (true);

create policy daily_featured_episodes_admin_all
  on daily_featured_episodes for all
  using (is_admin())
  with check (is_admin());
```

- [ ] **Step 2: Apply the migration to the live linked project**

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
supabase db push
```

- [ ] **Step 3: Confirm it applied**

```bash
supabase migration list
```

Expected: `20260922100000` appears with matching `local`/`remote` values.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260922100000_daily_featured_episodes_table.sql
git commit -m "Prompt 13B: add daily_featured_episodes table"
```

---

### Task 2: Migration — `listener_streaks` + `record_listening_day`

**Files:**

- Create: `supabase/migrations/20260922100100_listener_streaks_and_record_listening_day.sql`

**Interfaces:**

- Produces: `listener_streaks` table (owner-select-only RLS); `record_listening_day(p_local_date date) returns listener_streaks` (`security definer`, `authenticated` execute only). Consumed by Task 8 (writes) and Task 9 (reads via the table's own RLS).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260922100100_listener_streaks_and_record_listening_day.sql

create table listener_streaks (
  user_id uuid primary key references profiles (id) on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_listen_date date,
  last_ember_spent_at timestamptz
);

alter table listener_streaks enable row level security;

create policy listener_streaks_owner_select
  on listener_streaks for select
  using (user_id = auth.uid());

create or replace function record_listening_day(p_local_date date)
returns listener_streaks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row listener_streaks;
  v_gap int;
  v_ember_available boolean;
begin
  -- Defensive bound on the client-supplied date (see the spec's
  -- "Timezone handling" section). Wide enough for any real timezone
  -- offset (max ~14h), narrow enough to reject a tampered/garbage value.
  if p_local_date > (now() at time zone 'utc')::date + 1
     or p_local_date < (now() at time zone 'utc')::date - 1 then
    raise exception 'p_local_date out of acceptable range';
  end if;

  select * into v_row from listener_streaks
    where user_id = auth.uid() for update;

  if not found then
    insert into listener_streaks (user_id, current_streak, longest_streak, last_listen_date)
    values (auth.uid(), 1, 1, p_local_date)
    returning * into v_row;
    return v_row;
  end if;

  if v_row.last_listen_date = p_local_date then
    return v_row; -- already recorded today — no-op
  end if;

  v_gap := p_local_date - v_row.last_listen_date;

  if v_gap <= 0 then
    -- Client date is behind our stored last_listen_date (clock skew or
    -- an out-of-order call). Do nothing rather than risk destroying a
    -- real streak on untrusted-but-stale input.
    return v_row;
  elsif v_gap = 1 then
    update listener_streaks set
      current_streak = v_row.current_streak + 1,
      longest_streak = greatest(v_row.longest_streak, v_row.current_streak + 1),
      last_listen_date = p_local_date
    where user_id = auth.uid()
    returning * into v_row;
  elsif v_gap = 2 then
    v_ember_available := v_row.last_ember_spent_at is null
      or now() - v_row.last_ember_spent_at >= interval '7 days';
    if v_ember_available then
      update listener_streaks set
        current_streak = v_row.current_streak + 1,
        longest_streak = greatest(v_row.longest_streak, v_row.current_streak + 1),
        last_listen_date = p_local_date,
        last_ember_spent_at = now()
      where user_id = auth.uid()
      returning * into v_row;
    else
      update listener_streaks set
        current_streak = 1,
        last_listen_date = p_local_date
      where user_id = auth.uid()
      returning * into v_row;
    end if;
  else
    update listener_streaks set
      current_streak = 1,
      last_listen_date = p_local_date
    where user_id = auth.uid()
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function record_listening_day(date) from public;
grant execute on function record_listening_day(date) to authenticated;
```

- [ ] **Step 2: Apply the migration to the live linked project**

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
supabase db push
```

- [ ] **Step 3: Confirm it applied**

```bash
supabase migration list
```

Expected: `20260922100100` appears with matching `local`/`remote` values.

- [ ] **Step 4: Required live verification — find a real test profile id**

This project has no seed data yet, but has at least one real account by this point (the admin account documented in `docs/auth.md`, created during Prompt 5/18's testing). Do not fabricate a user id for this test — a fabricated id violates `listener_streaks`' `references profiles (id)` foreign key.

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
PROJECT_REF=$(cat supabase/.temp/project-ref)
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"select id from profiles limit 1;"}'
```

If this returns zero rows, **stop and flag it** — do not proceed by inventing a user. Otherwise capture the returned `id` as `TEST_USER_ID` for the next step.

- [ ] **Step 5: Required live verification — the six `record_listening_day` cases**

Runs entirely inside one transaction that ends in `rollback`, so the real `listener_streaks` state for this user is untouched once the check completes. `set_config('request.jwt.claims', ...)` is the standard technique for making `auth.uid()` resolve correctly when calling a `security definer` function from a raw SQL session that has no real PostgREST-issued JWT. This uses `jq` to build the JSON payload safely (the SQL below is multi-statement and would be error-prone to hand-escape inline the way Prompt 13's single-line `EXPLAIN` check did):

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
PROJECT_REF=$(cat supabase/.temp/project-ref)
TEST_USER_ID="<the id captured in Step 4>"

SQL=$(cat <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"${TEST_USER_ID}","role":"authenticated"}', true);

-- Case 1: first-ever call — expect current_streak=1, longest_streak=1
delete from listener_streaks where user_id = '${TEST_USER_ID}';
select * from record_listening_day('2026-09-01'::date);

-- Case 2: same-day repeat call — expect unchanged, current_streak=1
select * from record_listening_day('2026-09-01'::date);

-- Case 3: consecutive-day call — expect current_streak=2
select * from record_listening_day('2026-09-02'::date);

-- Case 4: one-day gap, ember never spent — expect streak protected
-- (current_streak=3), last_ember_spent_at now set
select * from record_listening_day('2026-09-04'::date);

-- Case 5: one-day gap again, within 7 days of the ember just spent —
-- expect current_streak resets to 1
select * from record_listening_day('2026-09-06'::date);

-- Case 6: 2+ day gap from a nonzero streak, independent of ember state —
-- expect current_streak resets to 1
update listener_streaks set current_streak = 5, longest_streak = 5,
  last_listen_date = '2026-09-06'::date, last_ember_spent_at = null
  where user_id = '${TEST_USER_ID}';
select * from record_listening_day('2026-09-12'::date);

rollback;
SQL
)

curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg q "$SQL" '{query: $q}')"
```

(If `jq` is unavailable, install it — `brew install jq` — rather than hand-escaping this multi-statement SQL inline.)

Report the actual returned rows for all six `select` statements against the expectations noted in the comments above. If any case's result doesn't match, this task is not done — escalate rather than proceeding to Task 3.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260922100100_listener_streaks_and_record_listening_day.sql
git commit -m "Prompt 13B: add listener_streaks table and record_listening_day function"
```

---

### Task 3: Migration — quizzes, quiz_questions, quiz_attempts, class_quiz_scores

**Files:**

- Create: `supabase/migrations/20260922100200_quizzes_and_class_quiz_scores.sql`

**Interfaces:**

- Produces: `quizzes`, `quiz_questions`, `quiz_attempts` tables (RLS as below); `class_quiz_scores(p_class_id uuid) returns table (episode_id uuid, average_score numeric, average_total numeric, completion_count bigint)`. Consumed by Task 10 (`fetchPublishedQuiz`), Task 12 (`useQuizDetail`/`useSubmitQuizAttempt`), Task 13 (`useClassDetail`'s quiz-aggregate field).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260922100200_quizzes_and_class_quiz_scores.sql

create table quizzes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null unique references episodes (id),
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes (id) on delete cascade,
  question text not null,
  options jsonb not null, -- array of 2-4 strings
  correct_index int not null,
  explanation text,
  sort_order int not null default 0
);

create table quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  quiz_id uuid not null references quizzes (id),
  score int not null,
  total int not null,
  completed_at timestamptz not null default now()
);

alter table quizzes enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_attempts enable row level security;

-- Visibility mirrors episodes' own rule: public if the linked episode is
-- published, independent of the episode's access_tier/lock status.
create policy quizzes_select_published_episode
  on quizzes for select
  using (
    is_published and exists (
      select 1 from episodes e
      where e.id = quizzes.episode_id and e.status = 'published'
    )
  );

create policy quizzes_admin_all
  on quizzes for all
  using (is_admin())
  with check (is_admin());

create policy quiz_questions_select_published_episode
  on quiz_questions for select
  using (
    exists (
      select 1 from quizzes q
      join episodes e on e.id = q.episode_id
      where q.id = quiz_questions.quiz_id
        and q.is_published
        and e.status = 'published'
    )
  );

create policy quiz_questions_admin_all
  on quiz_questions for all
  using (is_admin())
  with check (is_admin());

create policy quiz_attempts_owner_select
  on quiz_attempts for select
  using (user_id = auth.uid());

create policy quiz_attempts_owner_insert
  on quiz_attempts for insert
  with check (user_id = auth.uid());

create or replace function class_quiz_scores(p_class_id uuid)
returns table (episode_id uuid, average_score numeric, average_total numeric, completion_count bigint)
language sql
security definer
set search_path = public
as $$
  select
    ca.episode_id,
    avg(qa.score) as average_score,
    avg(qa.total) as average_total,
    count(distinct qa.user_id) as completion_count
  from class_assignments ca
  join quizzes q on q.episode_id = ca.episode_id
  left join class_members cm on cm.class_id = ca.class_id
  left join quiz_attempts qa on qa.quiz_id = q.id and qa.user_id = cm.user_id
  where ca.class_id = p_class_id
    and exists (
      select 1 from classes c
      where c.id = p_class_id and c.teacher_id = auth.uid()
    )
  group by ca.episode_id;
$$;

revoke all on function class_quiz_scores(uuid) from public;
grant execute on function class_quiz_scores(uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration to the live linked project**

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
supabase db push
```

- [ ] **Step 3: Confirm it applied**

```bash
supabase migration list
```

Expected: `20260922100200` appears with matching `local`/`remote` values.

- [ ] **Step 4: Required live verification of `class_quiz_scores`**

This project has no seed data yet, so this needs temporary test rows,
rolled back afterward — same treatment the spec calls for, matching
`class_episode_listen_counts`' own live-verification precedent from
Prompt 12. Find a real teacher's `classes` row first (do not fabricate
one — a fabricated `teacher_id` won't resolve against a real
`auth.uid()` when called normally, and this function's own
`c.teacher_id = auth.uid()` check would just always exclude it):

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
PROJECT_REF=$(cat supabase/.temp/project-ref)
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"select id, teacher_id from classes limit 1;"}'
```

If this returns zero rows (no class has been created through Prompt
12's teacher flow yet), this verification cannot be performed live —
note that explicitly rather than skipping the check silently, and
revisit once a real class exists. Otherwise, capture `id` as
`TEST_CLASS_ID` and `teacher_id` as `TEST_TEACHER_ID`, and run:

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
PROJECT_REF=$(cat supabase/.temp/project-ref)
TEST_CLASS_ID="<the class id captured above>"
TEST_TEACHER_ID="<the teacher_id captured above>"

SQL=$(cat <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"${TEST_TEACHER_ID}","role":"authenticated"}', true);

-- Temporary test data: one assigned episode with a published quiz and
-- two completed attempts from two different (fake, temporary) class
-- members, to confirm the average/count math.
insert into episodes (id, series_id, title, episode_number, status, access_tier, content_source)
  select gen_random_uuid(), s.id, 'TEMP verification episode', 999, 'published', 'free', 'narrated_production'
  from series s limit 1
  returning id as episode_id \gset

insert into class_assignments (class_id, episode_id) values ('${TEST_CLASS_ID}', :'episode_id');
insert into quizzes (id, episode_id, is_published) values (gen_random_uuid(), :'episode_id', true) returning id as quiz_id \gset
insert into quiz_attempts (user_id, quiz_id, score, total) values
  ('${TEST_TEACHER_ID}', :'quiz_id', 4, 5),
  ('${TEST_TEACHER_ID}', :'quiz_id', 3, 5);

select * from class_quiz_scores('${TEST_CLASS_ID}');
-- Expect one row for :'episode_id' with average_score=3.5, average_total=5,
-- completion_count=1 (both attempts share the same user_id here since
-- this is a single real account standing in for two class members —
-- completion_count counts distinct users, so this specific test proves
-- the averaging math, not the distinct-user counting; note this
-- limitation in the reported result rather than treating it as fully
-- proven).

rollback;
SQL
)

curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg q "$SQL" '{query: $q}')"
```

Report the actual returned row against the expectation above, and
explicitly note the completion-count caveat (a true distinct-user test
needs a second real class-member account, which this project doesn't
have yet with no seed data).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260922100200_quizzes_and_class_quiz_scores.sql
git commit -m "Prompt 13B: add quizzes/quiz_questions/quiz_attempts tables and class_quiz_scores function"
```

---

### Task 4: `local-date.ts` — the shared "today" utility

**Files:**

- Create: `apps/mobile/src/lib/local-date.ts`
- Test: `apps/mobile/src/lib/local-date.test.ts`

**Interfaces:**

- Produces: `getLocalDateString(date?: Date): string`, returning `YYYY-MM-DD` from the given (or current) `Date`'s **local** accessors. Consumed by Task 5 (`daily-listening-tracker.ts`), Task 6 (`useTodaysFeaturedEpisode`), Task 8 (streak wiring).

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/local-date.test.ts
import { getLocalDateString } from "./local-date";

describe("getLocalDateString", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("uses the local calendar date, not UTC's — the exact bug this function exists to avoid", () => {
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14 — always ahead of UTC
    const date = new Date("2026-01-01T23:00:00.000Z"); // still Jan 1 in UTC...
    expect(date.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(getLocalDateString(date)).toBe("2026-01-02"); // ...but already Jan 2 locally
  });

  it("matches toISOString's date when local and UTC agree", () => {
    process.env.TZ = "UTC";
    const date = new Date("2026-06-15T12:00:00.000Z");
    expect(getLocalDateString(date)).toBe(date.toISOString().slice(0, 10));
  });

  it("pads single-digit months and days", () => {
    process.env.TZ = "UTC";
    const date = new Date("2026-03-05T00:00:00.000Z");
    expect(getLocalDateString(date)).toBe("2026-03-05");
  });

  it("defaults to the current date when called with no argument", () => {
    process.env.TZ = "UTC";
    expect(getLocalDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && npx jest local-date.test.ts
```

Expected: FAIL — `local-date.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/lib/local-date.ts

// "Today" for every feature that needs it (streaks, the daily featured
// episode) is always the user's own local calendar date — never UTC,
// never Date.prototype.toISOString() (which is UTC and would silently
// misattribute sessions near local midnight for users outside UTC).
// See docs/superpowers/specs/2026-09-22-daily-engagement-design.md's
// "Timezone handling" section for the full reasoning.
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && npx jest local-date.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/local-date.ts apps/mobile/src/lib/local-date.test.ts
git commit -m "Prompt 13B: add getLocalDateString, the shared client-local-date utility"
```

---

### Task 5: `daily-listening-tracker.ts` — day-scoped listening accumulator

**Files:**

- Create: `apps/mobile/src/lib/daily-listening-tracker.ts`
- Test: `apps/mobile/src/lib/daily-listening-tracker.test.ts`

**Interfaces:**

- Consumes: `getLocalDateString` (Task 4).
- Produces: `recordListeningTick(seconds: number): boolean` — call once per playback tick; returns `true` exactly once per local date, the moment accumulated listening first crosses 300s. Also exports the pure `applyListeningTick` for testing. Consumed by Task 8.

The file-I/O wrapper (`readState`/`writeState`, using `expo-file-system`'s `File`/`Paths`) stays untested — this codebase has no `expo-file-system` mocking anywhere (confirmed: `local-listening-progress.test.ts` only tests its pure `resolveResumePosition`, never its File-backed functions). The actual day-rollover/threshold decision logic is extracted into a pure `applyListeningTick` function specifically so it CAN be tested without that missing infrastructure — mirroring the `resolveResumePosition` precedent exactly.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/daily-listening-tracker.test.ts
import { applyListeningTick, type TrackerState } from "./daily-listening-tracker";

const emptyState: TrackerState = {
  date: "2026-09-01",
  accumulatedSeconds: 0,
  recordedForDate: false,
};

describe("applyListeningTick", () => {
  it("accumulates seconds without crossing the threshold", () => {
    const { nextState, crossedThreshold } = applyListeningTick(emptyState, "2026-09-01", 100);
    expect(nextState).toEqual({
      date: "2026-09-01",
      accumulatedSeconds: 100,
      recordedForDate: false,
    });
    expect(crossedThreshold).toBe(false);
  });

  it("crosses the threshold exactly at 300 accumulated seconds", () => {
    const state: TrackerState = {
      date: "2026-09-01",
      accumulatedSeconds: 285,
      recordedForDate: false,
    };
    const { nextState, crossedThreshold } = applyListeningTick(state, "2026-09-01", 15);
    expect(crossedThreshold).toBe(true);
    expect(nextState).toEqual({
      date: "2026-09-01",
      accumulatedSeconds: 300,
      recordedForDate: true,
    });
  });

  it("does not re-fire once already recorded for the date", () => {
    const state: TrackerState = {
      date: "2026-09-01",
      accumulatedSeconds: 300,
      recordedForDate: true,
    };
    const { nextState, crossedThreshold } = applyListeningTick(state, "2026-09-01", 15);
    expect(crossedThreshold).toBe(false);
    expect(nextState).toEqual(state);
  });

  it("resets the accumulator on a local-date rollover", () => {
    const state: TrackerState = {
      date: "2026-09-01",
      accumulatedSeconds: 290,
      recordedForDate: false,
    };
    const { nextState, crossedThreshold } = applyListeningTick(state, "2026-09-02", 10);
    expect(crossedThreshold).toBe(false);
    expect(nextState).toEqual({
      date: "2026-09-02",
      accumulatedSeconds: 10,
      recordedForDate: false,
    });
  });

  it("resets recordedForDate on rollover even if yesterday had already crossed the threshold", () => {
    const state: TrackerState = {
      date: "2026-09-01",
      accumulatedSeconds: 600,
      recordedForDate: true,
    };
    const { nextState, crossedThreshold } = applyListeningTick(state, "2026-09-02", 15);
    expect(crossedThreshold).toBe(false);
    expect(nextState).toEqual({
      date: "2026-09-02",
      accumulatedSeconds: 15,
      recordedForDate: false,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && npx jest daily-listening-tracker.test.ts
```

Expected: FAIL — `daily-listening-tracker.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/lib/daily-listening-tracker.ts
import { File, Paths } from "expo-file-system";

import { getLocalDateString } from "@/lib/local-date";

const THRESHOLD_SECONDS = 300;

export type TrackerState = {
  date: string;
  accumulatedSeconds: number;
  recordedForDate: boolean;
};

const trackerFile = new File(Paths.document, "daily-listening-tracker.json");

// Pure decision logic, kept separate from the file I/O below so it can
// be unit tested directly — see this file's Interfaces note on why the
// I/O functions themselves stay untested.
export function applyListeningTick(
  state: TrackerState,
  today: string,
  seconds: number,
): { nextState: TrackerState; crossedThreshold: boolean } {
  const current =
    state.date === today ? state : { date: today, accumulatedSeconds: 0, recordedForDate: false };
  if (current.recordedForDate) {
    return { nextState: current, crossedThreshold: false };
  }
  const accumulatedSeconds = current.accumulatedSeconds + seconds;
  const crossedThreshold = accumulatedSeconds >= THRESHOLD_SECONDS;
  return {
    nextState: { date: today, accumulatedSeconds, recordedForDate: crossedThreshold },
    crossedThreshold,
  };
}

function readState(): TrackerState {
  const today = getLocalDateString();
  if (!trackerFile.exists) {
    return { date: today, accumulatedSeconds: 0, recordedForDate: false };
  }
  try {
    const parsed = JSON.parse(trackerFile.textSync()) as Partial<TrackerState>;
    if (
      typeof parsed.date === "string" &&
      typeof parsed.accumulatedSeconds === "number" &&
      typeof parsed.recordedForDate === "boolean"
    ) {
      return {
        date: parsed.date,
        accumulatedSeconds: parsed.accumulatedSeconds,
        recordedForDate: parsed.recordedForDate,
      };
    }
    return { date: today, accumulatedSeconds: 0, recordedForDate: false };
  } catch {
    return { date: today, accumulatedSeconds: 0, recordedForDate: false };
  }
}

function writeState(state: TrackerState): void {
  if (!trackerFile.exists) {
    trackerFile.create();
  }
  trackerFile.write(JSON.stringify(state));
}

/**
 * Call once per playback tick while audio is actually playing (the
 * caller is responsible for only calling this while status.playing is
 * true). Returns true exactly once per local date — the moment
 * accumulated listening first crosses the 5-minute threshold — so the
 * caller knows to fire record_listening_day() exactly once.
 */
export function recordListeningTick(seconds: number): boolean {
  const { nextState, crossedThreshold } = applyListeningTick(
    readState(),
    getLocalDateString(),
    seconds,
  );
  writeState(nextState);
  return crossedThreshold;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && npx jest daily-listening-tracker.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/daily-listening-tracker.ts apps/mobile/src/lib/daily-listening-tracker.test.ts
git commit -m "Prompt 13B: add daily-listening-tracker with tested day-rollover/threshold logic"
```

---

### Task 6: `useTodaysFeaturedEpisode` + "Tonight at the Fireside" Home card

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-todays-featured-episode.ts`
- Modify: `apps/mobile/src/app/(app)/(tabs)/index.tsx`

**Interfaces:**

- Consumes: `daily_featured_episodes` table (Task 1), `getLocalDateString` (Task 4), `QueueEpisode` type (from `@/stores/player-store`).
- Produces: `useTodaysFeaturedEpisode()` returning a `useQuery` result whose `data` is `FeaturedEpisode | null`. Consumed only by this task's own Home card (no other task depends on it).

- [ ] **Step 1: Write the hook**

```ts
// apps/mobile/src/hooks/queries/use-todays-featured-episode.ts
import { useQuery } from "@tanstack/react-query";

import { getLocalDateString } from "@/lib/local-date";
import { supabase } from "@/lib/supabase";
import type { QueueEpisode } from "@/stores/player-store";
import type { AccessTier, ContentSource } from "@/types/content";

export type FeaturedEpisode = {
  id: string;
  title: string;
  durationSeconds: number | null;
  queueEpisode: QueueEpisode;
};

type EpisodeCandidateRow = {
  id: string;
  title: string;
  episode_number: number;
  duration_seconds: number | null;
  access_tier: AccessTier;
  coin_price: number;
  content_source: ContentSource;
  series_id: string;
  series: { title: string; cover_image_url: string | null } | null;
};

type OverrideRow = { episode_id: string };

// Deterministic, pure, and intentionally simple — this only needs to
// pick the same episode all day for a given local date, not cryptographic
// distribution quality.
function hashStringToIndex(seed: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

function toFeaturedEpisode(
  row: EpisodeCandidateRow & { series: NonNullable<EpisodeCandidateRow["series"]> },
): FeaturedEpisode {
  return {
    id: row.id,
    title: row.title,
    durationSeconds: row.duration_seconds,
    queueEpisode: {
      id: row.id,
      title: row.title,
      episodeNumber: row.episode_number,
      durationSeconds: row.duration_seconds,
      accessTier: row.access_tier,
      coinPrice: row.coin_price,
      contentSource: row.content_source,
      resumePositionSeconds: null,
      seriesId: row.series_id,
      seriesTitle: row.series.title,
      coverImageUrl: row.series.cover_image_url,
    },
  };
}

export function useTodaysFeaturedEpisode() {
  const localDate = getLocalDateString();

  return useQuery({
    queryKey: ["home", "todays-featured-episode", localDate],
    queryFn: async (): Promise<FeaturedEpisode | null> => {
      const { data: overrideRow, error: overrideError } = await supabase
        .from("daily_featured_episodes")
        .select("episode_id")
        .eq("feature_date", localDate)
        .maybeSingle()
        .returns<OverrideRow | null>();
      if (overrideError) {
        throw overrideError;
      }

      // Fetch every published, free episode — this project's content
      // tables are small at current scale (same reasoning already
      // applied to Prompt 13's global search), so one unfiltered fetch
      // is simpler than a second targeted query, and it naturally
      // handles an override row that points at a non-free/unpublished
      // episode: that id just won't appear in this list, and the code
      // below falls back to auto-rotation.
      const { data: candidates, error: candidatesError } = await supabase
        .from("episodes")
        .select(
          "id, title, episode_number, duration_seconds, access_tier, coin_price, content_source, series_id, series(title, cover_image_url)",
        )
        .eq("status", "published")
        .eq("access_tier", "free")
        .order("id", { ascending: true })
        .returns<EpisodeCandidateRow[]>();
      if (candidatesError) {
        throw candidatesError;
      }

      const playable = candidates.filter(
        (
          row,
        ): row is EpisodeCandidateRow & { series: NonNullable<EpisodeCandidateRow["series"]> } =>
          row.series !== null,
      );
      if (playable.length === 0) {
        return null;
      }

      const overridden = overrideRow
        ? playable.find((row) => row.id === overrideRow.episode_id)
        : undefined;
      const picked = overridden ?? playable[hashStringToIndex(localDate, playable.length)]!;

      return toFeaturedEpisode(picked);
    },
  });
}
```

- [ ] **Step 2: Add the Home card**

Modify `apps/mobile/src/app/(app)/(tabs)/index.tsx`. Add to the existing `"react-native"` import (currently `RefreshControl, ScrollView, StyleSheet, View`):

```tsx
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
```

Add new imports alongside the existing ones:

```tsx
import { Card } from "@/components/ui/card";
import { formatDuration } from "@/lib/format-duration";
import { useTodaysFeaturedEpisode } from "@/hooks/queries/use-todays-featured-episode";
import { usePlayerStore } from "@/stores/player-store";
```

Add this component above `export default function HomeScreen()`:

```tsx
function FeaturedEpisodeCard() {
  const featured = useTodaysFeaturedEpisode();
  const playQueue = usePlayerStore((state) => state.playQueue);

  if (featured.isLoading) {
    return <Skeleton width="100%" height={100} />;
  }
  if (!featured.data) {
    return null; // no published free episodes exist yet — nothing to feature
  }

  const episode = featured.data;

  return (
    <Pressable
      onPress={() => {
        void playQueue([episode.queueEpisode], 0);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Play tonight's story: ${episode.title}`}
    >
      <Card style={styles.featuredCard}>
        <ThemedText type="small" themeColor="accent">
          🔥 Tonight at the Fireside
        </ThemedText>
        <ThemedText type="subtitle">{episode.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDuration(episode.durationSeconds)}
        </ThemedText>
      </Card>
    </Pressable>
  );
}
```

Inside `HomeScreen`'s returned JSX, insert `<FeaturedEpisodeCard />` immediately after `<TabHeader title="Home" />` and before `<SectionHeader title="Featured" />`.

Add to the `styles` `StyleSheet.create` object:

```tsx
featuredCard: {
  gap: Spacing.one,
},
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/hooks/queries/use-todays-featured-episode.ts apps/mobile/src/app/\(app\)/\(tabs\)/index.tsx
git commit -m "Prompt 13B: add Tonight at the Fireside card to Home"
```

---

### Task 7: `daily-engagement-store.ts`

**Files:**

- Create: `apps/mobile/src/stores/daily-engagement-store.ts`

**Interfaces:**

- Produces: `useDailyEngagementStore()` — `{ streakMilestone: number | null, pendingQuizEpisode: { id: string, title: string } | null, dismissStreakMilestone: () => void, dismissPendingQuizEpisode: () => void }`. Consumed by Task 8 (sets `streakMilestone`), Task 9 (`<StreakMilestoneToast>` reads/dismisses it), Task 10 (sets `pendingQuizEpisode`), Task 11 (`<QuizPromptSheet>` reads/dismisses it).

- [ ] **Step 1: Write the store**

```ts
// apps/mobile/src/stores/daily-engagement-store.ts
import { create } from "zustand";

type PendingQuizEpisode = { id: string; title: string };

type DailyEngagementState = {
  streakMilestone: number | null;
  pendingQuizEpisode: PendingQuizEpisode | null;
  dismissStreakMilestone: () => void;
  dismissPendingQuizEpisode: () => void;
};

// Two small, finish-triggered pieces of UI state that both originate
// from AudioStatusDriver's didJustFinish/15s-tick handling — kept in
// one small store rather than two, mirroring player-store's own
// toastMessage/dismissToast shape but separate from it since neither
// field is playback state.
export const useDailyEngagementStore = create<DailyEngagementState>((set) => ({
  streakMilestone: null,
  pendingQuizEpisode: null,
  dismissStreakMilestone: () => set({ streakMilestone: null }),
  dismissPendingQuizEpisode: () => set({ pendingQuizEpisode: null }),
}));
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/stores/daily-engagement-store.ts
git commit -m "Prompt 13B: add daily-engagement-store for streak milestone and quiz prompt state"
```

---

### Task 8: Wire streak recording into `audio-status-driver.tsx`'s 15s tick

**Files:**

- Modify: `apps/mobile/src/components/audio-status-driver.tsx`

**Interfaces:**

- Consumes: `recordListeningTick` (Task 5), `getLocalDateString` (Task 4), `record_listening_day` RPC (Task 2), `daily-engagement-store` (Task 7).
- Produces: `daily-engagement-store`'s `streakMilestone` field gets set on a 7/30/100-day milestone. Consumed by Task 9.

- [ ] **Step 1: Add new imports**

In `apps/mobile/src/components/audio-status-driver.tsx`, add these imports after the existing `import { audioPlayer } from "@/lib/audio-player";` line:

```ts
import { recordListeningTick } from "@/lib/daily-listening-tracker";
import { getLocalDateString } from "@/lib/local-date";
```

Add these imports after the existing `import { requestNotificationPermissionAndRegister } from "@/lib/push-token-registration";` line:

```ts
import { supabase } from "@/lib/supabase";
import { useDailyEngagementStore } from "@/stores/daily-engagement-store";
```

- [ ] **Step 2: Add the streak-recording helper, above `export function AudioStatusDriver()`**

```ts
const STREAK_MILESTONES = new Set([7, 30, 100]);

type StreakRow = { current_streak: number };

async function recordStreakDay(): Promise<void> {
  const { data, error } = await supabase
    .rpc("record_listening_day", { p_local_date: getLocalDateString() })
    .returns<StreakRow>()
    .single();
  if (error) {
    console.error("record_listening_day error:", error);
    return;
  }
  if (STREAK_MILESTONES.has(data.current_streak)) {
    useDailyEngagementStore.setState({ streakMilestone: data.current_streak });
  }
}
```

- [ ] **Step 3: Replace the 15-second save-tick effect**

Find this existing block:

```tsx
// 15-second save tick — a stable interval reading the latest status via
// a ref, so it isn't torn down and rebuilt on every ~500ms status
// update.
useEffect(() => {
  const interval = setInterval(() => saveProgressRef.current(), 15000);
  return () => clearInterval(interval);
}, []);
```

Replace it with:

```tsx
// 15-second tick — saves progress, and (signed-in users only)
// accumulates today's listening time toward the streak threshold. A
// stable interval reading the latest status via a ref, so it isn't
// torn down and rebuilt on every ~500ms status update.
useEffect(() => {
  const interval = setInterval(() => {
    saveProgressRef.current();
    if (userIdRef.current && statusRef.current.playing) {
      const crossedThreshold = recordListeningTick(15);
      if (crossedThreshold) {
        void recordStreakDay();
      }
    }
  }, 15000);
  return () => clearInterval(interval);
}, []);
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/audio-status-driver.tsx
git commit -m "Prompt 13B: record daily listening toward streaks from the 15s save tick"
```

---

### Task 9: `useStreak` hook, flame UI on Home/Profile, `<StreakMilestoneToast>`

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-streak.ts`
- Create: `apps/mobile/src/components/streak-milestone-toast.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/index.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/profile.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: `listener_streaks` table (Task 2, via its own owner-select RLS), `daily-engagement-store`'s `streakMilestone` (Task 7, set by Task 8).
- Produces: `useStreak()` returning `{ currentStreak: number, longestStreak: number } | null | undefined`.

- [ ] **Step 1: Write `useStreak`**

```ts
// apps/mobile/src/hooks/queries/use-streak.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export type Streak = { currentStreak: number; longestStreak: number };

type StreakRow = { current_streak: number; longest_streak: number };

export function useStreak() {
  const session = useAuthStore((state) => state.session);

  return useQuery({
    queryKey: ["streak", session?.user.id ?? null],
    enabled: session !== null,
    queryFn: async (): Promise<Streak> => {
      if (!session) {
        return { currentStreak: 0, longestStreak: 0 };
      }
      const { data, error } = await supabase
        .from("listener_streaks")
        .select("current_streak, longest_streak")
        .eq("user_id", session.user.id)
        .maybeSingle()
        .returns<StreakRow | null>();
      if (error) {
        throw error;
      }
      if (!data) {
        return { currentStreak: 0, longestStreak: 0 };
      }
      return { currentStreak: data.current_streak, longestStreak: data.longest_streak };
    },
  });
}
```

- [ ] **Step 2: Write `<StreakMilestoneToast>`**

```tsx
// apps/mobile/src/components/streak-milestone-toast.tsx
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { Spacing } from "@/constants/theme";
import { useDailyEngagementStore } from "@/stores/daily-engagement-store";

export function StreakMilestoneToast() {
  const streakMilestone = useDailyEngagementStore((state) => state.streakMilestone);
  const dismissStreakMilestone = useDailyEngagementStore((state) => state.dismissStreakMilestone);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (streakMilestone === null) {
      return;
    }
    const timeout = setTimeout(dismissStreakMilestone, 4000);
    return () => clearTimeout(timeout);
  }, [streakMilestone, dismissStreakMilestone]);

  if (streakMilestone === null) {
    return null;
  }

  return (
    <Card style={[styles.card, { top: insets.top + Spacing.two }]}>
      <ThemedText type="small">🔥 {streakMilestone}-day streak! Keep showing up.</ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: Spacing.three,
    right: Spacing.three,
  },
});
```

- [ ] **Step 3: Mount it in `(app)/_layout.tsx`**

Add the import alongside the existing `PlaybackToast` import:

```tsx
import { StreakMilestoneToast } from "@/components/streak-milestone-toast";
```

Add `<StreakMilestoneToast />` alongside the existing `<PlaybackToast />` in the returned JSX:

```tsx
        <MiniPlayer />
        <UnlockSheet />
        <PlaybackToast />
        <StreakMilestoneToast />
        <NowPlayingOverlay />
```

- [ ] **Step 4: Add the flame to Home**

In `apps/mobile/src/app/(app)/(tabs)/index.tsx`, add the import:

```tsx
import { useStreak } from "@/hooks/queries/use-streak";
```

Inside `HomeScreen`, add `const streak = useStreak();` alongside the other query calls (e.g. next to `const featuredSeries = useFeaturedSeries();`). Insert this immediately after `<TabHeader title="Home" />` and before `<FeaturedEpisodeCard />` (from Task 6):

```tsx
{
  streak.data && streak.data.currentStreak > 0 ? (
    <ThemedText type="small" themeColor="accent">
      🔥 {streak.data.currentStreak}-day streak
    </ThemedText>
  ) : null;
}
```

- [ ] **Step 5: Add the flame to Profile**

In `apps/mobile/src/app/(app)/(tabs)/profile.tsx`, add the import:

```tsx
import { useStreak } from "@/hooks/queries/use-streak";
```

Inside `ProfileScreen`, add `const streak = useStreak();` alongside `const profileQuery = useProfile();`. Inside the existing `{!guestMode ? (<ThemedView style={styles.coinsSection}>...)}` block, add this right after the existing premium-status `<ThemedText>` and before the `<Button label={profile?.isPremium ...}>`:

```tsx
{
  streak.data && streak.data.currentStreak > 0 ? (
    <ThemedText type="small" themeColor="accent">
      🔥 {streak.data.currentStreak}-day streak (longest: {streak.data.longestStreak})
    </ThemedText>
  ) : null;
}
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Verify the "never gate elder content" property, not just assume it**

The spec requires this be a checked property of the design, not a
re-derived assumption. Confirm by inspection, not by running anything:
grep for every reference to `listener_streaks`, `useStreak`,
`daily-engagement-store`, and `record_listening_day` across
`apps/mobile/src`, and confirm none of them appears anywhere in the
episode-access decision path — `resolveEpisodeSource`, the unlock flow
(`unlock-episode.ts`, `unlock-sheet.tsx`), or any `episodes`/`content_source`
filtering logic. Expected: zero matches outside this task's own files
(`use-streak.ts`, `streak-milestone-toast.tsx`, `daily-engagement-store.ts`,
`audio-status-driver.tsx`, and the Home/Profile screens' display-only
reads). Report the grep output confirming this rather than skipping the
check.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/hooks/queries/use-streak.ts apps/mobile/src/components/streak-milestone-toast.tsx apps/mobile/src/app/\(app\)/\(tabs\)/index.tsx apps/mobile/src/app/\(app\)/\(tabs\)/profile.tsx apps/mobile/src/app/\(app\)/_layout.tsx
git commit -m "Prompt 13B: add streak flame UI to Home/Profile and the milestone toast"
```

---

### Task 10: Quiz-existence check wired into `audio-status-driver.tsx`'s finish handler

**Files:**

- Create: `apps/mobile/src/lib/fetch-published-quiz.ts`
- Modify: `apps/mobile/src/components/audio-status-driver.tsx`

**Interfaces:**

- Consumes: `quizzes` table (Task 3), `daily-engagement-store` (Task 7).
- Produces: `fetchPublishedQuiz(episodeId: string): Promise<{ id: string } | null>`; `daily-engagement-store`'s `pendingQuizEpisode` field gets set when the just-finished episode has one. Consumed by Task 11.

- [ ] **Step 1: Write `fetchPublishedQuiz`**

```ts
// apps/mobile/src/lib/fetch-published-quiz.ts
import { supabase } from "@/lib/supabase";

export async function fetchPublishedQuiz(episodeId: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("quizzes")
    .select("id")
    .eq("episode_id", episodeId)
    .eq("is_published", true)
    .maybeSingle();
  if (error) {
    console.error("fetchPublishedQuiz error:", error);
    return null;
  }
  return data;
}
```

- [ ] **Step 2: Add the import**

In `apps/mobile/src/components/audio-status-driver.tsx`, add this import alongside the `local-date`/`daily-listening-tracker` imports added in Task 8:

```ts
import { fetchPublishedQuiz } from "@/lib/fetch-published-quiz";
```

- [ ] **Step 3: Modify the `didJustFinish` effect**

Find this existing block (unchanged since before Task 8, since Task 8 only touched the 15s-tick effect):

```tsx
// didJustFinish edges false -> true exactly once per track end.
const didJustFinishRef = useRef(false);
useEffect(() => {
  if (status.didJustFinish && !didJustFinishRef.current) {
    didJustFinishRef.current = true;
    if (userIdRef.current && !hasPromptedForNotifications()) {
      markPromptedForNotifications();
      void requestNotificationPermissionAndRegister(userIdRef.current);
    }
    if (sleepTimer.mode === "end-of-episode") {
      audioPlayer.pause();
      cancelSleepTimer();
    } else {
      void next();
    }
  } else if (!status.didJustFinish) {
    didJustFinishRef.current = false;
  }
}, [status.didJustFinish, sleepTimer.mode, next, cancelSleepTimer]);
```

Replace it with:

```tsx
// didJustFinish edges false -> true exactly once per track end.
const didJustFinishRef = useRef(false);
useEffect(() => {
  if (status.didJustFinish && !didJustFinishRef.current) {
    didJustFinishRef.current = true;
    const finishedEpisode = episodeRef.current;
    if (userIdRef.current && !hasPromptedForNotifications()) {
      markPromptedForNotifications();
      void requestNotificationPermissionAndRegister(userIdRef.current);
    }
    // Async and non-blocking — runs independently of the
    // auto-advance/sleep-timer logic below, so a slow or failed quiz
    // check never delays next-episode playback.
    if (userIdRef.current && finishedEpisode) {
      void fetchPublishedQuiz(finishedEpisode.id).then((quiz) => {
        if (quiz) {
          useDailyEngagementStore.setState({
            pendingQuizEpisode: { id: finishedEpisode.id, title: finishedEpisode.title },
          });
        }
      });
    }
    if (sleepTimer.mode === "end-of-episode") {
      audioPlayer.pause();
      cancelSleepTimer();
    } else {
      void next();
    }
  } else if (!status.didJustFinish) {
    didJustFinishRef.current = false;
  }
}, [status.didJustFinish, sleepTimer.mode, next, cancelSleepTimer]);
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/fetch-published-quiz.ts apps/mobile/src/components/audio-status-driver.tsx
git commit -m "Prompt 13B: check for a published quiz when an episode finishes"
```

---

### Task 11: `<QuizPromptSheet>`

**Files:**

- Create: `apps/mobile/src/components/quiz-prompt-sheet.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: `daily-engagement-store`'s `pendingQuizEpisode` (Task 7, set by Task 10).
- Produces: navigates to `/quiz/[episodeId]` on accept (route created by Task 12).

- [ ] **Step 1: Write `<QuizPromptSheet>`**

```tsx
// apps/mobile/src/components/quiz-prompt-sheet.tsx
import { useRouter } from "expo-router";
import { Modal, Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { Spacing } from "@/constants/theme";
import { useDailyEngagementStore } from "@/stores/daily-engagement-store";

export function QuizPromptSheet() {
  const router = useRouter();
  const pendingQuizEpisode = useDailyEngagementStore((state) => state.pendingQuizEpisode);
  const dismissPendingQuizEpisode = useDailyEngagementStore(
    (state) => state.dismissPendingQuizEpisode,
  );

  const handleTakeQuiz = () => {
    if (!pendingQuizEpisode) {
      return;
    }
    const episodeId = pendingQuizEpisode.id;
    dismissPendingQuizEpisode();
    router.push(`/quiz/${episodeId}`);
  };

  return (
    <Modal
      visible={pendingQuizEpisode !== null}
      transparent
      animationType="slide"
      onRequestClose={dismissPendingQuizEpisode}
    >
      <Pressable
        style={styles.backdrop}
        onPress={dismissPendingQuizEpisode}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={Spacing.two}
      >
        <ThemedView style={styles.sheet}>
          <ThemedText type="subtitle">Test yourself?</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            A few quick questions about {pendingQuizEpisode?.title}.
          </ThemedText>
          <Button label="Take the quiz" onPress={handleTakeQuiz} />
          <Button label="Skip" variant="ghost" onPress={dismissPendingQuizEpisode} />
        </ThemedView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  sheet: {
    padding: Spacing.four,
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    gap: Spacing.three,
  },
});
```

- [ ] **Step 2: Mount it in `(app)/_layout.tsx`**

Add the import alongside the existing `UnlockSheet` import:

```tsx
import { QuizPromptSheet } from "@/components/quiz-prompt-sheet";
```

Add `<QuizPromptSheet />` alongside the existing `<UnlockSheet />`:

```tsx
        <MiniPlayer />
        <UnlockSheet />
        <QuizPromptSheet />
        <PlaybackToast />
        <StreakMilestoneToast />
        <NowPlayingOverlay />
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors — `router.push('/quiz/...')` will not yet typecheck against Expo Router's generated route types until Task 12 creates the route file. If this step fails only on that line, proceed to Task 12 immediately before committing Task 11; do not treat it as a real regression.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/quiz-prompt-sheet.tsx apps/mobile/src/app/\(app\)/_layout.tsx
git commit -m "Prompt 13B: add QuizPromptSheet"
```

---

### Task 12: `/quiz/[episodeId]` screen

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-quiz-detail.ts`
- Create: `apps/mobile/src/app/(app)/quiz/[episodeId].tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: `quizzes`/`quiz_questions`/`quiz_attempts` tables (Task 3).
- Produces: the `/quiz/[episodeId]` route, navigated to from `<QuizPromptSheet>` (Task 11).

- [ ] **Step 1: Write `useQuizDetail` and `useSubmitQuizAttempt`**

```ts
// apps/mobile/src/hooks/queries/use-quiz-detail.ts
import { useMutation, useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
};

export type QuizDetail = {
  id: string;
  questions: QuizQuestion[];
};

type QuizRow = { id: string };
type QuestionRow = {
  id: string;
  question: string;
  options: unknown;
  correct_index: number;
  explanation: string | null;
  sort_order: number;
};

function parseOptions(options: unknown): string[] {
  return Array.isArray(options)
    ? options.filter((item): item is string => typeof item === "string")
    : [];
}

export function useQuizDetail(episodeId: string) {
  return useQuery({
    queryKey: ["quiz-detail", episodeId],
    enabled: Boolean(episodeId),
    queryFn: async (): Promise<QuizDetail | null> => {
      const { data: quizRow, error: quizError } = await supabase
        .from("quizzes")
        .select("id")
        .eq("episode_id", episodeId)
        .eq("is_published", true)
        .maybeSingle()
        .returns<QuizRow | null>();
      if (quizError) {
        throw quizError;
      }
      if (!quizRow) {
        return null;
      }

      const { data: questionRows, error: questionsError } = await supabase
        .from("quiz_questions")
        .select("id, question, options, correct_index, explanation, sort_order")
        .eq("quiz_id", quizRow.id)
        .order("sort_order", { ascending: true })
        .returns<QuestionRow[]>();
      if (questionsError) {
        throw questionsError;
      }

      return {
        id: quizRow.id,
        questions: questionRows.map((row) => ({
          id: row.id,
          question: row.question,
          options: parseOptions(row.options),
          correctIndex: row.correct_index,
          explanation: row.explanation,
        })),
      };
    },
  });
}

export function useSubmitQuizAttempt(quizId: string) {
  const session = useAuthStore((state) => state.session);

  const mutation = useMutation<void, Error, { score: number; total: number }>({
    mutationFn: async ({ score, total }) => {
      if (!session) {
        throw new Error("Not signed in");
      }
      const { error } = await supabase.from("quiz_attempts").insert({
        user_id: session.user.id,
        quiz_id: quizId,
        score,
        total,
      });
      if (error) {
        throw error;
      }
    },
  });

  return { submitAttempt: mutation.mutateAsync };
}
```

- [ ] **Step 2: Write the quiz screen**

```tsx
// apps/mobile/src/app/(app)/quiz/[episodeId].tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useQuizDetail, useSubmitQuizAttempt } from "@/hooks/queries/use-quiz-detail";

export default function QuizScreen() {
  const { episodeId } = useLocalSearchParams<{ episodeId: string }>();
  const router = useRouter();
  const query = useQuizDetail(episodeId);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const quizId = query.data?.id ?? "";
  const { submitAttempt } = useSubmitQuizAttempt(quizId);

  if (query.isError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <EmptyState
          title="Couldn't load the quiz"
          body="Please try again later."
          onRetry={() => query.refetch()}
        />
      </SafeAreaView>
    );
  }

  if (query.isLoading || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <Skeleton width="100%" height={200} />
      </SafeAreaView>
    );
  }

  const { questions } = query.data;
  const currentQuestion = questions[questionIndex];

  if (!currentQuestion) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <View style={styles.content}>
          <ThemedText type="title">
            {score} / {questions.length}
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            {submitted ? "Nice work!" : "Saving your score…"}
          </ThemedText>
          <Button label="Done" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const onSelect = (index: number) => {
    if (selectedIndex !== null) {
      return;
    }
    setSelectedIndex(index);
    if (index === currentQuestion.correctIndex) {
      setScore((current) => current + 1);
    }
  };

  const onNext = () => {
    const isLastQuestion = questionIndex === questions.length - 1;
    setSelectedIndex(null);
    if (isLastQuestion) {
      setSubmitted(true);
      void submitAttempt({ score, total: questions.length }).catch(() => {});
    }
    setQuestionIndex((current) => current + 1);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <View style={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          Question {questionIndex + 1} of {questions.length}
        </ThemedText>
        <ThemedText type="subtitle">{currentQuestion.question}</ThemedText>
        {currentQuestion.options.map((option, index) => {
          const isSelected = selectedIndex === index;
          const isCorrect = index === currentQuestion.correctIndex;
          const showFeedback = selectedIndex !== null;
          return (
            <Pressable
              key={option}
              onPress={() => onSelect(index)}
              disabled={selectedIndex !== null}
              style={styles.option}
              accessibilityRole="button"
              accessibilityLabel={option}
            >
              <ThemedText
                type="default"
                themeColor={
                  showFeedback && isCorrect
                    ? "success"
                    : showFeedback && isSelected && !isCorrect
                      ? "error"
                      : "primary"
                }
              >
                {option}
              </ThemedText>
            </Pressable>
          );
        })}
        {selectedIndex !== null ? (
          <>
            {currentQuestion.explanation ? (
              <ThemedText type="small" themeColor="textSecondary">
                {currentQuestion.explanation}
              </ThemedText>
            ) : null}
            <Button
              label={questionIndex === questions.length - 1 ? "See results" : "Next"}
              onPress={onNext}
            />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  option: {
    padding: Spacing.three,
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
  },
});
```

- [ ] **Step 3: Register the route**

In `apps/mobile/src/app/(app)/_layout.tsx`, add one line inside the `<Stack>`, immediately after the `search` screen entry:

```tsx
          <Stack.Screen name="search" options={{ headerShown: false }} />
          <Stack.Screen name="quiz/[episodeId]" options={{ headerShown: false }} />
```

- [ ] **Step 4: Regenerate Expo Router's route types**

Expo Router's typed routes (`apps/mobile/.expo/types/router.d.ts`) only regenerate while Metro is running. Start it briefly so `router.push('/quiz/...')` (Task 11) and this new route both typecheck:

```bash
cd apps/mobile
npx expo start --port 8099 --no-dev > /tmp/expo-start.log 2>&1 &
EXPO_PID=$!
sleep 20
kill $EXPO_PID 2>/dev/null
pkill -f "expo start --port 8099" 2>/dev/null
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors — this also confirms Task 11's `router.push('/quiz/...')` line is now valid.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/hooks/queries/use-quiz-detail.ts apps/mobile/src/app/\(app\)/quiz/\[episodeId\].tsx apps/mobile/src/app/\(app\)/_layout.tsx
git commit -m "Prompt 13B: add the quiz screen"
```

---

### Task 13: Teacher quiz-aggregate view in the existing class detail screen

**Files:**

- Modify: `apps/mobile/src/hooks/queries/use-class-detail.ts`
- Modify: `apps/mobile/src/app/(app)/learn/teacher/class/[id].tsx`

**Interfaces:**

- Consumes: `class_quiz_scores` RPC (Task 3).
- Produces: `AssignedEpisode` gains `quizAverageScore: number | null`, `quizAverageTotal: number | null`, `quizCompletionCount: number` — additive, does not change `class_episode_listen_counts`' existing integration or return shape (per this repo's standing constraint that `class_episode_listen_counts`'s return shape stays untouched, from Prompt 12).

- [ ] **Step 1: Extend `useClassDetail`**

In `apps/mobile/src/hooks/queries/use-class-detail.ts`, change the `AssignedEpisode` type:

```ts
export type AssignedEpisode = {
  episodeId: string;
  title: string;
  listenerCount: number;
  quizAverageScore: number | null;
  quizAverageTotal: number | null;
  quizCompletionCount: number;
};
```

Add a new row type alongside the existing `ListenCountRow`:

```ts
type QuizScoreRow = {
  episode_id: string;
  average_score: number | null;
  average_total: number | null;
  completion_count: number;
};
```

In `useClassDetail`'s `queryFn`, add a second RPC call alongside the existing `class_episode_listen_counts` call:

```ts
const { data: countRows, error: countError } = await supabase.rpc("class_episode_listen_counts", {
  p_class_id: classId,
});
if (countError) {
  throw countError;
}
const countsByEpisode = new Map(
  ((countRows ?? []) as ListenCountRow[]).map((row) => [row.episode_id, row.listener_count]),
);

const { data: quizScoreRows, error: quizScoreError } = await supabase.rpc("class_quiz_scores", {
  p_class_id: classId,
});
if (quizScoreError) {
  throw quizScoreError;
}
const quizScoresByEpisode = new Map(
  ((quizScoreRows ?? []) as QuizScoreRow[]).map((row) => [row.episode_id, row]),
);
```

Update the final `.map()` that builds `assignedEpisodes`:

```ts
        assignedEpisodes: assignmentRows
          .filter(
            (row): row is AssignmentRow & { episodes: { title: string } } => row.episodes !== null,
          )
          .map((row) => {
            const quizScore = quizScoresByEpisode.get(row.episode_id);
            return {
              episodeId: row.episode_id,
              title: row.episodes.title,
              listenerCount: countsByEpisode.get(row.episode_id) ?? 0,
              quizAverageScore: quizScore?.average_score ?? null,
              quizAverageTotal: quizScore?.average_total ?? null,
              quizCompletionCount: quizScore?.completion_count ?? 0,
            };
          }),
```

- [ ] **Step 2: Render it in the class detail screen**

In `apps/mobile/src/app/(app)/learn/teacher/class/[id].tsx`, find:

```tsx
assignedEpisodes.map((episode) => (
  <View key={episode.episodeId} style={styles.episodeRow}>
    <ThemedText type="default">{episode.title}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">
      {episode.listenerCount} listened
    </ThemedText>
  </View>
));
```

Replace it with:

```tsx
assignedEpisodes.map((episode) => (
  <View key={episode.episodeId} style={styles.episodeRow}>
    <ThemedText type="default">{episode.title}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">
      {episode.listenerCount} listened
    </ThemedText>
    <ThemedText type="small" themeColor="textSecondary">
      {episode.quizCompletionCount > 0
        ? `Quiz avg: ${episode.quizAverageScore?.toFixed(1)}/${episode.quizAverageTotal?.toFixed(1)} (${episode.quizCompletionCount} completed)`
        : "No quiz completions yet"}
    </ThemedText>
  </View>
));
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/hooks/queries/use-class-detail.ts apps/mobile/src/app/\(app\)/learn/teacher/class/\[id\].tsx
git commit -m "Prompt 13B: add quiz-aggregate view to the teacher class detail screen"
```

---

### Task 14: `docs/content-craft.md` and the `docs/known-issues.md` entry

**Files:**

- Create: `docs/content-craft.md`
- Modify: `docs/known-issues.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Write `docs/content-craft.md`**

```markdown
# Content Craft Guide

Writing guidance for Village Fireside episodes — not a technical spec.

## Episode structure

- **Hook in the first 30 seconds.** A listener decides whether to keep
  going almost immediately; don't spend the opening on scene-setting
  they haven't earned yet.
- **One story thread per episode.** Don't braid two plots — this is
  audio, listened to in the car or before bed, not read with a page to
  flip back to.
- **End on a question or an unresolved moment (a cliffhanger) — except
  elder testimony**, which ends naturally and respectfully. An elder's
  own telling of their life or their people's history isn't a narrative
  device to be left hanging for engagement; it closes the way the elder
  closes it.

## Episode length targets

- **Entertainment content:** 8–15 minutes.
- **Learn content:** 5–8 minutes — shorter, because it's built to be
  used inside a class period alongside its quiz, not as a standalone
  listen.

## Quizzes

Every Learn episode ships with its quiz. See `docs/education.md` for
how Learn content is organized by subject and grade level, and the
Prompt 13B implementation for how the quiz flow itself works
(`docs/superpowers/specs/2026-09-22-daily-engagement-design.md`).
```

- [ ] **Step 2: Add the `docs/known-issues.md` entry**

Append under the `## Mobile` heading, following the file's established per-entry format (heading, description, `**Fix shape:**`, `**Severity:**`):

```markdown
### No scheduled sender for the "Tonight at the Fireside" evening notification

Prompt 13B's "Tonight at the Fireside" makes a daily featured episode a
real, queryable fact (`daily_featured_episodes` plus deterministic
auto-rotation, in `apps/mobile/src/hooks/queries/use-todays-featured-episode.ts`),
but nothing sends the evening push notification the prompt pack
describes. No scheduler and no Prompt 15 admin-dashboard trigger exist
yet — the same gap Prompt 13 documented for its own push-notification
send path, for the same reason (Prompt 15's admin dashboard doesn't
exist yet). If/when a notification with an `episodeId` payload does
arrive, Prompt 13's existing tap-to-deep-link listener
(`apps/mobile/src/hooks/use-push-notification-listeners.ts`) already
handles it generically — no new client code is needed there.

**Fix shape:** needs a scheduled job (e.g. a cron-triggered edge
function) that reads today's featured episode and sends via the same
`push_tokens`-based mechanism Prompt 15 will build for its own sender —
likely built alongside Prompt 15 rather than as separate infrastructure.

**Severity:** Low today (no real notifications are sent for anything
yet). Becomes a real gap once Prompt 15's sender exists and this
feature is expected to use it.
```

- [ ] **Step 3: Commit**

```bash
git add docs/content-craft.md docs/known-issues.md
git commit -m "Prompt 13B: add docs/content-craft.md and known-issues entry for the missing notification sender"
```
