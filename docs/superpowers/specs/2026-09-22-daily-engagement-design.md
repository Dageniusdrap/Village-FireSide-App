# Daily Engagement: Today's Story, Streaks & Quizzes (Prompt 13B) — Design Spec

## Scope

Per `docs/PROMPT_PACK.md`'s Prompt 13B — three engagement subsystems and
one doc, built as one spec and one plan (matching Prompt 13's own
precedent: this project treats one `PROMPT_PACK.md` prompt as one
design/plan/implementation unit even when it spans multiple
subsystems):

- **"Tonight at the Fireside"** — a daily featured free episode, shown
  as a card at the top of Home, admin-hand-pickable or auto-rotated.
- **Listening streaks** — a lightweight, dignified "days you showed up"
  counter with a once-a-week protected miss (the "streak ember").
- **Episode quizzes** — a skippable "Test yourself" after finishing an
  episode that has one, plus a teacher-facing aggregate view reusing
  Prompt 12's existing class detail screen.
- **`docs/content-craft.md`** — a writing guide, no code.

**Non-goals (explicitly deferred, matching Prompt 13's own precedent
for its push-notification send trigger):**

- **The evening push notification send mechanism for "Tonight at the
  Fireside."** No scheduler and no Prompt 15 admin-dashboard trigger
  exist yet (confirmed: `apps/admin/src` still has only auth scaffolding
  and the `teacher-requests` route). This prompt makes "today's featured
  episode" a real, queryable fact; nothing sends a scheduled notification
  about it yet. If/when a notification with an `episodeId` payload does
  arrive, Prompt 13's existing tap-to-deep-link listener already handles
  it generically — no new client code needed there.
- **Admin quiz-builder UI** and **admin daily-episode-override UI.**
  Both need `apps/admin`'s content-management pages, which are Prompt
  14's job and don't exist yet. This prompt builds the data layer
  (tables, RLS, RPCs) so Prompt 14 can wire a UI onto them later; quiz
  and daily-featured-episode content is added via direct SQL for now,
  the same way every other table's content is added today (no seed
  data exists anywhere in this project yet — confirmed, `supabase/`
  has no `seed.sql`).

## New dependencies

None. No new npm packages — the flame/quiz UI uses existing `Pressable`/
`ThemedText` primitives and emoji glyphs, matching how Prompt 13's
`TabHeader` used a 🔍 glyph rather than an icon library.

## Timezone handling — read this before the data layer below

**"Today" is the user's local calendar date, computed client-side —
never the database server's (UTC) clock, and never
`Date.prototype.toISOString()`.** This spans EAT (Uganda/Kenya/Tanzania,
UTC+3), CAT (Rwanda, UTC+2), and diaspora timezones (the app's own
"real-world work" notes in `PROMPT_PACK.md` name diaspora marketing as a
later-stage goal). A single server/UTC "today" would misattribute
listening sessions near local midnight — a Ugandan listener at 00:15
local time is still 21:15 UTC the _previous_ day — silently breaking a
real "I listened every night before bed" streak. This is exactly the
kind of boundary bug that generates support complaints, not a
theoretical edge case.

A new shared utility, `apps/mobile/src/lib/local-date.ts`, exposes
`getLocalDateString(): string` — built from `Date`'s local accessors
(`getFullYear()`, `getMonth()`, `getDate()`), explicitly not
`toISOString().slice(0, 10)`, which is UTC and would silently
reintroduce the exact bug this section exists to avoid. Both the
streak tracker (below) and the daily-featured-episode lookup use this
one function — one date utility, not two independently-written ones
that could drift.

**This trusts the client's clock for a value the server can't
independently verify.** That is an examined, deliberate extension of
trust, not an oversight — the same class of trust this codebase already
extends to client-reported `position_seconds` in `listening_progress`
(Prompt 8's design; no server-side audio telemetry exists to verify
it). A streak has the explicit design constraint that it must **never**
gate or gamify content access (see "Streaks" below), so a self-inflated
streak has zero access or monetary consequence — the same risk class as
editing a single-player game's local save file. `record_listening_day`
(below) still adds one cheap defensive bound: it rejects a client date
more than 1 day outside the server's own UTC date, wide enough to cover
any real timezone offset (max ~14h) while catching an obviously
tampered or garbage value.

**One documented consequence, not silently glossed over:**
`daily_featured_episodes.feature_date` (an admin override, when Prompt
14 exists to set it) is a single global `date` key, but different users
resolve "today" against their own local date. A diaspora user in
California and a listener in Kampala can be in different calendar dates
for several hours around either's midnight, and so can see different
picks (admin override for one date, auto-rotation fallback for the
other) during that window. This is the same "each user's today is their
own" model applied consistently, not a bug — but it means "today's
featured episode" is not a single global fact, and any future admin UI
copy should say "today" without implying a single synchronized instant
worldwide.

## Data layer

### `daily_featured_episodes`

```sql
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

A dedicated table rather than an `app_settings` JSONB key — this is
date-keyed data (one row per day), which doesn't fit `app_settings`'
single-value-per-key shape, and gives Prompt 14 a plain `insert` to
implement "admin hand-picks today's episode" later, no new schema work
needed then.

**Client resolution (`useTodaysFeaturedEpisode()`):** look up
`daily_featured_episodes` by `getLocalDateString()`. If found, fetch
that episode. If not, deterministically pick from published,
`access_tier = 'free'` episodes ordered by `id`, indexing by a hash of
the local date string modulo the episode count — same episode all day
for a given user, changes exactly at their local midnight, no admin
dependency for the common (no override row) case.

### `listener_streaks` + `record_listening_day`

```sql
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
```

No owner `insert`/`update`/`delete` policy — all writes go through
`record_listening_day()` (`security definer`), the same "no client path
to mutate balance-like state directly" posture Prompt 9 established for
`coin_balance`, applied here because a directly-client-writable streak
would let a user set `current_streak` to any number outright (worse
than the date-trust tradeoff above, which only lets a user advance the
streak one real RPC call at a time).

```sql
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
  -- Defensive bound on the client-supplied date — see "Timezone
  -- handling" above. Wide enough for any real timezone offset (max
  -- ~14h), narrow enough to reject a tampered/garbage value.
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

`for update` row-locks the caller's own row for the duration of the
function, so two rapid calls (e.g. a retry) can't race each other into
double-incrementing — same reasoning Prompt 9 gives for locking balance
rows during coin spends, applied here even though the stakes are lower.

**Required live verification (goes into the implementation plan, not
skipped):** run `record_listening_day` against a real test user in the
live linked project, covering: (1) first-ever call — row doesn't exist
yet, expect `current_streak = 1`; (2) a same-day repeat call — no-op;
(3) a consecutive-day call — increment; (4) a one-day-gap call with no
prior ember spent — streak protected, `last_ember_spent_at` set; (5) a
one-day-gap call within 7 days of a previously spent ember — streak
resets to 1; (6) a 2+-day-gap call — resets to 1. Report the actual
returned rows for each case.

### Quizzes

```sql
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

-- Visibility mirrors episodes' own rule: public if the linked episode
-- is published, independent of the episode's access_tier/lock status —
-- quiz trivia isn't the monetized asset (episode audio is), the same
-- way an episode's title/description is publicly visible regardless of
-- whether it's locked.
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
```

No update/delete policy on `quiz_attempts` — each attempt is its own
row (a retake inserts a new row), matching `transactions`' append-only
posture, though for a much lower-stakes reason (no correction/refund
concept needed here).

```sql
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

Deliberately mirrors `class_episode_listen_counts` (Prompt 12)
structurally — same `teacher_id = auth.uid()` ownership check inside
the function body, same shape of joining `class_assignments` outward.
Feeds into Prompt 12's _existing_ `useClassDetail`/class-detail screen
(adds an optional quiz-aggregate field per assigned episode) rather
than a new screen — no student-facing quiz-taking screen exists inside
the teacher flow, matching how listen counts already work there.

## RLS summary

| Table                     | Policy                                              | Rule                                                                 |
| ------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| `daily_featured_episodes` | select anyone / admin all                           | public read; admin write                                             |
| `listener_streaks`        | select owner-only                                   | no client write path at all — only `record_listening_day` can mutate |
| `quizzes`                 | select if published+episode published / admin all   | public read gated on both flags; admin write                         |
| `quiz_questions`          | select if parent quiz+episode published / admin all | same gate, one join deeper                                           |
| `quiz_attempts`           | select+insert owner-only, no update/delete          | append-only per-attempt history                                      |

## "Tonight at the Fireside"

A card at the top of Home (`apps/mobile/src/app/(app)/(tabs)/index.tsx`,
above the existing "Featured" rail), driven by
`useTodaysFeaturedEpisode()`. Tapping it plays the episode directly
(same resolve-and-play path the rest of Home already uses). The evening
push notification is out of scope per "Non-goals" above — this prompt
only makes today's pick a real fact to notify about later.

## Streaks

- **Client accumulator:** `apps/mobile/src/lib/daily-listening-tracker.ts`
  (file-based, mirrors `search-history.ts`/`notification-permission-flag.ts`)
  tracks `{ date: string, accumulatedSeconds: number, recordedForDate: boolean }`,
  keyed by `getLocalDateString()`. A rollover to a new local date resets
  `accumulatedSeconds` and `recordedForDate`. This is genuinely pure,
  testable logic — gets a real Jest test file
  (`daily-listening-tracker.test.ts`), matching this codebase's actual
  TDD line (pure predicates get tests, e.g. `sleep-timer.test.ts`,
  `wifi-gate.test.ts`).
- **Wiring:** `audio-status-driver.tsx`'s existing 15s save interval
  (the one place already watching playback status) calls
  `recordListeningTick(15)` only when `status.playing` is true —
  approximate (not exact wall-clock precision) but adequate for an
  engagement stat, the same "not billing-grade, doesn't need to be"
  reasoning this codebase already applies elsewhere (e.g. haptics
  graceful-degradation in Prompt 13). When the accumulator first crosses
  300s for the current local date and `recordedForDate` is false, and a
  session exists (guests are skipped entirely — no `listening_progress`
  sync for guests either, per Prompt 8), call
  `supabase.rpc('record_listening_day', { p_local_date: getLocalDateString() })`
  once, then set `recordedForDate = true`.
- **Milestones:** compare the RPC's returned `current_streak` against
  `{7, 30, 100}` — an _exact_ match (not `>=`) fires a toast exactly
  once, via a new small `daily-engagement-store.ts` (mirrors
  `player-store`'s `toastMessage`/`dismissToast` shape, kept separate
  from `player-store` since it's unrelated to playback state) surfaced
  by a `<StreakMilestoneToast />` mounted in `(app)/_layout.tsx`
  alongside `PlaybackToast`.
- **UI:** a flame + count on Home (near the top, reading
  `listener_streaks` for the current user) and on Profile.
- **The "never gate elder content" rule** (from `PROMPT_PACK.md`) is
  satisfied by construction here, not by a runtime check — no code path
  in this design connects `listener_streaks` to any episode-access
  decision (`resolveEpisodeSource`, unlock logic, or RLS on `episodes`).
  Worth stating as a verified property of the design, not an assumption
  to re-derive later.

## Quizzes

- **Trigger:** on episode finish (`audio-status-driver.tsx`'s existing
  `didJustFinish` edge-detection), if a session exists, fire an async,
  non-blocking check for a published quiz on the finished episode. This
  runs independently of the existing auto-advance/sleep-timer logic —
  it does not delay or gate next-episode playback, avoiding new
  ordering complexity in an already-dense effect. If a quiz exists, set
  a `pendingQuizEpisode` field on the same new `daily-engagement-store.ts`
  (co-located with the streak-milestone toast state above — both are
  finish-triggered, low-ceremony additions to the same lifecycle moment,
  so one small store file covers both rather than two near-empty ones).
- **`<QuizPromptSheet>`:** mounted in `(app)/_layout.tsx` alongside
  `UnlockSheet`/`NowPlayingOverlay`, same Modal-over-store-field pattern
  as `UnlockSheet`. Offers a skippable "Test yourself," navigating to
  `/quiz/[episodeId]` on accept.
- **`/quiz/[episodeId]` screen:** fetches the quiz + questions (RLS
  already scopes to published), walks through 3-5 questions one at a
  time, instant feedback plus the explanation shown after each answer
  (per spec), and on completion inserts one `quiz_attempts` row with
  the final score, then shows a results summary.
- **Teacher view:** `useClassDetail` (Prompt 12) gains an optional
  quiz-aggregate field per assigned episode, sourced from
  `class_quiz_scores`, rendered in the existing class detail screen
  next to the existing listener count — no new screen.

## Known limitations

- **No evening notification sender** — see "Non-goals." Tracked as a
  `docs/known-issues.md` entry alongside this prompt's implementation,
  same shape as Prompt 13's push-notification-sender gap.
- **No admin UI for picking today's episode or building quizzes** — the
  data layer is ready for Prompt 14; content goes in via direct SQL
  until then.
- **Streak continuity trusts the client's local date**, bounded to
  ±1 day of server UTC — see "Timezone handling." Acceptable because a
  streak has zero access/monetary consequence by design.
- **The listening-accumulator's 15s granularity is approximate**, not
  exact wall-clock precision — acceptable for an engagement stat, not a
  billing figure.

## Testing

- `daily-listening-tracker.ts`: real Jest test file — day-rollover,
  threshold-crossing (crosses 300s exactly once per local date), and
  the `recordedForDate` guard against double-firing.
- `local-date.ts`'s `getLocalDateString()`: real Jest test file — must
  cover that it does NOT match `toISOString()`'s UTC date under a
  mocked timezone/offset (the specific bug this whole design section
  exists to avoid), so a regression here fails loudly.
- `record_listening_day`: no automated SQL test exists (this repo has
  no Postgres test runner yet — that's Prompt 19). **Required live
  verification step**, not optional — see the six cases listed under
  "Data layer" above, run against the real linked project, actual
  returned rows reported.
- `class_quiz_scores`: same live-verification treatment as
  `class_episode_listen_counts` needed for its own check in Prompt 12
  — confirm it returns correct aggregates for a seeded class/quiz once
  test data exists (may need to be a manual step performed with
  temporary test rows, rolled back afterward, given no seed data exists
  yet).
- Query hooks and screens: untested, matching this codebase's
  established, confirmed precedent (no test file exists for any
  `use-*.ts` query hook or screen component anywhere in this app).

## Documentation

- `docs/known-issues.md` gains one new entry: no scheduled sender for
  the "Tonight at the Fireside" evening notification.
- `docs/content-craft.md` — new file, the writing guide per
  `PROMPT_PACK.md`'s Prompt 13B text: hook in the first 30 seconds, one
  story thread, cliffhanger ending except elder testimony (which ends
  naturally and respectfully), episode length targets (8-15 min
  entertainment, 5-8 min Learn content), every Learn episode ships with
  its quiz.
