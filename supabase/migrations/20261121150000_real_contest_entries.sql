-- Real contest entries: each campaign can accept text, image, or both.
alter table public.app_campaigns
  add column if not exists participation_mode text not null default 'options'
    check (participation_mode in ('options','text','image','both')),
  add column if not exists rules text,
  add column if not exists prize_description text;

create table if not exists public.app_campaign_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.app_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text_content text,
  image_url text,
  storage_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_campaign_entries_one_per_user unique (campaign_id, user_id),
  constraint app_campaign_entries_content_check check (
    (nullif(trim(coalesce(text_content,'')), '') is not null)
    or (image_url is not null and storage_path is not null)
  )
);

create index if not exists app_campaign_entries_campaign_status_idx
  on public.app_campaign_entries (campaign_id, status, created_at desc);
create index if not exists app_campaign_entries_user_idx
  on public.app_campaign_entries (user_id, created_at desc);

alter table public.app_campaign_entries enable row level security;
grant select, insert, update on public.app_campaign_entries to authenticated;

drop policy if exists "Users read own contest entries" on public.app_campaign_entries;
create policy "Users read own contest entries" on public.app_campaign_entries
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin((select auth.uid())));

drop policy if exists "Users submit one entry to active contests" on public.app_campaign_entries;
create policy "Users submit one entry to active contests" on public.app_campaign_entries
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_campaigns c
      where c.id = campaign_id
        and c.campaign_type = 'contest'
        and c.status = 'published'
        and c.participation_mode in ('text','image','both')
        and (c.starts_at is null or c.starts_at <= now())
        and (c.ends_at is null or c.ends_at > now())
        and (
          (c.participation_mode = 'text'
            and nullif(trim(coalesce(text_content,'')), '') is not null
            and image_url is null and storage_path is null)
          or (c.participation_mode = 'image'
            and nullif(trim(coalesce(text_content,'')), '') is null
            and image_url is not null and storage_path like (c.id::text || '/' || (select auth.uid())::text || '/%'))
          or (c.participation_mode = 'both'
            and nullif(trim(coalesce(text_content,'')), '') is not null
            and image_url is not null and storage_path like (c.id::text || '/' || (select auth.uid())::text || '/%'))
        )
    )
  );

drop policy if exists "Super admins review contest entries" on public.app_campaign_entries;
create policy "Super admins review contest entries"
  for update to authenticated
  using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

drop policy if exists "Super admins delete contest entries" on public.app_campaign_entries;
create policy "Super admins delete contest entries"
  for delete to authenticated
  using (public.is_super_admin((select auth.uid())));

drop trigger if exists app_campaign_entries_set_updated_at on public.app_campaign_entries;
create trigger app_campaign_entries_set_updated_at
  before update on public.app_campaign_entries
  for each row execute function public.set_updated_at();

-- Private storage: participants can upload only beneath their own campaign/user folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-entries', 'campaign-entries', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Users upload own contest entry images" on storage.objects;
create policy "Users upload own contest entry images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'campaign-entries'
    and (storage.foldername(name))[1] is not null
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists "Users read own contest entry images and admins read all" on storage.objects;
create policy "Users read own contest entry images and admins read all"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'campaign-entries'
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or public.is_super_admin((select auth.uid()))
    )
  );

drop policy if exists "Users delete own pending contest entry images" on storage.objects;
create policy "Users delete own pending contest entry images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'campaign-entries'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
