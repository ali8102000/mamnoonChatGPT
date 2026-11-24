-- Admin-controlled weather-aware taxi peak pricing. Defaults are deliberately OFF.
create table if not exists public.taxi_peak_weather_settings (
  governorate_key text primary key,
  mode text not null default 'off' check (mode in ('auto','notify','off')),
  enabled boolean not null default false,
  rain_threshold_mm numeric not null default 1 check (rain_threshold_mm between 0 and 100),
  heat_threshold_c numeric not null default 42 check (heat_threshold_c between 0 and 60),
  max_surcharge_percent numeric not null default 15 check (max_surcharge_percent between 0 and 100),
  min_pending_requests integer not null default 5 check (min_pending_requests between 0 and 10000),
  max_active_drivers integer not null default 20 check (max_active_drivers between 0 and 100000),
  weather_max_age_minutes integer not null default 15 check (weather_max_age_minutes between 5 and 120),
  gps_max_age_minutes integer not null default 3 check (gps_max_age_minutes between 1 and 30),
  cooldown_minutes integer not null default 20 check (cooldown_minutes between 5 and 240),
  last_decision text,
  last_reason text,
  last_checked_at timestamptz,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint taxi_peak_weather_governorate_valid check (governorate_key in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah'))
);

create table if not exists public.taxi_peak_weather_observations (
  governorate_key text primary key references public.taxi_peak_weather_settings(governorate_key) on delete cascade,
  temperature_c numeric,
  rain_mm numeric,
  condition_text text,
  observed_at timestamptz,
  fetched_at timestamptz not null default now(),
  provider text not null default 'weatherapi',
  is_fresh boolean not null default false,
  error text,
  alerts jsonb not null default '[]'::jsonb
);

create table if not exists public.taxi_peak_weather_decisions (
  id bigint generated always as identity primary key,
  governorate_key text not null,
  mode text not null check (mode in ('auto','notify','off')),
  decision text not null check (decision in ('suggest_on','suggest_off','activated','deactivated','skipped','admin_on','admin_off')),
  reason text not null,
  weather jsonb not null default '{}'::jsonb,
  demand jsonb not null default '{}'::jsonb,
  surcharge_percent numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists taxi_peak_weather_decisions_recent_idx
  on public.taxi_peak_weather_decisions (governorate_key, created_at desc);

alter table public.taxi_peak_weather_settings enable row level security;
alter table public.taxi_peak_weather_observations enable row level security;
alter table public.taxi_peak_weather_decisions enable row level security;

drop policy if exists "admins read taxi peak weather settings" on public.taxi_peak_weather_settings;
create policy "admins read taxi peak weather settings" on public.taxi_peak_weather_settings
for select to authenticated using (
  public.admin_has_permission('pricing.peak.edit',
    case when governorate_key='all' then 'global' else 'governorate' end,
    case when governorate_key='all' then null else governorate_key end)
);
drop policy if exists "admins read taxi peak weather observations" on public.taxi_peak_weather_observations;
create policy "admins read taxi peak weather observations" on public.taxi_peak_weather_observations
for select to authenticated using (
  public.admin_has_permission('pricing.peak.edit',
    case when governorate_key='all' then 'global' else 'governorate' end,
    case when governorate_key='all' then null else governorate_key end)
);
drop policy if exists "admins read taxi peak weather decisions" on public.taxi_peak_weather_decisions;
create policy "admins read taxi peak weather decisions" on public.taxi_peak_weather_decisions
for select to authenticated using (
  public.admin_has_permission('pricing.peak.edit',
    case when governorate_key='all' then 'global' else 'governorate' end,
    case when governorate_key='all' then null else governorate_key end)
);

create or replace function public.admin_save_taxi_peak_weather_settings(
  p_governorate_key text,
  p_mode text,
  p_enabled boolean,
  p_rain_threshold_mm numeric,
  p_heat_threshold_c numeric,
  p_max_surcharge_percent numeric,
  p_min_pending_requests integer,
  p_max_active_drivers integer,
  p_weather_max_age_minutes integer,
  p_gps_max_age_minutes integer,
  p_cooldown_minutes integer
) returns public.taxi_peak_weather_settings
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_row public.taxi_peak_weather_settings%rowtype; v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_governorate_key not in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah') then raise exception 'invalid_governorate'; end if;
  if p_mode not in ('auto','notify','off') then raise exception 'invalid_mode'; end if;
  if p_rain_threshold_mm not between 0 and 100 or p_heat_threshold_c not between 0 and 60
    or p_max_surcharge_percent not between 0 and 100
    or p_min_pending_requests not between 0 and 10000
    or p_max_active_drivers not between 0 and 100000
    or p_weather_max_age_minutes not between 5 and 120
    or p_gps_max_age_minutes not between 1 and 30
    or p_cooldown_minutes not between 5 and 240 then raise exception 'invalid_settings'; end if;
  if not public.admin_has_permission('pricing.peak.edit',
    case when p_governorate_key='all' then 'global' else 'governorate' end,
    case when p_governorate_key='all' then null else p_governorate_key end) then raise exception 'missing_pricing_permission'; end if;

  insert into public.taxi_peak_weather_settings(
    governorate_key,mode,enabled,rain_threshold_mm,heat_threshold_c,max_surcharge_percent,
    min_pending_requests,max_active_drivers,weather_max_age_minutes,gps_max_age_minutes,cooldown_minutes,updated_by,updated_at
  ) values (
    p_governorate_key,p_mode,p_enabled,p_rain_threshold_mm,p_heat_threshold_c,p_max_surcharge_percent,
    p_min_pending_requests,p_max_active_drivers,p_weather_max_age_minutes,p_gps_max_age_minutes,p_cooldown_minutes,v_actor,now()
  )
  on conflict(governorate_key) do update set
    mode=excluded.mode, enabled=excluded.enabled, rain_threshold_mm=excluded.rain_threshold_mm,
    heat_threshold_c=excluded.heat_threshold_c, max_surcharge_percent=excluded.max_surcharge_percent,
    min_pending_requests=excluded.min_pending_requests,max_active_drivers=excluded.max_active_drivers,
    weather_max_age_minutes=excluded.weather_max_age_minutes,gps_max_age_minutes=excluded.gps_max_age_minutes,
    cooldown_minutes=excluded.cooldown_minutes,updated_by=v_actor,updated_at=now()
  returning * into v_row;

  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'pricing.peak.weather.settings.updated','taxi_peak_weather_settings',p_governorate_key,to_jsonb(v_row));
  return v_row;
end $$;

grant select on public.taxi_peak_weather_settings, public.taxi_peak_weather_observations, public.taxi_peak_weather_decisions to authenticated;
grant execute on function public.admin_save_taxi_peak_weather_settings(text,text,boolean,numeric,numeric,numeric,integer,integer,integer,integer,integer) to authenticated;


-- Seed one independently configurable weather scope for every Iraqi governorate.
insert into public.taxi_peak_weather_settings(governorate_key)
values
 ('baghdad'),('basra'),('nineveh'),('erbil'),('sulaymaniyah'),('duhok'),
 ('kirkuk'),('najaf'),('karbala'),('babil'),('anbar'),('diyala'),
 ('saladin'),('wasit'),('dhiqar'),('maysan'),('muthanna'),('qadisiyah'),('all')
on conflict(governorate_key) do nothing;

-- Privacy-preserving live traffic observations: only aggregated delay percentages,
-- never pickup/dropoff coordinates, request IDs, or driver identifiers.
create table if not exists public.taxi_peak_traffic_observations (
  governorate_key text primary key,
  sample_count integer not null default 0 check (sample_count >= 0),
  average_delay_percent numeric not null default 0 check (average_delay_percent between 0 and 1000),
  maximum_delay_percent numeric not null default 0 check (maximum_delay_percent between 0 and 1000),
  last_delay_percent numeric not null default 0 check (last_delay_percent between 0 and 1000),
  last_sampled_at timestamptz,
  window_started_at timestamptz,
  provider text not null default 'google_routes_traffic',
  is_fresh boolean not null default false,
  last_error text,
  constraint taxi_peak_traffic_governorate_valid check (governorate_key in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah'))
);
alter table public.taxi_peak_traffic_observations enable row level security;
drop policy if exists "admins read taxi peak traffic observations" on public.taxi_peak_traffic_observations;
create policy "admins read taxi peak traffic observations"
on public.taxi_peak_traffic_observations for select to authenticated
using (public.admin_has_permission('pricing.peak.edit',
  case when governorate_key='all' then 'global' else 'governorate' end,
  case when governorate_key='all' then null else governorate_key end));
grant select on public.taxi_peak_traffic_observations to authenticated;

create or replace function public.record_taxi_peak_traffic_sample(
  p_governorate_key text,
  p_traffic_ratio numeric,
  p_provider text default 'google_routes_traffic'
) returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_delay numeric;
  v_old public.taxi_peak_traffic_observations%rowtype;
  v_reset boolean;
begin
  if p_governorate_key not in ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')
     or p_traffic_ratio is null or p_traffic_ratio::text in ('NaN','Infinity','-Infinity')
     or p_traffic_ratio <= 0 or p_traffic_ratio > 11
     or p_provider <> 'google_routes_traffic' then
    raise exception 'invalid_traffic_sample';
  end if;
  v_delay := round(greatest(0,(p_traffic_ratio-1)*100),2);
  select * into v_old from public.taxi_peak_traffic_observations
    where governorate_key=p_governorate_key for update;
  v_reset := not found or v_old.last_sampled_at is null
    or v_old.last_sampled_at < now()-interval '60 minutes';

  insert into public.taxi_peak_traffic_observations(
    governorate_key,sample_count,average_delay_percent,maximum_delay_percent,
    last_delay_percent,last_sampled_at,window_started_at,provider,is_fresh,last_error
  ) values (
    p_governorate_key,1,v_delay,v_delay,v_delay,now(),now(),'google_routes_traffic',true,null
  )
  on conflict(governorate_key) do update set
    sample_count=case when v_reset then 1 else least(taxi_peak_traffic_observations.sample_count+1,100000) end,
    average_delay_percent=case when v_reset then excluded.average_delay_percent
      else round(((taxi_peak_traffic_observations.average_delay_percent*taxi_peak_traffic_observations.sample_count)+excluded.average_delay_percent)
        / greatest(taxi_peak_traffic_observations.sample_count+1,1),2) end,
    maximum_delay_percent=case when v_reset then excluded.maximum_delay_percent
      else greatest(taxi_peak_traffic_observations.maximum_delay_percent,excluded.maximum_delay_percent) end,
    last_delay_percent=excluded.last_delay_percent,
    last_sampled_at=excluded.last_sampled_at,
    window_started_at=case when v_reset then excluded.window_started_at else taxi_peak_traffic_observations.window_started_at end,
    provider=excluded.provider,is_fresh=true,last_error=null;
end $$;
revoke all on function public.record_taxi_peak_traffic_sample(text,numeric,text) from public,anon,authenticated;
grant execute on function public.record_taxi_peak_traffic_sample(text,numeric,text) to service_role;

-- Refresh every 15 minutes. The job stays dormant until project_url and secret_key
-- are added to Supabase Vault; it never embeds a credential in the migration.
select cron.schedule(
  'mamnoon-weather-monitor',
  '*/15 * * * *',
  $job$
    select case
      when exists (select 1 from vault.decrypted_secrets where name='project_url')
       and exists (select 1 from vault.decrypted_secrets where name='secret_key')
      then net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/weather-monitor',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'apikey',(select decrypted_secret from vault.decrypted_secrets where name='secret_key')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 20000
      )
      else null
    end;
  $job$
);
