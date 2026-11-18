-- Category carousel banners managed by Super Admin; shared by web and Expo Android.
create table if not exists public.home_carousel_banners (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  storage_path text,
  target_category text not null check (target_category in ('restaurant','hotel','store')),
  is_active boolean not null default false,
  scroll_speed integer not null default 5 check (scroll_speed between 2 and 30),
  display_order integer not null default 0,
  badge_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists home_carousel_banners_active_order_idx
  on public.home_carousel_banners (is_active, display_order, created_at);

alter table public.home_carousel_banners enable row level security;
drop policy if exists "Active home banners are publicly readable" on public.home_carousel_banners;
create policy "Active home banners are publicly readable"
  on public.home_carousel_banners for select to anon, authenticated
  using (is_active = true);
drop policy if exists "Super admins manage home banners" on public.home_carousel_banners;
create policy "Super admins manage home banners"
  on public.home_carousel_banners for all to authenticated
  using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

grant select on public.home_carousel_banners to anon, authenticated;
grant insert, update, delete on public.home_carousel_banners to authenticated;

-- Reuse the existing app-visuals bucket and its existing Super Admin upload policies.
insert into storage.buckets (id, name, public)
values ('app-visuals', 'app-visuals', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'home_carousel_banners'
  ) then
    alter publication supabase_realtime add table public.home_carousel_banners;
  end if;
exception when undefined_object then
  null;
end $$;
