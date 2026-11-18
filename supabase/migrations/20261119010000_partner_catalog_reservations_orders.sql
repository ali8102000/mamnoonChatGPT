-- Partner operating modules foundation: hotel rooms, restaurant menus, store products,
-- hotel reservations and customer orders. Source-only migration; review and test before production.
begin;

-- Allow the public catalogue to resolve only published business cards.
grant select (id, partner_type, business_name, phone, city, address, description, opening_hours, social_links, is_published)
  on public.partner_business_profiles to anon;
drop policy if exists partner_business_profiles_public_read on public.partner_business_profiles;
create policy partner_business_profiles_public_read on public.partner_business_profiles
  for select to anon using (is_published = true);

create table if not exists public.partner_catalog_items (
  id uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references public.partner_business_profiles(id) on delete cascade,
  item_type text not null check (item_type in ('room','menu_item','product')),
  name text not null check (char_length(trim(name)) between 2 and 140),
  description text,
  price_amount numeric(14,2) not null default 0 check (price_amount >= 0),
  currency text not null default 'IQD' check (currency in ('IQD','USD')),
  quantity_available integer check (quantity_available is null or quantity_available >= 0),
  image_urls text[] not null default '{}',
  attributes jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_catalog_item_attributes_object check (jsonb_typeof(attributes) = 'object')
);

create index if not exists idx_partner_catalog_business_type_active
  on public.partner_catalog_items(business_profile_id, item_type, is_active, sort_order);

alter table public.partner_catalog_items enable row level security;
grant select on public.partner_catalog_items to anon, authenticated;
grant insert, delete on public.partner_catalog_items to authenticated;
grant update (name, description, price_amount, currency, quantity_available, image_urls, attributes, is_active, sort_order, updated_at)
  on public.partner_catalog_items to authenticated;
drop policy if exists partner_catalog_public_read on public.partner_catalog_items;
create policy partner_catalog_public_read on public.partner_catalog_items
  for select to anon, authenticated
  using (
    is_active = true and exists (
      select 1 from public.partner_business_profiles p
      where p.id = business_profile_id and p.is_published = true
    )
  );
drop policy if exists partner_catalog_owner_admin_read on public.partner_catalog_items;
create policy partner_catalog_owner_admin_read on public.partner_catalog_items
  for select to authenticated
  using (
    exists (
      select 1 from public.partner_business_profiles p
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
    )
  );
drop policy if exists partner_catalog_owner_insert on public.partner_catalog_items;
create policy partner_catalog_owner_insert on public.partner_catalog_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.partner_business_profiles p
      join public.partner_applications a on a.id = p.application_id
      where p.id = business_profile_id
        and p.user_id = (select auth.uid())
        and a.status = 'approved'
        and ((p.partner_type = 'hotel' and item_type = 'room')
          or (p.partner_type = 'restaurant' and item_type = 'menu_item')
          or (p.partner_type in ('store','mall') and item_type = 'product'))
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
    )
  );
drop policy if exists partner_catalog_owner_delete on public.partner_catalog_items;
create policy partner_catalog_owner_delete on public.partner_catalog_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.partner_business_profiles p
      join public.partner_applications a on a.id = p.application_id
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
        and (p.user_id <> (select auth.uid()) or a.status = 'approved')
    )
  );

create table if not exists public.partner_hotel_reservations (
  id uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references public.partner_business_profiles(id) on delete cascade,
  room_item_id uuid not null references public.partner_catalog_items(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  check_in date not null,
  check_out date not null,
  guests integer not null default 1 check (guests between 1 and 20),
  customer_note text,
  partner_note text,
  status text not null default 'pending'
    check (status in ('pending','confirmed','rejected','cancelled','completed')),
  quoted_total numeric(14,2) check (quoted_total is null or quoted_total >= 0),
  currency text not null default 'IQD' check (currency in ('IQD','USD')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_hotel_reservation_dates check (check_out > check_in)
);
create index if not exists idx_partner_hotel_reservations_business_status
  on public.partner_hotel_reservations(business_profile_id, status, check_in);
create index if not exists idx_partner_hotel_reservations_customer
  on public.partner_hotel_reservations(customer_id, created_at desc);
alter table public.partner_hotel_reservations enable row level security;
grant select, insert on public.partner_hotel_reservations to authenticated;
grant update (status, partner_note, quoted_total, currency, updated_at)
  on public.partner_hotel_reservations to authenticated;
drop policy if exists partner_hotel_reservations_read_parties on public.partner_hotel_reservations;
create policy partner_hotel_reservations_read_parties on public.partner_hotel_reservations
  for select to authenticated
  using (
    customer_id = (select auth.uid())
    or exists (
      select 1 from public.partner_business_profiles p
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
    )
  );
drop policy if exists partner_hotel_reservations_customer_create on public.partner_hotel_reservations;
create policy partner_hotel_reservations_customer_create on public.partner_hotel_reservations
  for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    and status = 'pending'
    and quoted_total is null
    and exists (
      select 1 from public.partner_business_profiles p
      join public.partner_catalog_items i on i.business_profile_id = p.id
      join public.partner_applications a on a.id = p.application_id
      where p.id = business_profile_id and i.id = room_item_id
        and i.item_type = 'room' and i.is_active = true
        and p.is_published = true and a.status = 'approved'
    )
  );
drop policy if exists partner_hotel_reservations_partner_update on public.partner_hotel_reservations;
create policy partner_hotel_reservations_partner_update on public.partner_hotel_reservations
  for update to authenticated
  using (
    exists (
      select 1 from public.partner_business_profiles p
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
    )
  )
  with check (
    exists (
      select 1 from public.partner_business_profiles p
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
    )
  );

create table if not exists public.partner_customer_orders (
  id uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references public.partner_business_profiles(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  order_type text not null check (order_type in ('restaurant','store')),
  requested_items jsonb not null check (jsonb_typeof(requested_items) = 'array' and jsonb_array_length(requested_items) > 0),
  delivery_address text,
  customer_note text,
  partner_note text,
  status text not null default 'pending'
    check (status in ('pending','accepted','preparing','ready','out_for_delivery','completed','rejected','cancelled')),
  partner_total numeric(14,2) check (partner_total is null or partner_total >= 0),
  currency text not null default 'IQD' check (currency in ('IQD','USD')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_partner_customer_orders_business_status
  on public.partner_customer_orders(business_profile_id, status, created_at desc);
create index if not exists idx_partner_customer_orders_customer
  on public.partner_customer_orders(customer_id, created_at desc);
alter table public.partner_customer_orders enable row level security;
grant select, insert on public.partner_customer_orders to authenticated;
grant update (status, partner_note, partner_total, currency, updated_at)
  on public.partner_customer_orders to authenticated;
drop policy if exists partner_customer_orders_read_parties on public.partner_customer_orders;
create policy partner_customer_orders_read_parties on public.partner_customer_orders
  for select to authenticated
  using (
    customer_id = (select auth.uid())
    or exists (
      select 1 from public.partner_business_profiles p
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
    )
  );
drop policy if exists partner_customer_orders_customer_create on public.partner_customer_orders;
create policy partner_customer_orders_customer_create on public.partner_customer_orders
  for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    and status = 'pending'
    and partner_total is null
    and exists (
      select 1 from public.partner_business_profiles p
      join public.partner_applications a on a.id = p.application_id
      where p.id = business_profile_id
        and p.is_published = true and a.status = 'approved'
        and ((order_type = 'restaurant' and p.partner_type = 'restaurant')
          or (order_type = 'store' and p.partner_type in ('store','mall')))
    )
  );
drop policy if exists partner_customer_orders_partner_update on public.partner_customer_orders;
create policy partner_customer_orders_partner_update on public.partner_customer_orders
  for update to authenticated
  using (
    exists (
      select 1 from public.partner_business_profiles p
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
    )
  )
  with check (
    exists (
      select 1 from public.partner_business_profiles p
      where p.id = business_profile_id
        and (p.user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())))
    )
  );

commit;
