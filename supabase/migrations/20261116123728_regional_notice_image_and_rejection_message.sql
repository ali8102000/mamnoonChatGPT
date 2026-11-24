-- Extend the regional notice with a dedicated request-rejection message and optional image.
alter table public.regional_service_controls
  add column if not exists rejection_message text not null default 'الخدمة متوقفة مؤقتاً في منطقتك. نعتذر عن ذلك، وسيتم إعلامك عند عودة الخدمة.',
  add column if not exists message_image_url text;

-- Public read is required for customer-facing banners; authenticated uploads are
-- restricted to each uploader's own folder. Only admins can publish the URL
-- through the regional_service_controls table's existing RLS policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('regional-notices', 'regional-notices', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Regional notice images are publicly readable" on storage.objects;
create policy "Regional notice images are publicly readable"
on storage.objects for select
to public
using (bucket_id = 'regional-notices');

drop policy if exists "Users upload regional notice images to own folder" on storage.objects;
create policy "Users upload regional notice images to own folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'regional-notices'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.guard_regional_service_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detected_governorate text;
  v_rejection_message text;
begin
  if new.pickup_lat is null or new.pickup_lng is null then
    raise exception 'governorate_required'
      using message = 'موقع الانطلاق مطلوب حتى نتحقق من توفر الخدمة في محافظتك.';
  end if;

  v_detected_governorate := public.infer_governorate_key(new.pickup_lat, new.pickup_lng);
  if v_detected_governorate is null then
    raise exception 'governorate_required'
      using message = 'تعذّر تحديد المحافظة من موقع الانطلاق. حدّد الموقع من جديد ثم أرسل الطلب.';
  end if;
  new.governorate_key := v_detected_governorate;

  if not public.regional_services_enabled(new.governorate_key) then
    select nullif(trim(rejection_message), '') into v_rejection_message
    from public.regional_service_controls
    where governorate_key in (new.governorate_key, 'all')
    order by case when governorate_key = new.governorate_key then 0 else 1 end
    limit 1;

    raise exception 'regional_services_disabled'
      using message = coalesce(v_rejection_message, 'الخدمة المطلوبة متوقفة حالياً في محافظتك بقرار من إدارة ممنون.');
  end if;

  return new;
end;
$$;

create or replace function public.guard_regional_request_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_governorate_key text;
  v_rejection_message text;
begin
  v_governorate_key := case
    when old.pickup_lat is not null and old.pickup_lng is not null
      then public.infer_governorate_key(old.pickup_lat, old.pickup_lng)
    else coalesce(old.governorate_key, '')
  end;

  if new.status::text = 'accepted'
     and old.status::text is distinct from 'accepted'
     and not public.regional_services_enabled(v_governorate_key) then
    select nullif(trim(rejection_message), '') into v_rejection_message
    from public.regional_service_controls
    where governorate_key in (v_governorate_key, 'all')
    order by case when governorate_key = v_governorate_key then 0 else 1 end
    limit 1;

    raise exception 'regional_services_disabled'
      using message = coalesce(v_rejection_message, 'الخدمة المطلوبة متوقفة حالياً في محافظتك بقرار من إدارة ممنون.');
  end if;
  return new;
end;
$$;
