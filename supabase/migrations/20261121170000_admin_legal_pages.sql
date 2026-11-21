-- Editable legal pages for web and native clients. Production rollout is intentionally separate.
create table if not exists public.app_legal_pages (
  slug text primary key check (slug in ('privacy','terms')),
  title text not null,
  body text not null default '',
  is_published boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.app_legal_pages enable row level security;

drop policy if exists "Published legal pages are readable" on public.app_legal_pages;
create policy "Published legal pages are readable" on public.app_legal_pages
  for select to anon, authenticated using (is_published = true);

drop policy if exists "Super admins manage legal pages" on public.app_legal_pages;
create policy "Super admins manage legal pages" on public.app_legal_pages
  for all to authenticated
  using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

grant select on public.app_legal_pages to anon, authenticated;
grant insert, update, delete on public.app_legal_pages to authenticated;

insert into public.app_legal_pages (slug,title,body,is_published)
values
  ('privacy','سياسة الخصوصية','',true),
  ('terms','الشروط والأحكام','',true)
on conflict (slug) do nothing;
