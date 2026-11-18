alter table public.partner_applications
  drop constraint if exists partner_applications_status_check;
alter table public.partner_applications
  add constraint partner_applications_status_check
  check (status in ('pending','approved','rejected','suspended'));

create table if not exists public.partner_business_profiles (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.partner_applications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  partner_type text not null check (partner_type in ('hotel','restaurant','store','mall')),
  business_name text not null check (char_length(trim(business_name)) between 2 and 120),
  phone text not null check (char_length(trim(phone)) between 7 and 30),
  email text,
  governorate_key text not null,
  city text not null,
  address text not null,
  description text,
  opening_hours jsonb not null default '{}'::jsonb,
  social_links jsonb not null default '{}'::jsonb,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_partner_business_profiles_user
  on public.partner_business_profiles(user_id);
create index if not exists idx_partner_business_profiles_public
  on public.partner_business_profiles(partner_type, governorate_key, city)
  where is_published = true;

alter table public.partner_business_profiles enable row level security;
grant select, insert on public.partner_business_profiles to authenticated;
grant update (business_name, phone, email, city, address, description, opening_hours, social_links, is_published, updated_at)
  on public.partner_business_profiles to authenticated;

drop policy if exists partner_business_profiles_read_owner_admin on public.partner_business_profiles;
create policy partner_business_profiles_read_owner_admin
  on public.partner_business_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.has_admin_access((select auth.uid())));

drop policy if exists partner_business_profiles_admin_insert on public.partner_business_profiles;
create policy partner_business_profiles_admin_insert
  on public.partner_business_profiles for insert to authenticated
  with check (public.has_admin_access((select auth.uid())));

drop policy if exists partner_business_profiles_owner_or_admin_update on public.partner_business_profiles;
create policy partner_business_profiles_owner_or_admin_update
  on public.partner_business_profiles for update to authenticated
  using (
    public.has_admin_access((select auth.uid()))
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.partner_applications a
        where a.id = application_id and a.user_id = (select auth.uid()) and a.status = 'approved'
      )
    )
  )
  with check (
    public.has_admin_access((select auth.uid()))
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.partner_applications a
        where a.id = application_id and a.user_id = (select auth.uid()) and a.status = 'approved'
      )
    )
  );

create or replace function public.sync_partner_business_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'approved' then
    insert into public.partner_business_profiles (
      application_id, user_id, partner_type, business_name, phone, email,
      governorate_key, city, address, description
    ) values (
      new.id, new.user_id, new.partner_type, new.business_name, new.phone, new.email,
      new.governorate_key, new.city, new.address, new.description
    )
    on conflict (application_id) do nothing;
  elsif new.status = 'suspended' then
    update public.partner_business_profiles
      set is_published = false, updated_at = now()
      where application_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_partner_business_profile() from public, anon, authenticated;
drop trigger if exists trg_sync_partner_business_profile on public.partner_applications;
create trigger trg_sync_partner_business_profile
  after insert or update of status on public.partner_applications
  for each row execute function public.sync_partner_business_profile();

insert into public.partner_business_profiles (
  application_id, user_id, partner_type, business_name, phone, email,
  governorate_key, city, address, description
)
select id, user_id, partner_type, business_name, phone, email,
       governorate_key, city, address, description
from public.partner_applications
where status = 'approved'
on conflict (application_id) do nothing;
