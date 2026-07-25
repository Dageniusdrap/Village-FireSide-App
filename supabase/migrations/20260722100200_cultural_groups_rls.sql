-- supabase/migrations/20260722100200_cultural_groups_rls.sql

-- cultural_groups: public can read published rows; admin full access.
alter table cultural_groups enable row level security;

create policy cultural_groups_select_published
  on cultural_groups for select
  using (is_published = true);

create policy cultural_groups_admin_all
  on cultural_groups for all
  using (is_admin())
  with check (is_admin());

-- series_cultural_groups: visible when the linked cultural group is published.
alter table series_cultural_groups enable row level security;

create policy series_cultural_groups_select_published
  on series_cultural_groups for select
  using (
    exists (
      select 1 from cultural_groups cg
      where cg.id = series_cultural_groups.cultural_group_id
        and cg.is_published = true
    )
  );

create policy series_cultural_groups_admin_all
  on series_cultural_groups for all
  using (is_admin())
  with check (is_admin());

-- contributor_cultural_groups: same visibility pattern.
alter table contributor_cultural_groups enable row level security;

create policy contributor_cultural_groups_select_published
  on contributor_cultural_groups for select
  using (
    exists (
      select 1 from cultural_groups cg
      where cg.id = contributor_cultural_groups.cultural_group_id
        and cg.is_published = true
    )
  );

create policy contributor_cultural_groups_admin_all
  on contributor_cultural_groups for all
  using (is_admin())
  with check (is_admin());
