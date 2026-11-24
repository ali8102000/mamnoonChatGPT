-- The shared branding hook selects these five public display fields on both web and native.
-- PostgreSQL column grants are checked for the whole SELECT list: granting only the
-- original three columns made the query fail completely for anonymous welcome screens.
grant select (
  company_name,
  company_logo_url,
  welcome_message,
  company_welcome_visual_url,
  company_welcome_visual_animated
) on table public.company_settings to anon;

-- Keep the public policy scoped to reads; column-level grants above expose no admin settings.
drop policy if exists "Public can read company branding" on public.company_settings;
create policy "Public can read company branding"
  on public.company_settings
  for select
  to anon
  using (true);
