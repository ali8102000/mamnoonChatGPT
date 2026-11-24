-- Generalize peak pricing policy to every service category, with optional provider-selected rate.
create table if not exists public.service_peak_pricing_policies (
  governorate_key text not null,
  service_slug text not null references public.services(slug) on update cascade on delete cascade,
  mode text not null default 'off' check (mode in ('auto','notify','off')),
  enabled boolean not null default false,
  admin_fixed_percent numeric not null default 0 check (admin_fixed_percent between 0 and 100),
  provider_can_choose boolean not null default false,
  provider_max_percent numeric not null default 0 check (provider_max_percent between 0 and 100),
  rain_threshold_mm numeric not null default 1 check (rain_threshold_mm between 0 and 100),
  heat_threshold_c numeric not null default 42 check (heat_threshold_c between 0 and 60),
  max_weather_age_minutes integer not null default 15 check (max_weather_age_minutes between 5 and 120),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(governorate_key,service_slug),
  constraint service_peak_governorate_valid check (governorate_key in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')),
  constraint service_peak_disabled_has_no_rate check (enabled or (admin_fixed_percent=0 and provider_max_percent=0))
);

create table if not exists public.provider_service_peak_choices (
  provider_id uuid not null references auth.users(id) on delete cascade,
  governorate_key text not null,
  service_slug text not null references public.services(slug) on update cascade on delete cascade,
  chosen_percent numeric not null default 0 check (chosen_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key(provider_id,governorate_key,service_slug)
);

alter table public.service_peak_pricing_policies enable row level security;
alter table public.provider_service_peak_choices enable row level security;

drop policy if exists "admins read service peak policies" on public.service_peak_pricing_policies;
create policy "admins read service peak policies" on public.service_peak_pricing_policies
for select to authenticated using (
 public.admin_has_permission('pricing.peak.edit',
   case when governorate_key='all' then 'global' else 'governorate' end,
   case when governorate_key='all' then null else governorate_key end)
);
drop policy if exists "providers read own peak choices" on public.provider_service_peak_choices;
create policy "providers read own peak choices" on public.provider_service_peak_choices
for select to authenticated using (provider_id=auth.uid());

create or replace function public.admin_save_service_peak_policy(
 p_governorate_key text,p_service_slug text,p_mode text,p_enabled boolean,
 p_admin_fixed_percent numeric,p_provider_can_choose boolean,p_provider_max_percent numeric,
 p_rain_threshold_mm numeric,p_heat_threshold_c numeric,p_max_weather_age_minutes integer
) returns public.service_peak_pricing_policies
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_row public.service_peak_pricing_policies%rowtype; v_actor uuid:=auth.uid();
begin
 if v_actor is null then raise exception 'unauthorized'; end if;
 if p_governorate_key not in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah') then raise exception 'invalid_governorate'; end if;
 if p_mode not in ('auto','notify','off') then raise exception 'invalid_mode'; end if;
 if not exists(select 1 from public.services where slug=p_service_slug) then raise exception 'invalid_service'; end if;
 if p_admin_fixed_percent not between 0 and 100 or p_provider_max_percent not between 0 and 100
  or p_rain_threshold_mm not between 0 and 100 or p_heat_threshold_c not between 0 and 60
  or p_max_weather_age_minutes not between 5 and 120 then raise exception 'invalid_policy_values'; end if;
 if not p_enabled and (p_admin_fixed_percent<>0 or p_provider_max_percent<>0) then raise exception 'disabled_policy_must_have_zero_rates'; end if;
 if not p_provider_can_choose and p_provider_max_percent<>0 then raise exception 'provider_choice_disabled'; end if;
 if p_mode='off' and p_enabled then raise exception 'off_mode_cannot_be_enabled'; end if;
 if not public.admin_has_permission('pricing.peak.edit',
   case when p_governorate_key='all' then 'global' else 'governorate' end,
   case when p_governorate_key='all' then null else p_governorate_key end) then raise exception 'missing_pricing_permission'; end if;

 insert into public.service_peak_pricing_policies(governorate_key,service_slug,mode,enabled,admin_fixed_percent,provider_can_choose,provider_max_percent,rain_threshold_mm,heat_threshold_c,max_weather_age_minutes,updated_by,updated_at)
 values(p_governorate_key,p_service_slug,p_mode,p_enabled,p_admin_fixed_percent,p_provider_can_choose,p_provider_max_percent,p_rain_threshold_mm,p_heat_threshold_c,p_max_weather_age_minutes,v_actor,now())
 on conflict(governorate_key,service_slug) do update set
 mode=excluded.mode,enabled=excluded.enabled,admin_fixed_percent=excluded.admin_fixed_percent,
 provider_can_choose=excluded.provider_can_choose,provider_max_percent=excluded.provider_max_percent,
 rain_threshold_mm=excluded.rain_threshold_mm,heat_threshold_c=excluded.heat_threshold_c,
 max_weather_age_minutes=excluded.max_weather_age_minutes,updated_by=v_actor,updated_at=now()
 returning * into v_row;

 insert into public.audit_logs(user_id,action,target_type,target_id,details)
 values(v_actor,'pricing.peak.service_policy.updated','service_peak_pricing_policies',p_governorate_key||':'||p_service_slug,to_jsonb(v_row));
 return v_row;
end $$;

create or replace function public.set_my_service_peak_percent(
 p_governorate_key text,p_service_slug text,p_percent numeric
) returns public.provider_service_peak_choices
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_actor uuid:=auth.uid(); v_policy public.service_peak_pricing_policies%rowtype; v_row public.provider_service_peak_choices%rowtype;
begin
 if v_actor is null then raise exception 'unauthorized'; end if;
 if p_percent is null or p_percent<0 or p_percent>100 then raise exception 'invalid_percent'; end if;
 select * into v_policy from public.service_peak_pricing_policies
 where governorate_key=p_governorate_key and service_slug=p_service_slug and enabled=true and mode<>'off'
 for share;
 if not found or not v_policy.provider_can_choose then raise exception 'provider_peak_choice_not_allowed'; end if;
 if p_percent>v_policy.provider_max_percent then raise exception 'provider_peak_percent_exceeds_admin_cap'; end if;
 insert into public.provider_service_peak_choices(provider_id,governorate_key,service_slug,chosen_percent,updated_at)
 values(v_actor,p_governorate_key,p_service_slug,p_percent,now())
 on conflict(provider_id,governorate_key,service_slug) do update set chosen_percent=excluded.chosen_percent,updated_at=now()
 returning * into v_row;
 return v_row;
end $$;

grant select on public.service_peak_pricing_policies,public.provider_service_peak_choices to authenticated;
grant execute on function public.admin_save_service_peak_policy(text,text,text,boolean,numeric,boolean,numeric,numeric,numeric,integer) to authenticated;
grant execute on function public.set_my_service_peak_percent(text,text,numeric) to authenticated;
