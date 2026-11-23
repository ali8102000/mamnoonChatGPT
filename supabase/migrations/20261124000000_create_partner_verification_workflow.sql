-- Business partner verification: applications remain separate from customer/provider roles
-- until an authorized administrator approves the submitted documents.
create table if not exists public.partner_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  partner_type text not null check (partner_type in ('hotel','store','mall','company','other')),
  business_name text not null check (char_length(trim(business_name)) between 2 and 160),
  license_number text not null check (char_length(trim(license_number)) between 2 and 100),
  contact_phone text not null check (char_length(trim(contact_phone)) between 7 and 30),
  governorate text not null check (char_length(trim(governorate)) between 2 and 80),
  city text not null check (char_length(trim(city)) between 2 and 100),
  business_address text not null check (char_length(trim(business_address)) between 5 and 300),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  license_document_path text not null,
  id_front_path text not null,
  id_back_path text not null,
  additional_document_paths text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_verifications_status_created_idx
  on public.partner_verifications(status, created_at desc);
create index if not exists partner_verifications_governorate_idx
  on public.partner_verifications(governorate);

alter table public.partner_verifications enable row level security;
grant select, insert, update on public.partner_verifications to authenticated;

drop policy if exists "Partners read own verification" on public.partner_verifications;
create policy "Partners read own verification"
on public.partner_verifications for select to authenticated
using (user_id = (select auth.uid()) or has_staff_role((select auth.uid())));

drop policy if exists "Partners submit own verification" on public.partner_verifications;
create policy "Partners submit own verification"
on public.partner_verifications for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
);

drop policy if exists "Partners update own unreviewed verification" on public.partner_verifications;
create policy "Partners update own unreviewed verification"
on public.partner_verifications for update to authenticated
using (user_id = (select auth.uid()) and status in ('pending','rejected'))
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
);

drop policy if exists "Staff review partner verification" on public.partner_verifications;
create policy "Staff review partner verification"
on public.partner_verifications for update to authenticated
using (has_staff_role((select auth.uid())))
with check (has_staff_role((select auth.uid())));
