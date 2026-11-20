begin;
drop policy if exists partner_catalog_categories_read on public.partner_catalog_categories;
drop policy if exists partner_catalog_categories_public_active_read on public.partner_catalog_categories;
drop policy if exists partner_catalog_categories_super_admin_read on public.partner_catalog_categories;

create policy partner_catalog_categories_public_active_read
  on public.partner_catalog_categories
  for select
  to anon, authenticated
  using (is_active = true);

create policy partner_catalog_categories_super_admin_read
  on public.partner_catalog_categories
  for select
  to authenticated
  using ((select public.is_super_admin((select auth.uid()))));

grant select on public.partner_catalog_categories to anon, authenticated;
commit;