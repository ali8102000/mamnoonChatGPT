-- Expose only public brand fields to logged-out welcome screens.
drop policy if exists "Public can read company branding" on public.company_settings;
create policy "Public can read company branding"
  on public.company_settings for select to anon using (true);
grant select (company_name, company_logo_url, welcome_message)
  on public.company_settings to anon;
