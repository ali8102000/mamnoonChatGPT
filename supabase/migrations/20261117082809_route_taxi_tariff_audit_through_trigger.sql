create or replace function public.admin_update_taxi_pricing_settings_scoped(
 p_service_type text,p_is_intercity boolean,p_base_fare numeric,p_per_km_rate numeric,p_per_min_rate numeric,p_min_fare numeric,p_governorate_key text default 'all')
returns public.pricing_settings language plpgsql security invoker set search_path=public,pg_temp
as $function$
declare v_actor uuid:=auth.uid(); v_before public.pricing_settings%rowtype; v_after public.pricing_settings%rowtype;
 v_scope_type text; v_scope_governorate text; v_global public.pricing_settings%rowtype;
begin
 if v_actor is null then raise exception 'unauthorized'; end if;
 if p_service_type not in ('economy','premium','luxury') then raise exception 'invalid_taxi_category'; end if;
 if p_governorate_key not in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah') then raise exception 'invalid_governorate'; end if;
 if p_base_fare is null or p_base_fare<0 or p_per_km_rate is null or p_per_km_rate<0 or p_per_min_rate is null or p_per_min_rate<0 or p_min_fare is null or p_min_fare<1000 then raise exception 'invalid_taxi_tariff'; end if;
 v_scope_type:=case when p_governorate_key='all' then 'global' else 'governorate' end;
 v_scope_governorate:=case when p_governorate_key='all' then null else p_governorate_key end;
 if not public.admin_has_permission('pricing.taxi.edit',v_scope_type,v_scope_governorate) then raise exception 'missing_pricing_permission'; end if;
 select * into v_before from public.pricing_settings where service_type=p_service_type and is_intercity=p_is_intercity and governorate_key=p_governorate_key for update;
 if not found and p_governorate_key<>'all' then
  select * into v_global from public.pricing_settings where service_type=p_service_type and is_intercity=p_is_intercity and governorate_key='all';
  if not found then raise exception 'global_taxi_pricing_row_not_found'; end if;
  insert into public.pricing_settings(service_type,is_intercity,base_fare,per_km_rate,per_min_rate,min_fare,governorate_key,updated_at)
  values(p_service_type,p_is_intercity,v_global.base_fare,v_global.per_km_rate,v_global.per_min_rate,v_global.min_fare,p_governorate_key,now())
  on conflict(service_type,is_intercity,governorate_key) do nothing;
  select * into v_before from public.pricing_settings where service_type=p_service_type and is_intercity=p_is_intercity and governorate_key=p_governorate_key for update;
 end if;
 if not found then raise exception 'taxi_pricing_row_not_found'; end if;
 if p_service_type<>'economy' and (p_base_fare is distinct from v_before.base_fare or p_per_km_rate is distinct from v_before.per_km_rate or p_per_min_rate is distinct from v_before.per_min_rate) then raise exception 'economy_row_defines_base_tariff_for_all_categories'; end if;
 update public.pricing_settings set base_fare=case when p_service_type='economy' then p_base_fare else base_fare end,
  per_km_rate=case when p_service_type='economy' then p_per_km_rate else per_km_rate end,
  per_min_rate=case when p_service_type='economy' then p_per_min_rate else per_min_rate end,min_fare=p_min_fare,updated_at=now()
  where service_type=p_service_type and is_intercity=p_is_intercity and governorate_key=p_governorate_key returning * into v_after;
 return v_after;
end;
$function$;