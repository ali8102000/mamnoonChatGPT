begin;
drop policy if exists partner_catalog_categories_public_read on public.partner_catalog_categories;
drop policy if exists partner_catalog_categories_admin_manage on public.partner_catalog_categories;
drop policy if exists partner_catalog_categories_read on public.partner_catalog_categories;
create policy partner_catalog_categories_read on public.partner_catalog_categories
  for select to anon,authenticated
  using (is_active = true or (select public.is_super_admin((select auth.uid()))));
drop policy if exists partner_catalog_categories_admin_insert on public.partner_catalog_categories;
create policy partner_catalog_categories_admin_insert on public.partner_catalog_categories
  for insert to authenticated with check (public.is_super_admin((select auth.uid())));
drop policy if exists partner_catalog_categories_admin_update on public.partner_catalog_categories;
create policy partner_catalog_categories_admin_update on public.partner_catalog_categories
  for update to authenticated using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));
drop policy if exists partner_catalog_categories_admin_delete on public.partner_catalog_categories;
create policy partner_catalog_categories_admin_delete on public.partner_catalog_categories
  for delete to authenticated using (public.is_super_admin((select auth.uid())));

drop policy if exists partner_catalog_owner_insert on public.partner_catalog_items;
create policy partner_catalog_owner_insert on public.partner_catalog_items
  for insert to authenticated with check (
    exists (
      select 1 from public.partner_business_profiles p
      join public.partner_applications a on a.id=p.application_id
      left join public.partner_catalog_categories c on c.category_key=partner_catalog_items.category_key
      where p.id=business_profile_id and p.user_id=(select auth.uid()) and a.status='approved'
        and (
          (p.partner_type='hotel' and partner_catalog_items.item_type='room' and partner_catalog_items.category_key is null)
          or (p.partner_type='restaurant' and partner_catalog_items.item_type='menu_item' and c.vertical='restaurant' and c.is_active=true)
          or (p.partner_type in ('store','mall') and partner_catalog_items.item_type='product'
            and ((p.business_vertical='grocery' and c.vertical='grocery' and c.is_active=true and partner_catalog_items.category_key='grocery')
              or (p.business_vertical='store' and c.vertical='store' and c.is_active=true)))
        )
    )
  );

drop policy if exists partner_catalog_owner_update on public.partner_catalog_items;
create policy partner_catalog_owner_update on public.partner_catalog_items
  for update to authenticated
  using (
    exists(select 1 from public.partner_business_profiles p join public.partner_applications a on a.id=p.application_id
      where p.id=business_profile_id and (p.user_id=(select auth.uid()) or public.has_admin_access((select auth.uid())))
        and (p.user_id<>(select auth.uid()) or a.status='approved'))
  )
  with check (
    exists(select 1 from public.partner_business_profiles p join public.partner_applications a on a.id=p.application_id
      where p.id=business_profile_id and (p.user_id=(select auth.uid()) or public.has_admin_access((select auth.uid())))
        and (p.user_id<>(select auth.uid()) or a.status='approved')
        and (
          (p.partner_type='hotel' and partner_catalog_items.item_type='room' and partner_catalog_items.category_key is null)
          or (p.partner_type='restaurant' and partner_catalog_items.item_type='menu_item' and exists(
            select 1 from public.partner_catalog_categories c where c.category_key=partner_catalog_items.category_key and c.vertical='restaurant' and c.is_active=true))
          or (p.partner_type in ('store','mall') and partner_catalog_items.item_type='product' and exists(
            select 1 from public.partner_catalog_categories c where c.category_key=partner_catalog_items.category_key and c.is_active=true
              and ((p.business_vertical='grocery' and c.vertical='grocery' and c.category_key='grocery')
                or (p.business_vertical='store' and c.vertical='store'))))
        )
    )
  );
commit;