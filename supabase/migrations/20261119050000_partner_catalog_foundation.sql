-- Partner commerce foundation: hotel rooms, restaurant menus, and store products.
-- This migration is source-only until reviewed and explicitly applied to Supabase.
begin;

create table if not exists public.hotel_room_types (
  id uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references public.partner_business_profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  description text,
  capacity integer not null default 2 check (capacity between 1 and 20),
  quantity integer not null default 1 check (quantity between 1 and 500),
  price_per_night numeric(12,2) not null check (price_per_night >= 0),
  currency text not null default 'IQD' check (currency in ('IQD','USD')),
  amenities jsonb not null default '[]'::jsonb check (jsonb_typeof(amenities) = 'array'),
  image_urls text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hotel_room_types_business_active_idx
  on public.hotel_room_types(business_profile_id, is_active);

create table if not exists public.restaurant_menu_categories (
  id uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references public.partner_business_profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists restaurant_menu_categories_business_sort_idx
  on public.restaurant_menu_categories(business_profile_id, sort_order);

create table if not exists public.restaurant_menu_items (
  id uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references public.partner_business_profiles(id) on delete cascade,
  category_id uuid references public.restaurant_menu_categories(id) on delete set null,
  name text not null check (char_length(trim(name)) between 2 and 120),
  description text,
  price numeric(12,2) not null check (price >= 0),
  currency text not null default 'IQD' check (currency in ('IQD','USD')),
  image_url text,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_menu_item_category_same_business
    check (category_id is null or business_profile_id is not null)
);
create index if not exists restaurant_menu_items_business_available_idx
  on public.restaurant_menu_items(business_profile_id, is_available, sort_order);

create table if not exists public.partner_products (
  id uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references public.partner_business_profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 160),
  description text,
  sku text,
  price numeric(12,2) not null check (price >= 0),
  currency text not null default 'IQD' check (currency in ('IQD','USD')),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  image_urls text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_products_business_active_idx
  on public.partner_products(business_profile_id, is_active);

-- Partner owners may manage their own approved business catalog.
alter table public.hotel_room_types enable row level security;
alter table public.restaurant_menu_categories enable row level security;
alter table public.restaurant_menu_items enable row level security;
alter table public.partner_products enable row level security;

grant select, insert, update, delete on public.hotel_room_types to authenticated;
grant select, insert, update, delete on public.restaurant_menu_categories to authenticated;
grant select, insert, update, delete on public.restaurant_menu_items to authenticated;
grant select, insert, update, delete on public.partner_products to authenticated;

drop policy if exists hotel_room_types_public_read on public.hotel_room_types;
create policy hotel_room_types_public_read on public.hotel_room_types
for select to anon, authenticated using (
  is_active and exists (
    select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.is_published = true
  )
);
drop policy if exists hotel_room_types_owner_manage on public.hotel_room_types;
create policy hotel_room_types_owner_manage on public.hotel_room_types
for all to authenticated using (
  exists (select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.user_id = (select auth.uid())
      and p.is_published in (true,false)
      and exists (select 1 from public.partner_applications a
        where a.id = p.application_id and a.status = 'approved'))
) with check (
  exists (select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.user_id = (select auth.uid())
      and exists (select 1 from public.partner_applications a
        where a.id = p.application_id and a.status = 'approved'))
);

drop policy if exists restaurant_menu_categories_public_read on public.restaurant_menu_categories;
create policy restaurant_menu_categories_public_read on public.restaurant_menu_categories
for select to anon, authenticated using (
  is_active and exists (select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.is_published = true)
);
drop policy if exists restaurant_menu_categories_owner_manage on public.restaurant_menu_categories;
create policy restaurant_menu_categories_owner_manage on public.restaurant_menu_categories
for all to authenticated using (
  exists (select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.user_id = (select auth.uid())
      and exists (select 1 from public.partner_applications a
        where a.id = p.application_id and a.status = 'approved'))
) with check (
  exists (select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.user_id = (select auth.uid())
      and exists (select 1 from public.partner_applications a
        where a.id = p.application_id and a.status = 'approved'))
);

drop policy if exists restaurant_menu_items_public_read on public.restaurant_menu_items;
create policy restaurant_menu_items_public_read on public.restaurant_menu_items
for select to anon, authenticated using (
  is_available and exists (select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.is_published = true)
);
drop policy if exists restaurant_menu_items_owner_manage on public.restaurant_menu_items;
create policy restaurant_menu_items_owner_manage on public.restaurant_menu_items
for all to authenticated using (
  exists (select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.user_id = (select auth.uid())
      and exists (select 1 from public.partner_applications a
        where a.id = p.application_id and a.status = 'approved'))
) with check (
  exists (select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.user_id = (select auth.uid())
      and exists (select 1 from public.partner_applications a
        where a.id = p.application_id and a.status = 'approved'))
);

drop policy if exists partner_products_public_read on public.partner_products;
create policy partner_products_public_read on public.partner_products
for select to anon, authenticated using (
  is_active and stock_quantity > 0 and exists (
    select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.is_published = true
  )
);
drop policy if exists partner_products_owner_manage on public.partner_products;
create policy partner_products_owner_manage on public.partner_products
for all to authenticated using (
  exists (select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.user_id = (select auth.uid())
      and exists (select 1 from public.partner_applications a
        where a.id = p.application_id and a.status = 'approved'))
) with check (
  exists (select 1 from public.partner_business_profiles p
    where p.id = business_profile_id and p.user_id = (select auth.uid())
      and exists (select 1 from public.partner_applications a
        where a.id = p.application_id and a.status = 'approved'))
);

-- A menu item must never point to a category belonging to another business.
create or replace function public.guard_restaurant_menu_item_business()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.restaurant_menu_categories c
    where c.id = new.category_id and c.business_profile_id = new.business_profile_id
  ) then
    raise exception 'menu_category_business_mismatch';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_restaurant_menu_item_business() from public, anon, authenticated;
drop trigger if exists trg_guard_restaurant_menu_item_business on public.restaurant_menu_items;
create trigger trg_guard_restaurant_menu_item_business
before insert or update of category_id, business_profile_id on public.restaurant_menu_items
for each row execute function public.guard_restaurant_menu_item_business();

commit;
