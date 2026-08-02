-- supabase/manual-checks/class_members_select_check.sql
--
-- Manual verification for class_members' two stacked select policies
-- (class_members_teacher_select, class_members_student_select_own).
-- Same rationale as booking_inquiries_insert_check.sql: no pgTAP/RLS
-- test harness exists yet (Prompt 18's job).
--
-- Fixtures (create once, reuse across cases, clean up after):
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
-- confirms RLS, not the query's own WHERE clause, is what limits the
-- result. Expect: 1 row (their own), NOT 2.
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
