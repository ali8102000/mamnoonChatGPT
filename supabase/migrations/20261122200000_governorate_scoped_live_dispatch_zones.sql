-- Governorate and service-category scoped dispatch radii, read from Supabase at each stage.
-- Ring values are absolute maximum distances from the customer's pickup point.
create table if not exists public.regional_dispatch_zone_settings (
  governorate_key text not null,
  dispatch_type text not null check (dispatch_type in ('taxi','large_driver','technician')),
  category_key text not null default 'all',
  ring1_min_km numeric(6,2) not null default 0,
  ring1_max_km numeric(6,2) not null,
  ring2_min_km numeric(6,2) not null,
  ring2_max_km numeric(6,2) not null,
  ring3_min_km numeric(6,2) not null,
  ring3_max_km numeric(6,2) not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (governorate_key, dispatch_type, category_key),
  constraint regional_dispatch_zone_settings_governorate_check check (
    governorate_key in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')
  ),
  constraint regional_dispatch_zone_settings_ranges_check check (
    ring1_min_km = 0 and ring1_max_km > 0 and
    ring2_min_km = ring1_max_km and ring2_max_km > ring2_min_km and
    ring3_min_km = ring2_max_km and ring3_max_km > ring3_min_km and
    ring3_max_km <= 55
  ),
  constraint regional_dispatch_zone_settings_category_check check (
    category_key = 'all' or dispatch_type = 'technician'
  )
);

-- Preserve current global settings as the fallback for all provinces and services.
insert into public.regional_dispatch_zone_settings
  (governorate_key,dispatch_type,category_key,ring1_min_km,ring1_max_km,ring2_min_km,ring2_max_km,ring3_min_km,ring3_max_km)
select 'all',s.dispatch_type,'all',s.ring1_min_km,s.ring1_max_km,s.ring2_min_km,s.ring2_max_km,s.ring3_min_km,s.ring3_max_km
from public.dispatch_zone_settings s
on conflict (governorate_key,dispatch_type,category_key) do nothing;

alter table public.regional_dispatch_zone_settings enable row level security;
revoke all on public.regional_dispatch_zone_settings from public, anon, authenticated;
grant select on public.regional_dispatch_zone_settings to authenticated;
drop policy if exists "Admins read regional dispatch zones" on public.regional_dispatch_zone_settings;
create policy "Admins read regional dispatch zones"
on public.regional_dispatch_zone_settings for select to authenticated
using (public.has_admin_access(auth.uid()));

create or replace function public.get_regional_dispatch_ring(
  p_dispatch_type text,
  p_stage integer,
  p_governorate_key text,
  p_category_key text
)
returns table(min_km numeric,max_km numeric)
language sql stable security definer
set search_path = public
as $function$
  select
    case ((greatest(coalesce(p_stage,0),0) % 3)+1)
      when 1 then s.ring1_min_km when 2 then s.ring2_min_km else s.ring3_min_km end,
    case ((greatest(coalesce(p_stage,0),0) % 3)+1)
      when 1 then s.ring1_max_km when 2 then s.ring2_max_km else s.ring3_max_km end
  from public.regional_dispatch_zone_settings s
  where s.dispatch_type = p_dispatch_type
    and (
      (s.governorate_key = coalesce(nullif(lower(trim(p_governorate_key)),''),'all')
        and s.category_key = coalesce(nullif(lower(trim(p_category_key)),''),'all'))
      or (s.governorate_key = coalesce(nullif(lower(trim(p_governorate_key)),''),'all') and s.category_key='all')
      or (s.governorate_key='all' and s.category_key=coalesce(nullif(lower(trim(p_category_key)),''),'all'))
      or (s.governorate_key='all' and s.category_key='all')
    )
  order by case
    when s.governorate_key = coalesce(nullif(lower(trim(p_governorate_key)),''),'all')
      and s.category_key = coalesce(nullif(lower(trim(p_category_key)),''),'all') then 1
    when s.governorate_key = coalesce(nullif(lower(trim(p_governorate_key)),''),'all') and s.category_key='all' then 2
    when s.governorate_key='all' and s.category_key=coalesce(nullif(lower(trim(p_category_key)),''),'all') then 3
    else 4 end
  limit 1;
$function$;
revoke all on function public.get_regional_dispatch_ring(text,integer,text,text) from public,anon,authenticated;
grant execute on function public.get_regional_dispatch_ring(text,integer,text,text) to service_role;

drop function if exists public.admin_get_dispatch_zone_settings();

create function public.admin_get_dispatch_zone_settings()
returns table(
  governorate_key text, dispatch_type text, category_key text,
  ring1_min_km numeric,ring1_max_km numeric,
  ring2_min_km numeric,ring2_max_km numeric,
  ring3_min_km numeric,ring3_max_km numeric,
  updated_at timestamptz
)
language plpgsql stable security definer
set search_path = public
as $function$
begin
  if auth.uid() is null or not public.has_admin_access(auth.uid()) then
    raise exception 'forbidden';
  end if;
  return query
    select s.governorate_key,s.dispatch_type,s.category_key,s.ring1_min_km,s.ring1_max_km,
           s.ring2_min_km,s.ring2_max_km,s.ring3_min_km,s.ring3_max_km,s.updated_at
    from public.regional_dispatch_zone_settings s
    order by case s.governorate_key when 'all' then 0 else 1 end,s.governorate_key,
      case s.dispatch_type when 'taxi' then 1 when 'large_driver' then 2 else 3 end,s.category_key;
end;
$function$;

create or replace function public.admin_update_dispatch_zone_settings(
  p_governorate_key text,p_dispatch_type text,p_category_key text,
  p_ring1_max_km numeric,p_ring2_max_km numeric,p_ring3_max_km numeric
)
returns boolean
language plpgsql security definer
set search_path = public
as $function$
declare
  v_key text := lower(trim(coalesce(p_governorate_key,'')));
  v_category text := lower(trim(coalesce(p_category_key,'all')));
begin
  if auth.uid() is null or not public.has_admin_access(auth.uid()) then
    raise exception 'forbidden';
  end if;
  if v_key not in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')
     or p_dispatch_type not in ('taxi','large_driver','technician')
     or (v_category <> 'all' and (p_dispatch_type <> 'technician' or not exists (select 1 from public.services s where s.slug=v_category)))
     or p_ring1_max_km <= 0 or p_ring2_max_km <= p_ring1_max_km
     or p_ring3_max_km <= p_ring2_max_km or p_ring3_max_km > 55 then
    raise exception 'invalid_dispatch_zone_ranges';
  end if;
  insert into public.regional_dispatch_zone_settings(
    governorate_key,dispatch_type,category_key,ring1_min_km,ring1_max_km,
    ring2_min_km,ring2_max_km,ring3_min_km,ring3_max_km,updated_at,updated_by
  ) values (
    v_key,p_dispatch_type,v_category,0,p_ring1_max_km,p_ring1_max_km,p_ring2_max_km,
    p_ring2_max_km,p_ring3_max_km,now(),auth.uid()
  )
  on conflict (governorate_key,dispatch_type,category_key) do update set
    ring1_min_km=0,ring1_max_km=excluded.ring1_max_km,
    ring2_min_km=excluded.ring2_min_km,ring2_max_km=excluded.ring2_max_km,
    ring3_min_km=excluded.ring3_min_km,ring3_max_km=excluded.ring3_max_km,
    updated_at=now(),updated_by=auth.uid();
  return true;
end;
$function$;
revoke all on function public.admin_get_dispatch_zone_settings() from public,anon;
revoke all on function public.admin_update_dispatch_zone_settings(text,text,text,numeric,numeric,numeric) from public,anon;
grant execute on function public.admin_get_dispatch_zone_settings() to authenticated;
grant execute on function public.admin_update_dispatch_zone_settings(text,text,text,numeric,numeric,numeric) to authenticated;

-- Keep older clients working: the legacy four-argument RPC now updates the global fallback.
create or replace function public.admin_update_dispatch_zone_settings(
  p_dispatch_type text,p_ring1_max_km numeric,p_ring2_max_km numeric,p_ring3_max_km numeric
)
returns boolean
language plpgsql security definer
set search_path = public
as $legacy$
begin
  return public.admin_update_dispatch_zone_settings(
    'all',p_dispatch_type,'all',p_ring1_max_km,p_ring2_max_km,p_ring3_max_km
  );
end;
$legacy$;
revoke all on function public.admin_update_dispatch_zone_settings(text,numeric,numeric,numeric) from public,anon;
grant execute on function public.admin_update_dispatch_zone_settings(text,numeric,numeric,numeric) to authenticated;

-- Each dispatch stage resolves the current province + service slug from Supabase.
do $migration$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.advance_service_dispatch(uuid)'::regprocedure);
  v_new := replace(v_def,
    'get_dispatch_ring(''technician'', q.stage)',
    'get_regional_dispatch_ring(''technician'', q.stage, r.governorate_key, (select slug from public.services where id = r.service_id))');
  if v_new = v_def then raise exception 'service_dispatch_ring_anchor_missing'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.advance_taxi_dispatch(uuid)'::regprocedure);
  v_new := replace(v_def, 'get_dispatch_ring(''large_driver'', q.stage)', 'get_regional_dispatch_ring(''large_driver'', q.stage, r.governorate_key, ''all'')');
  v_new := replace(v_new, 'get_dispatch_ring(''taxi'', q.stage)', 'get_regional_dispatch_ring(''taxi'', q.stage, r.governorate_key, ''all'')');
  if v_new = v_def then raise exception 'taxi_dispatch_ring_anchor_missing'; end if;
  execute v_new;
end;
$migration$;

-- When an administrator reduces a radius, withdraw pending offers outside the active ring.
create or replace function public.enforce_live_dispatch_radius()
returns trigger
language plpgsql security definer
set search_path = public
as $function$
begin
  update public.request_offers o
  set status='cancelled',responded_at=now()
  from public.service_requests r
  left join public.service_dispatch_queue sq on sq.request_id=r.id
  left join public.taxi_dispatch_queue tq on tq.request_id=r.id
  left join public.services svc on svc.id=r.service_id
  where o.request_id=r.id and o.status='pending'
    and (new.governorate_key='all' or lower(coalesce(r.governorate_key,'all'))=new.governorate_key)
    and (
      (r.type::text='service' and sq.request_id is not null
        and (new.dispatch_type='technician')
        and (new.category_key='all' or svc.slug=new.category_key)
        and o.distance_km > (select x.max_km from public.get_regional_dispatch_ring(
          'technician',greatest(sq.stage-1,0),r.governorate_key,coalesce(svc.slug,'all')) x))
      or
      (r.type::text<>'service' and tq.request_id is not null
        and new.dispatch_type=case when r.vehicle_category::text='large' then 'large_driver' else 'taxi' end
        and o.distance_km > (select x.max_km from public.get_regional_dispatch_ring(
          case when r.vehicle_category::text='large' then 'large_driver' else 'taxi' end,
          greatest(tq.stage-1,0),r.governorate_key,'all') x))
    );
  return new;
end;
$function$;
revoke all on function public.enforce_live_dispatch_radius() from public,anon,authenticated;
drop trigger if exists enforce_live_dispatch_radius_after_update on public.regional_dispatch_zone_settings;
create trigger enforce_live_dispatch_radius_after_update
after insert or update on public.regional_dispatch_zone_settings
for each row execute function public.enforce_live_dispatch_radius();

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='regional_dispatch_zone_settings') then
    alter publication supabase_realtime add table public.regional_dispatch_zone_settings;
  end if;
end
$realtime$;
