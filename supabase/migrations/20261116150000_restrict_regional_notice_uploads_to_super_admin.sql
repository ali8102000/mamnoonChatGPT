drop policy if exists "Users upload regional notice images to own folder" on storage.objects;
create policy "Super admins upload regional notice images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'regional-notices'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.is_super_admin((select auth.uid()))
);
