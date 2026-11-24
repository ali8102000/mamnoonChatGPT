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

alter table public.taxi_peak_weather_settings
  add column if not exists weather_monitor_ready boolean not null default false;

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
declare
  v_row public.taxi_peak_weather_settings%rowtype;
  v_actor uuid := auth.uid();
  v_ready boolean;
  v_fresh_count integer;
  v_expected_count integer;
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

  -- This release collects and displays weather observations only.
  -- Notifications and all automatic pricing remain disabled until their decision engine is implemented and verified.
  if p_mode<>'off' or p_enabled then raise exception 'weather_decision_engine_not_enabled'; end if;
  if p_enabled then
    select coalesce(weather_monitor_ready,false) into v_ready
      from public.taxi_peak_weather_settings
      where governorate_key=p_governorate_key;
    if not coalesce(v_ready,false) then raise exception 'weather_monitor_not_ready'; end if;

    if p_governorate_key='all' then
      select count(*) into v_expected_count
        from public.taxi_peak_weather_settings where governorate_key<>'all';
      select count(*) into v_fresh_count
        from public.taxi_peak_weather_observations
        where is_fresh=true
          and observed_at >= now() - make_interval(mins => p_weather_max_age_minutes)
          and observed_at <= now() + interval '2 minutes';
      if v_expected_count=0 or v_fresh_count<>v_expected_count then
        raise exception 'weather_observations_not_fresh_for_all_governorates';
      end if;
    else
      select count(*) into v_fresh_count
        from public.taxi_peak_weather_observations
        where governorate_key=p_governorate_key
          and is_fresh=true
          and observed_at >= now() - make_interval(mins => p_weather_max_age_minutes)
          and observed_at <= now() + interval '2 minutes';
      if v_fresh_count<>1 then raise exception 'weather_observation_not_fresh'; end if;
    end if;
  end if;

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
revoke all on function public.admin_save_taxi_peak_weather_settings(text,text,boolean,numeric,numeric,numeric,integer,integer,integer,integer,integer) from public, anon;
grant execute on function public.admin_save_taxi_peak_weather_settings(text,text,boolean,numeric,numeric,numeric,integer,integer,integer,integer,integer) to authenticated;


-- Seed one independently configurable weather scope for every Iraqi governorate.
insert into public.taxi_peak_weather_settings(governorate_key)
values
 ('baghdad'),('basra'),('nineveh'),('erbil'),('sulaymaniyah'),('duhok'),
 ('kirkuk'),('najaf'),('karbala'),('babil'),('anbar'),('diyala'),
 ('saladin'),('wasit'),('dhiqar'),('maysan'),('muthanna'),('qadisiyah'),('all')
on conflict(governorate_key) do nothing;

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
