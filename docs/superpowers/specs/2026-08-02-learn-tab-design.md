# Learn Tab (Prompt 12) — Design Spec

## Scope

The Learn tab, per `docs/PROMPT_PACK.md`'s Prompt 12 — the v1 school
pilot feature set:

- Student browsing by `subject_area` (History, Biology, Geography,
  Culture, Conservation, Folklore) and `grade_level`, with
  `syllabus_topic` chips for quick filtering and a cultural-group
  filter gated per-country.
- History gets a "True African History" section featuring
  `elder_testimony` content first.
- Teacher features: a "Request teacher account" flow, Classes with
  shareable join codes, episode assignments, and per-episode listen
  counts for a teacher's class (aggregate only).
- The country-gated cultural-group toggle that Prompt 3B assigned to
  either Prompt 7 or Prompt 12 and neither has actually built yet —
  this prompt implements it for real, on both the new Learn tab filter
  and the pre-existing Home cultural-groups rail.

**Non-goals (explicitly deferred):**

- **A full admin dashboard.** `apps/admin` has no built pages at all
  today beyond auth/sign-in scaffolding — this prompt adds exactly one
  bare route (`/teacher-requests`) to approve/reject requests, no nav
  shell, no styling investment. Prompt 14/15 own the real dashboard.
- **"Leave a class."** Never asked for in the Prompt 12 spec text.
  Building it means a new `class_members` delete policy and a UI entry
  point neither prompt requests. See "Lifecycle & cascade decisions"
  below — deliberate, documented gap, not a silent omission.
- **Teacher role revocation.** No such admin action exists in this
  spec (only approval does). See "Known limitations" below for the
  concrete fix path if this is ever built.
- **Quizzes.** Prompt 13B's job (`quizzes`, `quiz_questions`,
  `quiz_attempts` don't exist yet) — Prompt 12's "Teacher view" is
  listen counts only, not quiz scores.
- **Per-student behavioral detail of any kind** — completion status,
  position/drop-off point, last-listened timestamp — even in aggregate
  form. `class_episode_listen_counts` returns exactly one number per
  episode (see below), nothing else.

## New dependencies

None. Everything reuses existing packages already in `apps/mobile`
(`@tanstack/react-query`, `react-hook-form` + `zod`) and existing UI
components (`Chip`, `SectionHeader`, `Button`, `EmptyState`,
`Skeleton`, `BackButton`) — no new npm installs, unlike Prompt 11's map
plugin/date-picker/video dependencies.

## Data layer

### New migration(s)

Following this schema's existing enums-then-tables-then-indexes-then-RLS
migration-file split:

**`teacher_requests`**

```sql
create table teacher_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  school text not null,
  district text not null,
  phone text not null,
  status text not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  created_at timestamptz not null default now()
);
```

RLS: any authenticated user can insert a row where `user_id = auth.uid()`
(no guest path — unlike `booking_inquiries`, requesting a teacher
account requires an existing signed-in account); only `is_admin()` can
select or update. Mirrors `booking_inquiries`' shape and the same
`WITH CHECK` discipline the booking-inquiries fix established: `status`
is never client-settable (column default only), `user_id` must match
`auth.uid()`.

**`classes`**

```sql
create table classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  join_code text not null unique,
  created_at timestamptz not null default now()
);
```

`join_code` is generated server-side (a `default` expression producing
a short random alphanumeric string, e.g. via
`substr(md5(random()::text), 1, 6)` uppercased), with the `unique`
constraint as the actual guarantee. A collision on insert (`23505`) is
caught and retried once client-side — same pattern
`use-toggle-favorite.ts` already uses for its own unique-violation
handling, not a new idiom.

**`class_assignments`**

```sql
create table class_assignments (
  class_id uuid not null references classes (id) on delete cascade,
  episode_id uuid not null references episodes (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (class_id, episode_id)
);
```

**`class_members`**

```sql
create table class_members (
  class_id uuid not null references classes (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);
```

### `join_class` — join-code redemption

```sql
create or replace function join_class(p_join_code text)
returns table (class_id uuid, class_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id uuid;
  v_class_name text;
begin
  select id, name into v_class_id, v_class_name
  from classes
  where join_code = upper(trim(p_join_code));

  if v_class_id is null then
    raise exception 'join_class: no class found for that code';
  end if;

  insert into class_members (class_id, user_id)
  values (v_class_id, auth.uid())
  on conflict (class_id, user_id) do nothing;

  return query select v_class_id, v_class_name;
end;
$$;

revoke all on function join_class(text) from public;
grant execute on function join_class(text) to authenticated;
```

`on conflict do nothing` makes re-submitting the same code idempotent
(already-joined is a no-op, not an error) — same shape as
`apply_revenuecat_event`'s replay-safety, applied here for a much lower-
stakes case. Not granted to `anon` — joining a class requires an
account, matching every other write path that touches `profiles`-linked
data in this schema.

### `class_episode_listen_counts` — the aggregate

This is the function the spec's privacy line is actually about, so
here is the real body, not a description of it:

```sql
create or replace function class_episode_listen_counts(p_class_id uuid)
returns table (episode_id uuid, listener_count bigint)
language sql
security definer
set search_path = public
as $$
  select
    ca.episode_id,
    count(distinct lp.user_id) as listener_count
  from class_assignments ca
  left join class_members cm
    on cm.class_id = ca.class_id
  left join listening_progress lp
    on lp.episode_id = ca.episode_id
   and lp.user_id = cm.user_id
  where ca.class_id = p_class_id
    and exists (
      select 1 from classes c
      where c.id = p_class_id
        and c.teacher_id = auth.uid()
    )
  group by ca.episode_id;
$$;

revoke all on function class_episode_listen_counts(uuid) from public;
grant execute on function class_episode_listen_counts(uuid) to authenticated;
```

Walking through why this can't leak more than it should:

- The `select` list is exactly `episode_id, listener_count` — there is
  no column in the function's return signature for `position_seconds`,
  `completed`, `updated_at`, or `user_id`. A caller cannot get row-level
  data out of this function no matter how they call it; the shape is
  fixed by `returns table (...)`.
- `count(distinct lp.user_id)` — counting `user_id`, not selecting it.
  The left join means an episode with zero listeners still appears
  (with `listener_count = 0`) rather than being silently absent, but no
  identity ever crosses the return boundary.
- `left join ... on lp.episode_id = ca.episode_id and lp.user_id = cm.user_id`
  restricts the join to `class_assignments` rows for _this specific
  class_ — a teacher can never pull counts for an episode they didn't
  assign, satisfying the spec's "outside assigned episodes" clause
  literally, not just its "counts only" clause.
- The `exists (...)` ownership check runs inside the function itself
  (not as an RLS policy a client query could route around) — calling
  this for a class you don't teach returns zero rows, not another
  teacher's data.
- `revoke all ... grant execute ... to authenticated` — no `anon`
  access; matches `apply_revenuecat_event`/`unlock_episode`'s existing
  grant-hygiene convention from Prompt 9's audit, applied here even
  though this function is far lower-stakes than either of those.

### Index

`listening_progress` currently indexes `user_id` only
(`listening_progress_user_id_idx`); this migration adds an index on
`episode_id` alone, since `class_episode_listen_counts`' join filters
and groups by `episode_id` across every member of a class.

### Type/hook changes

- `Episode`/`Series` types (`apps/mobile/src/types/content.ts`) gain
  `subjectArea`, `gradeLevel`, `syllabusTopic` — first consumer of
  these three columns anywhere in the app (confirmed zero existing
  references), so no existing call site needs reconciling. Follows the
  same snake_case-column/camelCase-field convention `contentSource`
  already established.
- `useProfile`/`ProfileSummary` (`apps/mobile/src/hooks/queries/use-profile.ts`)
  gains `role` — currently omitted entirely; this is the first
  client-side role check anywhere in the mobile app (today, `role` is
  only checked server-side via `is_admin()` in RLS and in
  `apps/admin/src/proxy.ts`).

## RLS summary

| Table               | Policy                 | Rule                                                                                                                                           |
| ------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `teacher_requests`  | insert (authenticated) | `user_id = auth.uid()`, `status` left at column default                                                                                        |
| `teacher_requests`  | select/update          | `is_admin()` only                                                                                                                              |
| `classes`           | select                 | `teacher_id = auth.uid()`                                                                                                                      |
| `classes`           | insert                 | `teacher_id = auth.uid()` (client only sets `name`; `join_code` is a column default)                                                           |
| `class_assignments` | select                 | visible to the owning teacher, and to members of that class                                                                                    |
| `class_assignments` | insert/delete          | owning teacher only                                                                                                                            |
| `class_members`     | select (teacher)       | `class_id in (select id from classes where teacher_id = auth.uid())` — teacher sees every member of their own classes, never another teacher's |
| `class_members`     | select (student)       | `user_id = auth.uid()` — a member sees only their own row, never a classmate's                                                                 |
| `class_members`     | insert                 | via `join_class()` only (`security definer`, not a direct client insert)                                                                       |

The `class_members` split into two stacked `select` policies (rather
than one combined `OR` policy) mirrors this schema's existing style —
`booking_inquiries` similarly keeps its admin-select and future
owner-select concerns as separate named policies rather than one
compound expression, for the same readability reason.

## Manual verification — `class_members` RLS

No automated RLS/function test harness exists yet (Prompt 18's job,
same carve-out `booking_inquiries_insert_check.sql` already
documents). A new `supabase/manual-checks/class_members_select_check.sql`
gets the same treatment, covering exactly the two stacked policies:

```sql
-- Fixtures (created once, reused across cases, cleaned up after):
--   classes:       class_a (teacher = teacher_1), class_b (teacher = teacher_2)
--   class_members: (class_a, student_1), (class_a, student_2), (class_b, student_3)

-- Case 1: teacher_1 selects class_members for class_a (their own class).
-- Expect: 2 rows (student_1, student_2).
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'teacher_1_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from class_members where class_id = :'class_a_id';
rollback;

-- Case 2: teacher_1 selects class_members for class_b (NOT their class).
-- Expect: 0 rows — RLS filters them out silently, not an error.
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'teacher_1_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from class_members where class_id = :'class_b_id';
rollback;

-- Case 3: student_1 selects their own membership row.
-- Expect: 1 row.
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'student_1_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from class_members where class_id = :'class_a_id' and user_id = :'student_1_id';
rollback;

-- Case 4: student_1 selects ALL of class_a's members (no user_id filter) —
-- confirms RLS, not the query's own WHERE clause, is what limits the result.
-- Expect: 1 row (their own), NOT 2 — student_2's row must not be visible.
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'student_1_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from class_members where class_id = :'class_a_id';
rollback;

-- Case 5: student_1 attempts to select student_2's row directly by user_id.
-- Expect: 0 rows.
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'student_1_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from class_members where user_id = :'student_2_id';
rollback;

-- Case 6: anon (no session) selects class_a's members.
-- Expect: 0 rows.
begin;
set local role anon;
select count(*) from class_members where class_id = :'class_a_id';
rollback;
```

Case 4 is the one that actually distinguishes "RLS enforces this" from
"the query happened to filter it" — it deliberately omits the
`user_id` predicate a real screen would include, to prove the database
itself is the boundary, not client code discipline.

## Student browsing

- Learn tab top level (`apps/mobile/src/app/(app)/(tabs)/learn.tsx`,
  replacing the Prompt 6 mock stub): a static grid of the 6 fixed
  `subject_area` values — no query needed, it's a closed enum, same
  spirit as not re-deriving `contentSource`'s label set at runtime.
  Includes a "Teacher tools" entry point when `profile.role === 'teacher'`.
- `/learn/[subject]` (new route, structurally mirrors
  `destination/[slug]`): a new `useSubjectEpisodes(subject)` hook
  (episodes joined to `series` for title/cover, and to
  `series_cultural_groups` for the cultural-group filter — same
  to-many-embed shape `use-destinations.ts` already uses for
  `series(category)`). On-screen: grade-level chips, syllabus-topic
  chips (derived from the loaded set, same pattern as Explore's
  dynamically-derived category chips), and cultural-group chips (shown
  only when enabled for the profile's country) — all ANDed via a new
  pure `matchesLearnFilters` predicate, directly mirroring
  `matchesDestinationFilters` including its TDD treatment (written and
  tested before the screen that uses it).
- History's screen additionally renders a "True African History"
  `SectionHeader` above the regular filtered list, pulling
  `content_source = 'elder_testimony'` episodes first — composed
  alongside the normal list (two stacked sections), not a replacement
  for it, since `SectionHeader` has no built-in slot for this.
- Tapping an episode card navigates to the **existing**
  `/episode/[id]` deep-link-resolver route from Prompt 11, reused
  as-is — consistent with the standing decision that episodes never
  get a standalone screen of their own.

## Teacher request flow

- Mobile: a "Request teacher account" form (react-hook-form + zod, new
  `teacherRequestSchema`) — a plain `supabase.from("teacher_requests").insert(...)`
  in `onSubmit`, no dedicated mutation hook, matching the Booking
  Inquiry screen's precedent exactly.
- Admin: one bare route, `apps/admin/src/app/teacher-requests/page.tsx`
  — lists `status = 'pending'` rows with Approve/Reject buttons, each
  invoking a Server Action running on the service-role client. This is
  necessary, not just convenient: `prevent_protected_profile_changes`
  already rejects any non-`service_role` write to `profiles.role`
  regardless of RLS, so a plain client-side update from the browser
  would fail outright. The Server Action sets `profiles.role = 'teacher'`
  and the request's `status` together. No nav shell, no dashboard
  styling — reuses `proxy.ts`'s existing admin-only route gating as-is.

## Classes, join codes, assignments

- Teacher-only screens under `/learn/teacher/...`, gated on
  `profile.role === 'teacher'`: create a class (name only —
  `join_code` is a column default, never client-supplied), a class
  list, assigning episodes to a class (insert into
  `class_assignments`), and a class detail screen showing the join
  code plus `class_episode_listen_counts` results per assigned episode.
- Student side: a "Join a class" screen — a join-code text input
  calling `join_class()` via `supabase.rpc()`.

## Cultural-group per-country gate (closes out Prompt 3B for both Home and Learn)

- New `app_settings` key, e.g. `cultural_groups_enabled_countries`
  (a JSON array of country strings) — first-ever mobile-client read of
  `app_settings` (today it's only read server-side, inside the
  RevenueCat webhook edge function).
- New `use-app-settings.ts` hook (same directory/convention as every
  other query hook) resolving the setting against `profiles.country`.
  A guest with no known country fails **closed** — cultural-group
  browsing stays hidden rather than guessing from device locale, which
  matters given Prompt 3B's own stated rationale (ethnic-categorization
  sensitivity varies legally by country, e.g. Rwanda vs. Uganda).
- Applied to both the new Learn tab filter and the pre-existing Home
  cultural-groups rail (`use-home-sections.ts`'s `useCulturalGroups`),
  which today filters only on `is_published` with no country check at
  all — this closes the gap left when Prompt 7 didn't implement its
  half of what Prompt 3B assigned.

## Lifecycle & cascade decisions

- **All three new tables cascade on delete**, matching this schema's
  existing, universal convention (`profiles.id references auth.users(id)
on delete cascade`, and every other `user_id references profiles(id)`
  in this schema is already `on delete cascade`): `classes.teacher_id`,
  `class_assignments.class_id`, `class_members.class_id`, and
  `class_members.user_id` are all `on delete cascade`.
  - **A teacher's account deleted** → their classes cascade-delete,
    and with them, those classes' assignments and every enrolled
    student's membership rows. No orphaned classes with a missing
    owner are left behind.
  - **A class deleted directly** → its assignments and member rows
    cascade-delete with it.
  - **A student's account deleted** → only their own membership
    row(s) are removed; the class, its other members, and its
    assignments are untouched.
- **No cached or derived counts exist anywhere.**
  `class_episode_listen_counts` computes live from current table state
  on every call — nothing is materialized. This means none of the
  cascades above can leave a stale count behind; there is nothing to
  invalidate. The moment a `class_members` or `listening_progress` row
  is gone, the next call simply reflects that.
- **"Student leaves a class" is out of scope for this prompt** — never
  requested in the Prompt 12 spec text. Building it would need a new
  `class_members` delete policy (`user_id = auth.uid()`) and a UI
  entry point, neither of which this prompt asks for. Documented in
  `docs/education.md` as a deliberate v1 gap, the same way Prompt 11's
  auth-back-navigation gap is documented in `docs/known-issues.md` —
  so it reads as a decision, not something discovered later.

## Known limitations

- **Teacher role revocation has no defined behavior, and a concrete
  fix path if it's ever built.** No admin action to revoke `'teacher'`
  exists in this spec — only approval does. If one is added later,
  `class_episode_listen_counts`' ownership check (currently just
  `c.teacher_id = auth.uid()`) would need to be tightened to also
  verify the caller currently holds the teacher role:

  ```sql
  and exists (
    select 1 from classes c
    where c.id = p_class_id
      and c.teacher_id = auth.uid()
  )
  and exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role = 'teacher'
  )
  ```

  Without that second check, someone demoted away from `'teacher'`
  would still be able to pull listen counts for classes they created
  while they held the role, since `teacher_id = auth.uid()` alone only
  checks _ownership_, not _current_ role. This is the specific gap a
  future revocation feature would need to close, not a vague "TBD" —
  today, since revocation doesn't exist, `classes.teacher_id` and
  current role are always in sync, so the gap is latent, not active.

## Testing

- `matchesLearnFilters` and `teacherRequestSchema`: TDD, same as
  `destination-filter.test.ts`/`bookingInquirySchema`.
- Query/mutation hooks and screens: untested, matching this codebase's
  established precedent (no test file exists for any `use-*.ts` query
  hook or screen component anywhere in this app).
- `join_class` and `class_episode_listen_counts`: no automated
  RLS/function test harness yet — manual verification scripts under
  `supabase/manual-checks/`, same shape and rationale as
  `booking_inquiries_insert_check.sql`.

## Documentation

`docs/education.md` (new) documents: the subject/grade/syllabus-topic
browsing model, the teacher-request→approval flow, classes/join-codes/
assignments, the listen-count aggregate's privacy boundary (quoting the
function body above), the cultural-group country-gate mechanism, and
the deliberate v1 gaps ("leave a class," teacher role revocation) with
their fix paths.
