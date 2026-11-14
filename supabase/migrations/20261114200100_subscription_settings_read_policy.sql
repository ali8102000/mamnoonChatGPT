create policy subscription_settings_read_authenticated
on public.subscription_settings
for select
to authenticated
using (id = 1);