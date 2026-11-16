-- Regional service controls: per-governorate availability and official moving notices.
create table if not exists public.regional_service_controls (
  governorate_key text primary key,
  services_enabled boolean not null default true,
  message_enabled boolean not null default false,
  message_title text not null default 'تنويه رسمي من إدارة ممنون',
  message_text text not null default '',
  message_animate boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regional_service_controls_governorate_key_check check (
    governorate_key in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')
  ),
  constraint regional_service_controls_message_title_check check (char_length(message_title) between 2 and 100),
  constraint regional_service_controls_message_text_check check (char_length(message_text) <= 1200)
);

create or replace function public.touch_regional_service_control()
returns trigger
language plpgsql
security invoker
set search_path = public
as $touch$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$touch$;

drop trigger if exists touch_regional_service_control_before_write on public.regional_service_controls;
create trigger touch_regional_service_control_before_write
before insert or update on public.regional_service_controls
for each row execute function public.touch_regional_service_control();

alter table public.regional_service_controls enable row level security;
grant select on public.regional_service_controls to anon, authenticated;
grant insert, update, delete on public.regional_service_controls to authenticated;

drop policy if exists "Regional controls are publicly readable" on public.regional_service_controls;
create policy "Regional controls are publicly readable"
on public.regional_service_controls for select
to anon, authenticated using (true);

drop policy if exists "Only super admins manage regional controls" on public.regional_service_controls;
create policy "Only super admins manage regional controls"
on public.regional_service_controls for all
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

alter table public.service_requests
  add column if not exists governorate_key text;

create index if not exists service_requests_governorate_status_idx
  on public.service_requests (governorate_key, status, created_at desc);

create or replace function public.regional_services_enabled(p_governorate_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.regional_service_controls c
       where c.governorate_key = 'all' and c.services_enabled = false
    ) then false
    else coalesce(
      (select c.services_enabled
         from public.regional_service_controls c
        where c.governorate_key = lower(trim(coalesce(p_governorate_key,'')))
        limit 1),
      (select c.services_enabled
         from public.regional_service_controls c
        where c.governorate_key = 'all'
        limit 1),
      true
    )
  end;
$$;

revoke all on function public.regional_services_enabled(text) from public;
grant execute on function public.regional_services_enabled(text) to anon, authenticated;


create or replace function public.infer_governorate_key(p_lat numeric, p_lng numeric)
returns text
language sql
immutable
set search_path = public
as $infer$
  select g.key
    from (values
      ('baghdad',33.3152,44.3661),('basra',30.5085,47.7804),('nineveh',36.34,43.13),
      ('erbil',36.1911,44.0092),('sulaymaniyah',35.5613,45.4306),('duhok',36.8669,42.9503),
      ('kirkuk',35.4681,44.3922),('najaf',32.0259,44.3462),('karbala',32.616,44.0249),
      ('babil',32.4637,44.4196),('anbar',33.4206,43.3058),('diyala',33.7502,44.6066),
      ('saladin',34.6,43.68),('wasit',32.5128,45.8182),('dhiqar',31.0439,46.2573),
      ('maysan',31.8356,47.1449),('muthanna',31.3099,45.2803),('qadisiyah',31.9929,44.925)
    ) as g(key, lat, lng)
   order by power(p_lat::double precision - g.lat, 2)
          + power((p_lng::double precision - g.lng) * cos(radians(p_lat::double precision)), 2)
   limit 1;
$infer$;

create or replace function public.guard_regional_service_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.governorate_key is null or length(trim(new.governorate_key)) = 0 then
    if new.pickup_lat is not null and new.pickup_lng is not null then
      new.governorate_key := public.infer_governorate_key(new.pickup_lat, new.pickup_lng);
    end if;
  end if;
  if new.governorate_key is null or length(trim(new.governorate_key)) = 0 then
    raise exception 'governorate_required'
      using message = 'تعذّر تحديد المحافظة. حدّد موقع الانطلاق من جديد ثم أرسل الطلب.';
  end if;

  if not public.regional_services_enabled(new.governorate_key) then
    raise exception 'regional_services_disabled'
      using message = 'الخدمات متوقفة مؤقتاً في محافظتك بقرار من إدارة ممنون.';
  end if;

  return new;
end;
$$;

revoke all on function public.infer_governorate_key(numeric,numeric) from public;
grant execute on function public.infer_governorate_key(numeric,numeric) to anon, authenticated;

drop trigger if exists guard_regional_service_request_before_insert on public.service_requests;
create trigger guard_regional_service_request_before_insert
before insert on public.service_requests
for each row execute function public.guard_regional_service_request();

create or replace function public.guard_regional_request_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text = 'accepted'
     and old.status::text is distinct from 'accepted'
     and not public.regional_services_enabled(old.governorate_key) then
    raise exception 'regional_services_disabled'
      using message = 'الخدمات متوقفة حالياً في هذه المحافظة بقرار من الإدارة.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_regional_request_acceptance_before_update on public.service_requests;
create trigger guard_regional_request_acceptance_before_update
before update of status, provider_id on public.service_requests
for each row execute function public.guard_regional_request_acceptance();

create or replace function public.guard_regional_request_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_governorate_key text;
begin
  select sr.governorate_key into v_governorate_key
    from public.service_requests sr
   where sr.id = new.request_id;

  if new.status = 'pending' and not public.regional_services_enabled(v_governorate_key) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_regional_request_offer_before_write on public.request_offers;
create trigger guard_regional_request_offer_before_write
before insert or update on public.request_offers
for each row execute function public.guard_regional_request_offer();

create or replace function public.cleanup_disabled_regional_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.service_requests sr
     set governorate_key = public.infer_governorate_key(sr.pickup_lat, sr.pickup_lng)
   where sr.governorate_key is null
     and sr.pickup_lat is not null
     and sr.pickup_lng is not null;

  update public.request_offers o
     set status = 'cancelled', responded_at = now()
    from public.service_requests sr
   where sr.id = o.request_id
     and o.status = 'pending'
     and not public.regional_services_enabled(sr.governorate_key);

  delete from public.service_dispatch_queue q
   using public.service_requests sr
   where sr.id = q.request_id
     and not public.regional_services_enabled(sr.governorate_key);

  delete from public.taxi_dispatch_queue q
   using public.service_requests sr
   where sr.id = q.request_id
     and not public.regional_services_enabled(sr.governorate_key);

  return null;
end;
$$;

drop trigger if exists cleanup_disabled_regional_dispatch_after_change on public.regional_service_controls;
create trigger cleanup_disabled_regional_dispatch_after_change
after insert or update or delete on public.regional_service_controls
for each statement execute function public.cleanup_disabled_regional_dispatch();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'regional_service_controls'
     ) then
    alter publication supabase_realtime add table public.regional_service_controls;
  end if;
end $$;
