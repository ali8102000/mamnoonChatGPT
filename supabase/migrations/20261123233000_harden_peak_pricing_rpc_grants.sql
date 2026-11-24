-- Restrict privileged peak-pricing RPCs to authenticated callers.
-- A provider-selected service peak rate is only writable by an approved worker
-- who is actually assigned to the selected service. Authentication alone is not enough.
create or replace function public.set_my_service_peak_percent(
  p_governorate_key text,
  p_service_slug text,
  p_percent numeric
) returns public.provider_service_peak_choices
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_policy public.service_peak_pricing_policies%rowtype;
  v_row public.provider_service_peak_choices%rowtype;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if not public.has_role(v_actor, 'worker'::public.app_role) then
    raise exception 'approved_worker_required';
  end if;
  if p_governorate_key not in (
    'all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
    'najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar',
    'maysan','muthanna','qadisiyah'
  ) then
    raise exception 'invalid_governorate';
  end if;
  if p_service_slug is null or not exists (
    select 1 from public.services where slug = p_service_slug
  ) then
    raise exception 'invalid_service';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'invalid_percent';
  end if;
  if not exists (
    select 1
    from public.worker_profiles wp
    join public.worker_services ws on ws.worker_id = wp.user_id
    join public.services svc on svc.id = ws.service_id
    where wp.user_id = v_actor
      and wp.status = 'approved'
      and (wp.suspended_until is null or wp.suspended_until <= now())
      and svc.slug = p_service_slug
  ) then
    raise exception 'approved_worker_service_required';
  end if;

  select * into v_policy
  from public.service_peak_pricing_policies
  where governorate_key = p_governorate_key
    and service_slug = p_service_slug
    and enabled = true
    and mode <> 'off'
  for share;
  if not found or not v_policy.provider_can_choose then
    raise exception 'provider_peak_choice_not_allowed';
  end if;
  if p_percent > v_policy.provider_max_percent then
    raise exception 'provider_peak_percent_exceeds_admin_cap';
  end if;

  insert into public.provider_service_peak_choices(
    provider_id, governorate_key, service_slug, chosen_percent, updated_at
  ) values (
    v_actor, p_governorate_key, p_service_slug, p_percent, now()
  )
  on conflict (provider_id, governorate_key, service_slug)
  do update set chosen_percent = excluded.chosen_percent, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

-- These functions are security-definer and must not inherit PostgreSQL's default PUBLIC execute grant.
revoke all on function public.admin_save_taxi_peak_weather_settings(text,text,boolean,numeric,numeric,numeric,integer,integer,integer,integer,integer) from public, anon;
grant execute on function public.admin_save_taxi_peak_weather_settings(text,text,boolean,numeric,numeric,numeric,integer,integer,integer,integer,integer) to authenticated;

revoke all on function public.admin_save_service_peak_policy(text,text,text,boolean,numeric,boolean,numeric,numeric,numeric,integer) from public, anon;
grant execute on function public.admin_save_service_peak_policy(text,text,text,boolean,numeric,boolean,numeric,numeric,numeric,integer) to authenticated;

revoke all on function public.set_my_service_peak_percent(text,text,numeric) from public, anon;
grant execute on function public.set_my_service_peak_percent(text,text,numeric) to authenticated;
