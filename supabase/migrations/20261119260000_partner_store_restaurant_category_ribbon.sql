-- Separate store, grocery and restaurant discovery categories with admin-controlled mini ribbon.
begin;

create table if not exists public.partner_catalog_categories (
  category_key text primary key,
  vertical text not null check (vertical in ('store','restaurant','grocery')),
  title text not null check (char_length(trim(title)) between 2 and 60),
  image_url text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  tile_width_px integer not null default 72 check (tile_width_px between 48 and 160),
  tile_height_px integer not null default 72 check (tile_height_px between 48 and 160),
  auto_scroll_seconds integer not null default 5 check (auto_scroll_seconds between 1 and 30),
  updated_at timestamptz not null default now()
);
create index if not exists partner_catalog_categories_active_order_idx
  on public.partner_catalog_categories(vertical,is_active,sort_order);

insert into public.partner_catalog_categories
(category_key,vertical,title,image_url,sort_order)
values
('menswear','store','ملابس رجالي','https://images.unsplash.com/photo-1617137968427-85924c800a22?w=240&h=240&fit=crop',10),
('womenswear','store','ملابس نسائي','https://images.unsplash.com/photo-1483985988355-763728e1935b?w=240&h=240&fit=crop',20),
('accessories','store','إكسسوارات','https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=240&h=240&fit=crop',30),
('makeup','store','مكياج','https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=240&h=240&fit=crop',40),
('shoes','store','أحذية','https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=240&h=240&fit=crop',50),
('perfumes','store','عطور','https://images.unsplash.com/photo-1594035910387-fea47794261f?w=240&h=240&fit=crop',60),
('kids','store','أطفال','https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=240&h=240&fit=crop',70),
('home','store','منزلية','https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=240&h=240&fit=crop',80),
('electronics','store','إلكترونيات','https://images.unsplash.com/photo-1498049794561-7780e7231661?w=240&h=240&fit=crop',90),
('grocery','grocery','بقالة وخضروات','https://images.unsplash.com/photo-1542838132-92c53300491e?w=240&h=240&fit=crop',100),
('fast_food','restaurant','وجبات سريعة','https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=240&h=240&fit=crop',110),
('grills','restaurant','مشاوي','https://images.unsplash.com/photo-1544025162-d76694265947?w=240&h=240&fit=crop',120),
('fish','restaurant','أسماك','https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=240&h=240&fit=crop',130),
('juices','restaurant','عصائر','https://images.unsplash.com/photo-1622597467836-f3285f2131b8?w=240&h=240&fit=crop',140),
('rice_qeema','restaurant','تمن وقيمة','https://images.unsplash.com/photo-1512058564366-18510be2db19?w=240&h=240&fit=crop',150),
('pizza','restaurant','بيتزا ومعجنات','https://images.unsplash.com/photo-1513104890138-7c749659a591?w=240&h=240&fit=crop',160),
('sweets','restaurant','حلويات','https://images.unsplash.com/photo-1488477181946-6428a0291777?w=240&h=240&fit=crop',170),
('coffee','restaurant','قهوة ومشروبات','https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=240&h=240&fit=crop',180)
on conflict (category_key) do nothing;

alter table public.partner_business_profiles
  add column if not exists business_vertical text not null default 'store'
  check (business_vertical in ('store','grocery','restaurant'));
grant update (business_vertical) on public.partner_business_profiles to authenticated;
grant select (business_vertical) on public.partner_business_profiles to anon, authenticated;

alter table public.partner_catalog_items
  add column if not exists category_key text references public.partner_catalog_categories(category_key);

create index if not exists idx_partner_catalog_category_active
  on public.partner_catalog_items(category_key,is_active,created_at desc);

alter table public.partner_catalog_categories enable row level security;
drop policy if exists partner_catalog_categories_public_read on public.partner_catalog_categories;
create policy partner_catalog_categories_public_read on public.partner_catalog_categories
  for select to anon,authenticated using (is_active = true);
drop policy if exists partner_catalog_categories_admin_manage on public.partner_catalog_categories;
create policy partner_catalog_categories_admin_manage on public.partner_catalog_categories
  for all to authenticated
  using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));
grant select on public.partner_catalog_categories to anon,authenticated;
grant insert,update,delete on public.partner_catalog_categories to authenticated;

drop policy if exists partner_catalog_owner_insert on public.partner_catalog_items;
create policy partner_catalog_owner_insert on public.partner_catalog_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.partner_business_profiles p
      join public.partner_applications a on a.id = p.application_id
      left join public.partner_catalog_categories c on c.category_key = partner_catalog_items.category_key
      where p.id = business_profile_id
        and p.user_id = (select auth.uid())
        and a.status = 'approved'
        and (
          (p.partner_type = 'hotel' and partner_catalog_items.item_type = 'room' and partner_catalog_items.category_key is null)
          or (p.partner_type = 'restaurant' and partner_catalog_items.item_type = 'menu_item' and c.vertical = 'restaurant')
          or (p.partner_type in ('store','mall') and partner_catalog_items.item_type = 'product'
              and ((p.business_vertical = 'grocery' and c.vertical = 'grocery' and partner_catalog_items.category_key = 'grocery')
                or (p.business_vertical = 'store' and c.vertical = 'store')))
        )
    )
  );

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
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
        and (p.user_id <> (select auth.uid()) or a.status = 'approved')
        and (
          (p.partner_type = 'hotel' and partner_catalog_items.item_type = 'room' and partner_catalog_items.category_key is null)
          or (p.partner_type = 'restaurant' and partner_catalog_items.item_type = 'menu_item' and exists(select 1 from public.partner_catalog_categories c where c.category_key=partner_catalog_items.category_key and c.vertical='restaurant'))
          or (p.partner_type in ('store','mall') and partner_catalog_items.item_type = 'product' and exists(
            select 1 from public.partner_catalog_categories c where c.category_key=partner_catalog_items.category_key
              and ((p.business_vertical='grocery' and c.vertical='grocery' and c.category_key='grocery')
                or (p.business_vertical='store' and c.vertical='store'))
          ))
        )
    )
  );


-- Public product photos; uploads are scoped to the owning approved partner profile.
insert into storage.buckets (id,name,public)
values ('partner-catalog','partner-catalog',true)
on conflict (id) do update set public=true;

drop policy if exists partner_catalog_images_owner_insert on storage.objects;
create policy partner_catalog_images_owner_insert on storage.objects
  for insert to authenticated with check (
    bucket_id='partner-catalog' and exists (
      select 1 from public.partner_business_profiles p
      join public.partner_applications a on a.id=p.application_id
      where p.id::text=(storage.foldername(name))[1]
        and p.user_id=(select auth.uid()) and a.status='approved'
    )
  );

drop policy if exists partner_catalog_images_owner_update on storage.objects;
create policy partner_catalog_images_owner_update on storage.objects
  for update to authenticated using (
    bucket_id='partner-catalog' and exists (
      select 1 from public.partner_business_profiles p
      where p.id::text=(storage.foldername(name))[1]
        and (p.user_id=(select auth.uid()) or public.has_admin_access((select auth.uid())))
    )
  ) with check (
    bucket_id='partner-catalog' and exists (
      select 1 from public.partner_business_profiles p
      where p.id::text=(storage.foldername(name))[1]
        and (p.user_id=(select auth.uid()) or public.has_admin_access((select auth.uid())))
    )
  );

drop policy if exists partner_catalog_images_owner_delete on storage.objects;
create policy partner_catalog_images_owner_delete on storage.objects
  for delete to authenticated using (
    bucket_id='partner-catalog' and exists (
      select 1 from public.partner_business_profiles p
      where p.id::text=(storage.foldername(name))[1]
        and (p.user_id=(select auth.uid()) or public.has_admin_access((select auth.uid())))
    )
  );

commit;
