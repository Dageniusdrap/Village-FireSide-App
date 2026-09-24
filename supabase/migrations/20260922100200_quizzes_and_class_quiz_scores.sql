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
