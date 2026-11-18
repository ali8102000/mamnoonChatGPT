-- Allow short, private vehicle walkaround videos alongside existing verification images.
-- Existing provider-verification RLS policies continue to restrict uploads to the
-- owner's folder and reads to the owner or authorized staff.

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'provider-verification'
      and public = false
  ) then
    raise exception 'Private provider-verification storage bucket was not found';
  end if;
end;
$$;

update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array(
    select distinct mime_type
    from unnest(
      coalesce(allowed_mime_types, array[]::text[])
      || array['video/mp4', 'video/quicktime', 'video/webm']::text[]
    ) as allowed(mime_type)
    order by mime_type
  )
where id = 'provider-verification';

-- Require a stored video path for every new or updated pending driver verification.
-- NOT VALID preserves existing legacy rows while enforcing the rule going forward.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'provider_driver_video_required_pending'
      and conrelid = 'public.provider_verifications'::regclass
  ) then
    alter table public.provider_verifications
      add constraint provider_driver_video_required_pending
      check (
        provider_type not in ('driver', 'large_driver')
        or status <> 'pending'
        or nullif(btrim(metadata ->> 'vehicleVideoPath'), '') is not null
      ) not valid;
  end if;
end;
$$;
