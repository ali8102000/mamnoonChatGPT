-- Shared app media and presentation settings managed from the App Editor.
create table if not exists public.app_editor_settings (
  id text primary key check (id = 'global'),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.app_editor_settings enable row level security;

drop policy if exists "App editor settings are publicly readable" on public.app_editor_settings;
create policy "App editor settings are publicly readable"
  on public.app_editor_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "Only super admins manage app editor settings" on public.app_editor_settings;
create policy "Only super admins manage app editor settings"
  on public.app_editor_settings for all
  to authenticated
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

insert into public.app_editor_settings (id, settings)
values ('global', jsonb_build_object(
  'version', 1,
  'images', jsonb_build_object(
    'storeCategory', jsonb_build_object('url', '', 'scale', 1, 'x', 50, 'y', 50),
    'restaurantCategory', jsonb_build_object('url', '', 'scale', 1, 'x', 50, 'y', 50),
    'vehicleEconomy', jsonb_build_object('url', '', 'scale', 1, 'x', 50, 'y', 50),
    'vehiclePremium', jsonb_build_object('url', '', 'scale', 1, 'x', 50, 'y', 50),
    'vehicleLuxury', jsonb_build_object('url', '', 'scale', 1, 'x', 50, 'y', 50),
    'providerBanner', jsonb_build_object('url', '', 'scale', 1, 'x', 50, 'y', 50)
  )
))
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-editor-media', 'app-editor-media', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "App editor media is publicly readable" on storage.objects;
create policy "App editor media is publicly readable"
  on storage.objects for select
  using (bucket_id = 'app-editor-media');

drop policy if exists "Super admins upload app editor media" on storage.objects;
create policy "Super admins upload app editor media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'app-editor-media' and public.is_super_admin(auth.uid()));

drop policy if exists "Super admins update app editor media" on storage.objects;
create policy "Super admins update app editor media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'app-editor-media' and public.is_super_admin(auth.uid()))
  with check (bucket_id = 'app-editor-media' and public.is_super_admin(auth.uid()));

drop policy if exists "Super admins delete app editor media" on storage.objects;
create policy "Super admins delete app editor media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'app-editor-media' and public.is_super_admin(auth.uid()));
