-- supabase/migrations/20260802100100_teacher_requests_and_classes_indexes.sql

create index teacher_requests_user_id_idx on teacher_requests (user_id);
create index teacher_requests_status_idx on teacher_requests (status);
create index classes_teacher_id_idx on classes (teacher_id);
create index class_assignments_episode_id_idx on class_assignments (episode_id);
create index class_members_user_id_idx on class_members (user_id);

-- listening_progress currently only indexes user_id
-- (listening_progress_user_id_idx, Prompt 2). class_episode_listen_counts
-- (Task 5) groups/joins by episode_id across every member of a class, so
-- this index is added here rather than left for a future prompt to notice
-- as a slow-query problem.
create index listening_progress_episode_id_idx on listening_progress (episode_id);
