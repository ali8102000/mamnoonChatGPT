-- Admin visual/content builder for the web and native apps.
create table if not exists public.app_ui_elements (
  element_key text primary key,
  label text not null,
  screen_key text not null default 'home',
  placement_key text not null default 'home.customer.actions',
  element_type text not null default 'image_button'
    check (element_type in ('image_button','icon_button','card','banner','vehicle')),
  action_key text not null,
  title text,
  subtitle text,
  image_url text,
  icon_name text,
  width_px integer check (width_px is null or width_px between 16 and 600),
  height_px integer check (height_px is null or height_px between 16 and 600),
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  is_published boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  published_config jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_content_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  section_type text not null check (section_type in ('table','banner','poll','contest')),
  placement_key text not null default 'home.customer.content',
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  is_published boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  published_config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_type text not null check (campaign_type in ('poll','contest')),
  title text not null,
  description text,
  placement_key text not null default 'home.customer.content',
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft','published','closed')),
  result_visibility text not null default 'public' check (result_visibility in ('public','after_end','admin_only')),
  allow_change_vote boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.app_campaign_options (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.app_campaigns(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  unique (campaign_id, sort_order)
);

create table if not exists public.app_campaign_responses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.app_campaigns(id) on delete cascade,
  option_id uuid not null references public.app_campaign_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

create index if not exists app_ui_elements_published_order_idx
  on public.app_ui_elements (is_published, is_enabled, screen_key, placement_key, sort_order);
create index if not exists app_content_sections_published_order_idx
  on public.app_content_sections (is_published, is_enabled, placement_key, sort_order);
create index if not exists app_campaigns_published_window_idx
  on public.app_campaigns (status, starts_at, ends_at, placement_key);
create index if not exists app_campaign_options_campaign_order_idx
  on public.app_campaign_options (campaign_id, sort_order);
create index if not exists app_campaign_responses_campaign_option_idx
  on public.app_campaign_responses (campaign_id, option_id);

alter table public.app_ui_elements enable row level security;
alter table public.app_content_sections enable row level security;
alter table public.app_campaigns enable row level security;
alter table public.app_campaign_options enable row level security;
alter table public.app_campaign_responses enable row level security;

drop policy if exists "Published app UI is readable" on public.app_ui_elements;
create policy "Published app UI is readable" on public.app_ui_elements
  for select to anon, authenticated using (is_published = true and is_enabled = true);
drop policy if exists "Super admins manage app UI" on public.app_ui_elements;
create policy "Super admins manage app UI" on public.app_ui_elements
  for all to authenticated using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

drop policy if exists "Published app sections are readable" on public.app_content_sections;
create policy "Published app sections are readable" on public.app_content_sections
  for select to anon, authenticated using (is_published = true and is_enabled = true);
drop policy if exists "Super admins manage app sections" on public.app_content_sections;
create policy "Super admins manage app sections" on public.app_content_sections
  for all to authenticated using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

drop policy if exists "Published campaigns are readable" on public.app_campaigns;
create policy "Published campaigns are readable" on public.app_campaigns
  for select to anon, authenticated using (status = 'published');
drop policy if exists "Super admins manage campaigns" on public.app_campaigns;
create policy "Super admins manage campaigns" on public.app_campaigns
  for all to authenticated using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

drop policy if exists "Options for published campaigns are readable" on public.app_campaign_options;
create policy "Options for published campaigns are readable" on public.app_campaign_options
  for select to anon, authenticated using (
    exists (select 1 from public.app_campaigns c where c.id = campaign_id and c.status = 'published')
  );
drop policy if exists "Super admins manage campaign options" on public.app_campaign_options;
create policy "Super admins manage campaign options" on public.app_campaign_options
  for all to authenticated using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

drop policy if exists "Users read own campaign responses" on public.app_campaign_responses;
create policy "Users read own campaign responses" on public.app_campaign_responses
  for select to authenticated using (
    user_id = (select auth.uid()) or public.is_super_admin((select auth.uid()))
  );
drop policy if exists "Users respond once to active campaigns" on public.app_campaign_responses;
create policy "Users respond once to active campaigns" on public.app_campaign_responses
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_campaigns c
      join public.app_campaign_options o on o.campaign_id = c.id
      where c.id = public.app_campaign_responses.campaign_id and o.id = public.app_campaign_responses.option_id
        and c.status = 'published'
        and (c.starts_at is null or c.starts_at <= now())
        and (c.ends_at is null or c.ends_at > now())
    )
  );
drop policy if exists "Users may update own response when allowed" on public.app_campaign_responses;
create policy "Users may update own response when allowed" on public.app_campaign_responses
  for update to authenticated using (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_campaigns c where c.id = campaign_id and c.allow_change_vote = true and c.status = 'published')
  ) with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_campaigns c where c.id = campaign_id and c.allow_change_vote = true and c.status = 'published')
  );

create or replace function public.get_app_campaign_results(p_campaign_id uuid)
returns table(option_id uuid, vote_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select o.id, count(r.id)::bigint
  from public.app_campaigns c
  join public.app_campaign_options o on o.campaign_id = c.id
  left join public.app_campaign_responses r on r.option_id = o.id
  where c.id = p_campaign_id
    and c.status = 'published'
    and (
      public.is_super_admin((select auth.uid()))
      or c.result_visibility = 'public'
      or (c.result_visibility = 'after_end' and c.ends_at is not null and c.ends_at <= now())
    )
  group by o.id, o.sort_order
  order by o.sort_order
$function$;
revoke all on function public.get_app_campaign_results(uuid) from public;
grant execute on function public.get_app_campaign_results(uuid) to anon, authenticated;


-- Public views expose only the published visual payload, never editor drafts.
create or replace view public.app_ui_elements_public with (security_invoker = true) as
  select element_key,label,screen_key,placement_key,element_type,action_key,title,subtitle,
         sort_order,is_enabled,published_config,updated_at
  from public.app_ui_elements where is_published = true and is_enabled = true;
create or replace view public.app_content_sections_public with (security_invoker = true) as
  select id,title,section_type,placement_key,sort_order,published_config,updated_at
  from public.app_content_sections where is_published = true and is_enabled = true;
grant select on public.app_ui_elements_public to anon, authenticated;
grant select (element_key,label,screen_key,placement_key,element_type,action_key,title,subtitle,sort_order,is_enabled,is_published,published_config,updated_at)
  on public.app_ui_elements to anon;
grant select on public.app_content_sections_public to anon, authenticated;
grant select (id,title,section_type,placement_key,sort_order,is_enabled,is_published,published_config,updated_at)
  on public.app_content_sections to anon;
grant select, insert, update, delete on public.app_ui_elements, public.app_content_sections,
  public.app_campaigns, public.app_campaign_options to authenticated;
grant select, insert, update on public.app_campaign_responses to authenticated;
revoke all on public.app_ui_elements, public.app_content_sections from anon;
revoke all on public.app_campaign_responses from anon;

insert into public.app_ui_elements
  (element_key,label,screen_key,placement_key,element_type,action_key,title,subtitle,width_px,height_px,sort_order,is_published,config)
values
  ('home_customer_taxi','زر اطلب سيارة','home','home.customer.actions','image_button','request.taxi','طلب سيارة','خلال دقائق',44,44,10,true,'{"default_image":"car-luxury.png"}'::jsonb),
  ('home_customer_service','زر اطلب فني','home','home.customer.actions','image_button','request.service','طلب فني','خدمات منزلية',64,64,20,true,'{"default_image":"service-build.jpg"}'::jsonb),
  ('home_customer_large_vehicle','زر السيارات الكبيرة','home','home.customer.actions','image_button','request.large_vehicle','طلب سيارة كبيرة','كيا حمل أو كيا ركاب أو باص',44,44,30,true,'{"default_image":"service-kia-driver.png"}'::jsonb),
  ('vehicle_economy','أيقونة السيارة الاقتصادية','request.new','request.taxi.vehicle_types','vehicle','vehicle.economy','اقتصادي',null,64,64,10,true,'{}'::jsonb),
  ('vehicle_premium','أيقونة السيارة المتميزة','request.new','request.taxi.vehicle_types','vehicle','vehicle.premium','متميز',null,64,64,20,true,'{}'::jsonb),
  ('vehicle_luxury','أيقونة السيارة الفاخرة','request.new','request.taxi.vehicle_types','vehicle','vehicle.luxury','فاخر',null,64,64,30,true,'{}'::jsonb),
  ('vehicle_kia_cargo','أيقونة كيا حمل','request.new','request.large_vehicle.types','vehicle','vehicle.kia_cargo','كيا حمل',null,64,64,40,true,'{}'::jsonb),
  ('vehicle_kia_passenger','أيقونة كيا ركاب','request.new','request.large_vehicle.types','vehicle','vehicle.kia_passenger','كيا ركاب',null,64,64,50,true,'{}'::jsonb),
  ('vehicle_bus','أيقونة الباص','request.new','request.large_vehicle.types','vehicle','vehicle.bus','باص',null,64,64,60,true,'{}'::jsonb)
on conflict (element_key) do nothing;

update public.app_ui_elements
set published_config = config
where published_config = '{}'::jsonb and is_published = true;

insert into storage.buckets (id,name,public)
values ('app-visuals','app-visuals',true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can view published app visuals" on storage.objects;
create policy "Public can view published app visuals" on storage.objects
  for select to anon, authenticated using (bucket_id = 'app-visuals');
drop policy if exists "Super admins upload app visuals" on storage.objects;
create policy "Super admins upload app visuals" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'app-visuals' and public.is_super_admin((select auth.uid()))
  );
drop policy if exists "Super admins update app visuals" on storage.objects;
create policy "Super admins update app visuals" on storage.objects
  for update to authenticated using (
    bucket_id = 'app-visuals' and public.is_super_admin((select auth.uid()))
  ) with check (
    bucket_id = 'app-visuals' and public.is_super_admin((select auth.uid()))
  );
drop policy if exists "Super admins delete app visuals" on storage.objects;
create policy "Super admins delete app visuals" on storage.objects
  for delete to authenticated using (
    bucket_id = 'app-visuals' and public.is_super_admin((select auth.uid()))
  );
