create table if not exists public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  partner_type text not null check (partner_type in ('hotel','restaurant','store','mall')),
  business_name text not null check (char_length(trim(business_name)) between 2 and 120),
  contact_name text not null check (char_length(trim(contact_name)) between 2 and 100),
  phone text not null check (char_length(trim(phone)) between 7 and 30),
  email text,
  governorate_key text not null check (governorate_key in ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')),
  city text not null check (char_length(trim(city)) between 2 and 80),
  address text not null check (char_length(trim(address)) between 4 and 240),
  description text,
  mall_unit_type text check (mall_unit_type is null or mall_unit_type in ('mall','shop','kiosk')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_mall_type_required check (
    (partner_type in ('store','mall') and mall_unit_type is not null)
    or (partner_type in ('hotel','restaurant') and mall_unit_type is null)
  )
);
create index if not exists idx_partner_applications_user_created on public.partner_applications (user_id, created_at desc);
create index if not exists idx_partner_applications_status_created on public.partner_applications (status, created_at desc);
create unique index if not exists idx_partner_applications_one_pending_per_type on public.partner_applications (user_id, partner_type) where status = 'pending';
alter table public.partner_applications enable row level security;
grant select, insert, update on public.partner_applications to authenticated;
drop policy if exists partner_applications_read_own_or_admin on public.partner_applications;
create policy partner_applications_read_own_or_admin on public.partner_applications for select to authenticated using (user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())));
drop policy if exists partner_applications_insert_own_pending on public.partner_applications;
create policy partner_applications_insert_own_pending on public.partner_applications for insert to authenticated with check (user_id = (select auth.uid()) and status = 'pending' and reviewed_by is null and reviewed_at is null);
drop policy if exists partner_applications_admin_update on public.partner_applications;
create policy partner_applications_admin_update on public.partner_applications for update to authenticated using (public.has_admin_access((select auth.uid()))) with check (public.has_admin_access((select auth.uid())));
