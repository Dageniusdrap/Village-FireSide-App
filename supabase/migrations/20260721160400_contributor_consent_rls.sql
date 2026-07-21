-- supabase/migrations/20260721160400_contributor_consent_rls.sql

-- contributors: admin only. Public access is only ever through the
-- public_contributors view (Task 4), never this table directly.
alter table contributors enable row level security;

create policy contributors_admin_all
  on contributors for all
  using (is_admin())
  with check (is_admin());

-- consents: admin only. Consent records, phone numbers, and fee amounts
-- must never be publicly readable.
alter table consents enable row level security;

create policy consents_admin_all
  on consents for all
  using (is_admin())
  with check (is_admin());

-- source_materials: admin only.
alter table source_materials enable row level security;

create policy source_materials_admin_all
  on source_materials for all
  using (is_admin())
  with check (is_admin());

-- episode_contributors: visible when its parent episode is published;
-- admin full access. Mirrors destination_media's pattern from Prompt 2
-- of visibility keyed off a parent table.
alter table episode_contributors enable row level security;

create policy episode_contributors_select_published
  on episode_contributors for select
  using (
    exists (
      select 1 from episodes e
      where e.id = episode_contributors.episode_id
        and e.status = 'published'
    )
  );

create policy episode_contributors_admin_all
  on episode_contributors for all
  using (is_admin())
  with check (is_admin());
