-- Preserve edits to legacy hotel rooms that do not yet have a category.
-- Match the insert policy: an uncategorized room remains editable, while
-- categorized rooms must reference an active hotel category.
begin;

drop policy if exists partner_catalog_owner_update on public.partner_catalog_items;
create policy partner_catalog_owner_update on public.partner_catalog_items
  for update to authenticated
  using (
    exists (
      select 1 from public.partner_business_profiles p
      join public.partner_applications a on a.id = p.application_id
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
        and (p.user_id <> (select auth.uid()) or a.status = 'approved')
    )
  )
  with check (
    exists (
      select 1 from public.partner_business_profiles p
      join public.partner_applications a on a.id = p.application_id
      left join public.partner_catalog_categories c on c.category_key = partner_catalog_items.category_key
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
        and (p.user_id <> (select auth.uid()) or a.status = 'approved')
        and (
          (p.partner_type = 'hotel' and partner_catalog_items.item_type = 'room'
            and (partner_catalog_items.category_key is null or (c.vertical = 'hotel' and c.is_active = true)))
          or (p.partner_type = 'restaurant' and partner_catalog_items.item_type = 'menu_item'
            and c.vertical = 'restaurant' and c.is_active = true)
          or (p.partner_type in ('store','mall') and partner_catalog_items.item_type = 'product'
            and ((p.business_vertical = 'grocery' and c.vertical = 'grocery' and c.is_active = true and partner_catalog_items.category_key = 'grocery')
              or (p.business_vertical = 'store' and c.vertical = 'store' and c.is_active = true)))
        )
    )
  );

commit;
