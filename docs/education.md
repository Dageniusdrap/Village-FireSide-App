# Education Features (Learn Tab)

Village Fireside's Learn tab serves two audiences: students browsing
by subject/grade/syllabus-topic, and teachers running a class.

## Student browsing

Episodes carry `subject_area`, `grade_level`, and `syllabus_topic`
(added in Prompt 3's schema, unused until this feature). The Learn tab
shows the 6 fixed subjects as cards; each subject's screen
(`/learn/[subject]`) filters by grade level (from the static
`GRADE_LEVELS` constant in `apps/mobile/src/constants/learn.ts`,
rendered unconditionally) and syllabus topic (derived from the loaded
episode set) — both chip-based multi-select, ANDed together, same
pattern as the Explore tab's country/category filters — plus a
cultural-group filter gated per-country (see below).
History's screen additionally surfaces `elder_testimony`-sourced
episodes first, under a "True African History" header.

## Cultural-group country gate

Prompt 3B specified a per-country toggle for cultural-group browsing
(ethnic categorization is legally sensitive in some countries, e.g.
Rwanda, but not others, e.g. Uganda) and assigned it to either Prompt 7
or Prompt 12 — neither had actually implemented it until this feature.
The `app_settings` key `cultural_groups_enabled_countries` (a JSON
array of country names) is checked against the signed-in user's
`profiles.country`; a guest or a user with no known country sees no
cultural-group filter at all (fails closed, not open). Applied to both
the Learn tab's filter and the pre-existing Home cultural-groups rail.

`profiles.country` is populated from two places: the country picked in
the phone sign-in flow (`apps/mobile/src/app/(auth)/phone-sign-in.tsx`,
persisted after OTP verification in `otp-verify.tsx` since a session
only exists post-verification), or the Settings screen
(`apps/mobile/src/app/(app)/settings.tsx`) for anyone who signed up a
different way, or who signed up before this write path existed. Both
write paths reuse `COUNTRY_CODES` (`apps/mobile/src/lib/phone.ts`),
whose `name` values match `cultural_groups_enabled_countries` verbatim.

## Teacher request flow

A signed-in user can request a teacher account
(`/learn/teacher-request`) — this inserts into `teacher_requests`
(`status` defaults to `'pending'`, never client-settable to anything
else). An admin reviews pending requests at `/teacher-requests` in
`apps/admin` and approves or rejects. Approval sets `profiles.role =
'teacher'` via a Server Action running on the service-role client —
required because `prevent_protected_profile_changes` rejects any
`profiles.role` write that isn't running as `service_role`, regardless
of RLS or admin status.

## Classes, join codes, assignments

A teacher creates a `classes` row (join code generated server-side, a
short unique string); students redeem the code via `join_class()`, a
`SECURITY DEFINER` function that validates the code and inserts into
`class_members` as the calling user — there is no direct insert policy
on `class_members`, this function is the only path in. A teacher
assigns episodes to their class (`class_assignments`) via a plain
episode-ID field (not a picker — deliberately minimal for this v1
pilot; a future pass could add search/browse).

## Listen-count aggregate — the privacy boundary

`class_episode_listen_counts(class_id)` returns exactly
`(episode_id, listener_count)` for episodes assigned to that class,
counting distinct students who have any `listening_progress` row for
that episode. No other column crosses the function's return boundary —
no completion flag, no position/drop-off point, no timestamp, no
per-student identity. This is a deliberate reading of the Prompt 12
spec's "counts only, never individual listening behavior outside
assigned episodes" line as two separate constraints: never row-level
data (full stop), and never anything beyond what the teacher assigned
(the join to `class_assignments` enforces the second half). See
`docs/superpowers/specs/2026-08-02-learn-tab-design.md` for the full
function body and reasoning.

## `is_class_member()` — why a SECURITY DEFINER helper exists here

`classes_member_select` (a student's ability to see a class they've
joined) checks membership via a subquery against `class_members`, and
`class_members_teacher_select` (a teacher's ability to see their
class's members) checks ownership via a subquery against `classes`.
Evaluated directly, those two policies reference each other's table
under RLS and Postgres detects it as infinite recursion (SQLSTATE
42P17), failing every query against either table. `is_class_member(uuid)`
is a `SECURITY DEFINER` function that reads `class_members` as its
owning role, bypassing RLS internally, so `classes_member_select` can
call it instead of subquerying `class_members` directly — breaking the
cycle. Only one side of the mutual reference needs this treatment;
`class_members_teacher_select` is left as a plain `exists (...)` against
`classes`. See `supabase/migrations/20260802100600_fix_classes_member_select_rls_recursion.sql`.

## RLS summary

| Table               | Rule                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `teacher_requests`  | insert: own row only, `status` fixed to `'pending'`; select/update: admin only                                                |
| `classes`           | select: the owning teacher, or a joined member; insert: owning teacher only, and only if `profiles.role = 'teacher'`          |
| `class_assignments` | select: owning teacher or a class member; insert: owning teacher only                                                         |
| `class_members`     | select: owning teacher sees all members, a student sees only their own row; insert: only via `join_class()`, no direct policy |

## Known v1 gaps (deliberate, not discovered later)

- **"Leave a class"** is not built — never requested in the Prompt 12
  spec text. Would need a new `class_members` delete policy
  (`user_id = auth.uid()`) plus a UI entry point.
- **Teacher role revocation** has no admin action in this spec — only
  approval does. `class_episode_listen_counts`' ownership check already
  verifies the caller currently holds `profiles.role = 'teacher'` (not
  just `teacher_id = auth.uid()`), and `classes_teacher_insert` requires
  the same, so someone demoted away from the role can no longer create
  new classes or pull listen counts for classes they created while they
  held it — see
  `supabase/migrations/20260802100900_enforce_teacher_role_server_side.sql`.
  A revocation admin action itself still doesn't exist.
