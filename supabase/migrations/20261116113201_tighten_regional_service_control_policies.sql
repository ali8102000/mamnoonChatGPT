drop policy if exists "Only super admins manage regional controls" on public.regional_service_controls;

create policy "Super admins insert regional controls"
on public.regional_service_controls
for insert
to authenticated
with check (public.is_super_admin((select auth.uid())));

create policy "Super admins update regional controls"
on public.regional_service_controls
for update
to authenticated
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

create policy "Super admins delete regional controls"
on public.regional_service_controls
for delete
to authenticated
using (public.is_super_admin((select auth.uid())));
