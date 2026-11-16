alter table public.service_requests
  add column if not exists attachment_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'request-attachments',
  'request-attachments',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do nothing;

create policy "Request participants can view request attachments"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'request-attachments'
  and exists (
    select 1
    from public.service_requests sr
    where sr.id::text = (storage.foldername(name))[1]
      and (
        sr.customer_id = (select auth.uid())
        or sr.provider_id = (select auth.uid())
        or public.has_offer(sr.id, (select auth.uid()))
        or public.has_provider_ops_access((select auth.uid()))
      )
  )
);

create policy "Customers upload attachments to own requests"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'request-attachments'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1
    from public.service_requests sr
    where sr.id::text = (storage.foldername(name))[1]
      and sr.customer_id = (select auth.uid())
  )
);

create policy "Customers delete attachments from own requests"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'request-attachments'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1
    from public.service_requests sr
    where sr.id::text = (storage.foldername(name))[1]
      and sr.customer_id = (select auth.uid())
  )
);
