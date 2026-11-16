-- Allow the admin rank (not general staff) to manage regional service controls.
-- The database predicate still requires the caller's own admin/super_admin role.
drop policy if exists "Super admins insert regional controls" on public.regional_service_controls;
drop policy if exists "Super admins update regional controls" on public.regional_service_controls;
drop policy if exists "Super admins delete regional controls" on public.regional_service_controls;
drop policy if exists "Only super admins manage regional controls" on public.regional_service_controls;

create policy "Admins manage regional controls"
on public.regional_service_controls
for all
to authenticated
using (public.has_admin_access(auth.uid()))
with check (public.has_admin_access(auth.uid()));

drop policy if exists "Super admins upload regional notice images" on storage.objects;
create policy "Admins upload regional notice images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'regional-notices'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.has_admin_access(auth.uid())
);
