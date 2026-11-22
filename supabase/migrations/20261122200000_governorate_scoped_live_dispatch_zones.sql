-- Governorate-scoped dispatch radii, read from Supabase on every dispatch stage.
-- Each ring is an absolute maximum radius from the customer's pickup point:
-- ring 1: 0..R1, ring 2: R1..R2, ring 3: R2..R3.
create table if not exists public.regional_dispatch_zone_settings (
  governorate_key text not null,
  dispatch_type text not null check (dispatch_type in ('taxi','large_driver','technician')),
  ring1_min_km numeric(6,2) not null default 0,
  ring1_max_km numeric(6,2) not null,
  ring2_min_km numeric(6,2) not null,
  ring2_max_km numeric(6,2) not null,
  ring3_min_km numeric(6,2) not null,
  ring3_max_km numeric(6,2) not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (governorate_key, dispatch_type),
  constraint regional_dispatch_zone_settings_governorate_check check (
    governorate_key in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')
  ),
  constraint regional_dispatch_zone_settings_ranges_check check (
    ring1_min_km = 0 and ring1_max_km > 0 and
    ring2_min_km = ring1_max_km and ring2_max_km > ring2_min_km and
    ring3_min_km = ring2_max_km and ring3_max_km > ring3_min_km and
    ring3_max_km <= 55
  )
);

-- Preserve the current global admin values as the fallback for every governorate.
insert into public.regional_dispatch_zone_settings
  (governorate_key,dispatch_type,ring1_min_km,ring1_max_km,ring2_min_km,ring2_max_km,ring3_min_km,ring3_max_km)
select g.governorate_key,s.dispatch_type,s.ring1_min_km,s.ring1_max_km,s.ring2_min_km,s.ring2_max_km,s.ring3_min_km,s.ring3_max_km
from (values
 ('all'),('baghdad'),('basra'),('nineveh'),('erbil'),('sulaymaniyah'),('duhok'),('kirkuk'),
 ('najaf'),('karbala'),('babil'),('anbar'),('diyala'),('saladin'),('wasit'),('dhiqar'),('maysan'),('muthanna'),('qadisiyah')
) g(governorate_key)
cross join public.dispatch_zone_settings s
on conflict (governorate_key,dispatch_type) do nothing;

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
  p_governorate_key text
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
    and s.governorate_key = coalesce(nullif(lower(trim(p_governorate_key)),''),'all')
  union all
  select
    case ((greatest(coalesce(p_stage,0),0) % 3)+1)
      when 1 then s.ring1_min_km when 2 then s.ring2_min_km else s.ring3_min_km end,
    case ((greatest(coalesce(p_stage,0),0) % 3)+1)
      when 1 then s.ring1_max_km when 2 then s.ring2_max_km else s.ring3_max_km end
  from public.regional_dispatch_zone_settings s
  where s.dispatch_type = p_dispatch_type and s.governorate_key = 'all'
    and coalesce(nullif(lower(trim(p_governorate_key)),''),'all') <> 'all'
    and not exists (
      select 1 from public.regional_dispatch_zone_settings x
      where x.dispatch_type=p_dispatch_type
        and x.governorate_key=coalesce(nullif(lower(trim(p_governorate_key)),''),'all')
    )
  limit 1;
$function$;
revoke all on function public.get_regional_dispatch_ring(text,integer,text) from public,anon,authenticated;
grant execute on function public.get_regional_dispatch_ring(text,integer,text) to service_role;

create or replace function public.admin_get_dispatch_zone_settings()
returns table(
  governorate_key text, dispatch_type text,
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
    select s.governorate_key,s.dispatch_type,s.ring1_min_km,s.ring1_max_km,
           s.ring2_min_km,s.ring2_max_km,s.ring3_min_km,s.ring3_max_km,s.updated_at
    from public.regional_dispatch_zone_settings s
    order by case s.governorate_key when 'all' then 0 else 1 end,s.governorate_key,
      case s.dispatch_type when 'taxi' then 1 when 'large_driver' then 2 else 3 end;
end;
$function$;

create or replace function public.admin_update_dispatch_zone_settings(
  p_governorate_key text,p_dispatch_type text,
  p_ring1_max_km numeric,p_ring2_max_km numeric,p_ring3_max_km numeric
)
returns boolean
language plpgsql security definer
set search_path = public
as $function$
declare
  v_key text := lower(trim(coalesce(p_governorate_key,'')));
begin
  if auth.uid() is null or not public.has_admin_access(auth.uid()) then
    raise exception 'forbidden';
  end if;
  if v_key not in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')
     or p_dispatch_type not in ('taxi','large_driver','technician')
     or p_ring1_max_km <= 0 or p_ring2_max_km <= p_ring1_max_km
     or p_ring3_max_km <= p_ring2_max_km or p_ring3_max_km > 55 then
    raise exception 'invalid_dispatch_zone_ranges';
  end if;
  insert into public.regional_dispatch_zone_settings(
    governorate_key,dispatch_type,ring1_min_km,ring1_max_km,
    ring2_min_km,ring2_max_km,ring3_min_km,ring3_max_km,updated_at,updated_by
  ) values (
    v_key,p_dispatch_type,0,p_ring1_max_km,p_ring1_max_km,p_ring2_max_km,
    p_ring2_max_km,p_ring3_max_km,now(),auth.uid()
  )
  on conflict (governorate_key,dispatch_type) do update set
    ring1_min_km=0,ring1_max_km=excluded.ring1_max_km,
    ring2_min_km=excluded.ring2_min_km,ring2_max_km=excluded.ring2_max_km,
    ring3_min_km=excluded.ring3_min_km,ring3_max_km=excluded.ring3_max_km,
    updated_at=now(),updated_by=auth.uid();
  return true;
end;
$function$;
revoke all on function public.admin_get_dispatch_zone_settings() from public,anon;
revoke all on function public.admin_update_dispatch_zone_settings(text,text,numeric,numeric,numeric) from public,anon;
grant execute on function public.admin_get_dispatch_zone_settings() to authenticated;
grant execute on function public.admin_update_dispatch_zone_settings(text,text,numeric,numeric,numeric) to authenticated;

-- Every dispatch stage now reads the current governorate values from Supabase.
do $migration$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.advance_service_dispatch(uuid)'::regprocedure);
  v_new := replace(v_def, 'get_dispatch_ring(''technician'', q.stage)', 'get_regional_dispatch_ring(''technician'', q.stage, r.governorate_key)');
  if v_new = v_def then raise exception 'service_dispatch_ring_anchor_missing'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.advance_taxi_dispatch(uuid)'::regprocedure);
  v_new := replace(v_def, 'get_dispatch_ring(''large_driver'', q.stage)', 'get_regional_dispatch_ring(''large_driver'', q.stage, r.governorate_key)');
  v_new := replace(v_new, 'get_dispatch_ring(''taxi'', q.stage)', 'get_regional_dispatch_ring(''taxi'', q.stage, r.governorate_key)');
  if v_new = v_def then raise exception 'taxi_dispatch_ring_anchor_missing'; end if;
  execute v_new;
end;
$migration$;

-- When an administrator reduces a radius, withdraw still-pending offers outside
-- the active ring immediately. Accepted providers are never silently removed.
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
  where o.request_id=r.id and o.status='pending'
    and lower(coalesce(r.governorate_key,'all'))=new.governorate_key
    and (
      (r.type::text='service' and sq.request_id is not null
        and o.distance_km > (select x.max_km from public.get_regional_dispatch_ring('technician',greatest(sq.stage-1,0),r.governorate_key) x))
      or
      (r.type::text<>'service' and tq.request_id is not null
        and o.distance_km > (select x.max_km from public.get_regional_dispatch_ring(case when r.vehicle_category::text='large' then 'large_driver' else 'taxi' end,greatest(tq.stage-1,0),r.governorate_key) x))
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
