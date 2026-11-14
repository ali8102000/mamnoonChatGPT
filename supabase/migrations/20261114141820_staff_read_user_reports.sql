drop policy if exists "Staff can review user reports" on public.user_reports;
create policy "Staff can review user reports"
on public.user_reports
for select
to authenticated
using (public.has_staff_role((select auth.uid())));
