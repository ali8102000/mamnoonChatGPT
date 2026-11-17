alter table public.pricing_settings add column if not exists governorate_key text not null default 'all';
alter table public.pricing_settings drop constraint if exists pricing_settings_service_type_is_intercity_key;
alter table public.pricing_settings drop constraint if exists pricing_settings_governorate_key_check;
alter table public.pricing_settings add constraint pricing_settings_governorate_key_check
  check (governorate_key in ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah'));
alter table public.pricing_settings add constraint pricing_settings_service_intercity_governorate_key unique(service_type,is_intercity,governorate_key);
create index if not exists pricing_settings_governorate_lookup_idx on public.pricing_settings(governorate_key,is_intercity,service_type);

create or replace function public.admin_has_permission(p_permission_key text,p_scope_type text default 'global',p_scope_governorate text default null)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_actor uuid:=auth.uid(); v_staff_scope_type text; v_staff_scope_governorate text;
begin
 if v_actor is null then return false; end if;
 if public.is_super_admin(v_actor) then return true; end if;
 if p_scope_type not in ('global','governorate') or (p_scope_type='global' and p_scope_governorate is not null)
   or (p_scope_type='governorate' and nullif(trim(p_scope_governorate),'') is null) then return false; end if;
 select scope_type,scope_governorate into v_staff_scope_type,v_staff_scope_governorate from public.staff_assignments where user_id=v_actor and active=true;
 if v_staff_scope_type is null then return false; end if;
 if v_staff_scope_type='governorate' and (p_scope_type<>'governorate' or p_scope_governorate is distinct from v_staff_scope_governorate)
   and p_permission_key not in ('pricing.taxi.edit','pricing.peak.edit') then return false; end if;
 return exists(select 1 from public.admin_staff_permission_grants g where g.user_id=v_actor and g.permission_key=p_permission_key
   and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())
   and (g.scope_type='global' or (p_scope_type='governorate' and g.scope_type='governorate' and g.scope_governorate=p_scope_governorate)))
 or exists(select 1 from public.admin_staff_delegations d join public.admin_staff_permission_grants g
   on g.user_id=d.delegator_id and g.permission_key=d.permission_key
   where d.delegate_id=v_actor and d.permission_key=p_permission_key and d.revoked_at is null
   and (d.expires_at is null or d.expires_at>now()) and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())
   and (d.scope_type='global' or (p_scope_type='governorate' and d.scope_type='governorate' and d.scope_governorate=p_scope_governorate))
   and (public.is_super_admin(d.delegator_id) or exists(select 1 from public.admin_staff_permission_grants sg
     where sg.user_id=d.delegator_id and sg.permission_key=d.permission_key and sg.revoked_at is null
     and (sg.expires_at is null or sg.expires_at>now())
     and (sg.scope_type='global' or (d.scope_type='governorate' and sg.scope_type='governorate' and sg.scope_governorate=d.scope_governorate))));
end;
$function$;

create or replace function public.admin_has_any_pricing_permission()
returns boolean language plpgsql stable security invoker set search_path=public,pg_temp
as $function$
declare v_permission text; v_governorate text; v_governorates text[]:=array['baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah'];
begin
 if auth.uid() is null then return false; end if;
 if public.is_super_admin(auth.uid()) then return true; end if;
 foreach v_permission in array array['pricing.taxi.edit','pricing.peak.edit'] loop
   if public.admin_has_permission(v_permission,'global',null) then return true; end if;
   foreach v_governorate in array v_governorates loop
     if public.admin_has_permission(v_permission,'governorate',v_governorate) then return true; end if;
   end loop;
 end loop;
 return false;
end;
$function$;
revoke all on function public.admin_has_any_pricing_permission() from public,anon;
grant execute on function public.admin_has_any_pricing_permission() to authenticated;

create or replace function public.admin_update_taxi_pricing_settings_scoped(
 p_service_type text,p_is_intercity boolean,p_base_fare numeric,p_per_km_rate numeric,p_per_min_rate numeric,p_min_fare numeric,p_governorate_key text default 'all')
returns public.pricing_settings language plpgsql security definer set search_path=public,pg_temp
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
 if p_service_type<>'economy' and (p_base_fare is distinct from v_before.base_fare or p_per_km_rate is distinct from v_before.per_km_rate or p_per_min_rate is distinct from v_before.per_min_rate) then
   raise exception 'economy_row_defines_base_tariff_for_all_categories'; end if;
 update public.pricing_settings set base_fare=case when p_service_type='economy' then p_base_fare else base_fare end,
   per_km_rate=case when p_service_type='economy' then p_per_km_rate else per_km_rate end,
   per_min_rate=case when p_service_type='economy' then p_per_min_rate else per_min_rate end,min_fare=p_min_fare,updated_at=now()
   where service_type=p_service_type and is_intercity=p_is_intercity and governorate_key=p_governorate_key returning * into v_after;
 insert into public.audit_logs(user_id,action,target_type,target_id,details)
 values(v_actor,'pricing.taxi.tariff.updated','pricing_settings',v_after.id::text,
  jsonb_build_object('service_type',p_service_type,'is_intercity',p_is_intercity,'governorate_key',p_governorate_key,'before',to_jsonb(v_before),'after',to_jsonb(v_after)));
 return v_after;
end;
$function$;
revoke all on function public.admin_update_taxi_pricing_settings_scoped(text,boolean,numeric,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.admin_update_taxi_pricing_settings_scoped(text,boolean,numeric,numeric,numeric,numeric,text) to authenticated;

create or replace function public.admin_update_taxi_pricing_settings(p_service_type text,p_is_intercity boolean,p_base_fare numeric,p_per_km_rate numeric,p_per_min_rate numeric,p_min_fare numeric)
returns public.pricing_settings language sql security invoker set search_path=public,pg_temp
as $function$ select public.admin_update_taxi_pricing_settings_scoped(p_service_type,p_is_intercity,p_base_fare,p_per_km_rate,p_per_min_rate,p_min_fare,'all'); $function$;
revoke all on function public.admin_update_taxi_pricing_settings(text,boolean,numeric,numeric,numeric,numeric) from public,anon;
grant execute on function public.admin_update_taxi_pricing_settings(text,boolean,numeric,numeric,numeric,numeric) to authenticated;

create or replace function public.prepare_taxi_request()
returns trigger language plpgsql security definer set search_path=public
as $function$
declare v_rate numeric; v_base_fare numeric; v_per_min_rate numeric; v_min_fare numeric; v_base numeric; v_raw numeric;
 v_tier_percent numeric:=0; v_peak_enabled boolean:=false; v_peak_percent numeric:=0; v_urgency_enabled boolean:=false;
 v_urgency_cap numeric:=0; v_tier_multiplier numeric:=1; v_trip_multiplier numeric:=1; v_extra_time_fare numeric:=0; v_governorate text;
begin
 if NEW.type<>'taxi' then return NEW; end if;
 NEW.trip_type:=coalesce(NEW.trip_type,'one_way'); NEW.extra_minutes:=coalesce(NEW.extra_minutes,0);
 if NEW.trip_type not in ('one_way','round_trip','second_trip','stop') then raise exception 'نوع الرحلة غير صالح'; end if;
 if NEW.extra_minutes<0 or NEW.extra_minutes>120 or NEW.extra_minutes%5<>0 then raise exception 'وقت الانتظار يجب أن يكون من 0 إلى 120 دقيقة وبفواصل 5 دقائق'; end if;
 if NEW.vehicle_category::text='large' then
   NEW.vehicle_type:=coalesce(NEW.vehicle_type,case when coalesce(NEW.notes,'') ilike '%كيا ركاب%' then 'kia_passenger' else 'kia_cargo' end);
   if NEW.pickup_lat is null or NEW.pickup_lng is null then raise exception 'نقطة الانطلاق مطلوبة'; end if;
   NEW.distance_km:=null; NEW.duration_min:=null; NEW.price_estimate:=null; NEW.commission:=0; NEW.status:='searching';
   NEW.searching_started_at:=now(); NEW.pricing_mode:=case when NEW.customer_price is not null then 'fixed' else 'negotiable' end;
   NEW.taxi_urgency_enabled:=false; NEW.taxi_urgency_percent:=0; NEW.taxi_peak_percent:=0; return NEW;
 end if;
 if auth.role() is distinct from 'service_role' then raise exception 'أنشئ طلب التاكسي من خدمة التسعير الآمنة'; end if;
 NEW.vehicle_type:=null;
 if NEW.distance_km is null or NEW.distance_km<=0 or NEW.duration_min is null or NEW.duration_min<0 or NEW.pickup_lat is null or NEW.pickup_lng is null or NEW.dest_lat is null or NEW.dest_lng is null then raise exception 'بيانات الطريق غير مكتملة'; end if;
 v_governorate:=coalesce(NEW.governorate_key,'all');
 select base_fare,per_km_rate,per_min_rate into v_base_fare,v_rate,v_per_min_rate from public.pricing_settings
  where service_type='economy' and is_intercity=coalesce(NEW.is_intercity,false) and governorate_key in (v_governorate,'all')
  order by case when governorate_key=v_governorate then 0 else 1 end limit 1;
 if not found then raise exception 'تعريفة الاقتصاد غير متوفرة'; end if;
 v_base:=greatest(1000::numeric,v_base_fare+(NEW.distance_km*v_rate)+(NEW.duration_min*v_per_min_rate));
 if NEW.vehicle_category::text='premium' then v_tier_percent:=case when v_base<10000 then 20 when v_base<=50000 then 15 else 5 end;
 elsif NEW.vehicle_category::text='luxury' then v_tier_percent:=case when v_base<10000 then 40 when v_base<=50000 then 25 else 10 end; end if;
 select peak_enabled,peak_percent into v_peak_enabled,v_peak_percent from public.taxi_pricing_controls where governorate_key=v_governorate;
 if not found then select peak_enabled,peak_percent into v_peak_enabled,v_peak_percent from public.taxi_pricing_controls where governorate_key='all'; end if;
 select urgency_enabled,urgency_max_percent into v_urgency_enabled,v_urgency_cap from public.taxi_pricing_controls where governorate_key='all';
 if NEW.trip_type in ('round_trip','second_trip') then v_trip_multiplier:=case when NEW.trip_type='round_trip' then 1.8 else 2 end; end if;
 v_extra_time_fare:=ceil(NEW.extra_minutes::numeric/5)*500; v_tier_multiplier:=1+(v_tier_percent/100.0);
 v_raw:=v_base*v_tier_multiplier*v_trip_multiplier+v_extra_time_fare;
 if NEW.trip_type='round_trip' then v_raw:=v_base*v_tier_multiplier*2*0.9+v_extra_time_fare; end if;
 if coalesce(v_peak_enabled,false) then v_raw:=v_raw*(1+greatest(0,least(200,coalesce(v_peak_percent,0)))/100.0); NEW.taxi_peak_percent:=greatest(0,least(200,coalesce(v_peak_percent,0)));
 else NEW.taxi_peak_percent:=0; end if;
 if coalesce(NEW.taxi_urgency_enabled,false) and coalesce(v_urgency_enabled,false) then
   NEW.taxi_urgency_percent:=greatest(0,least(coalesce(v_urgency_cap,0),100)); v_raw:=v_raw*(1+NEW.taxi_urgency_percent/100.0); NEW.taxi_urgency_enabled:=NEW.taxi_urgency_percent>0;
 else NEW.taxi_urgency_enabled:=false; NEW.taxi_urgency_percent:=0; end if;
 select min_fare into v_min_fare from public.pricing_settings where service_type=NEW.vehicle_category::text
  and is_intercity=coalesce(NEW.is_intercity,false) and governorate_key in (v_governorate,'all')
  order by case when governorate_key=v_governorate then 0 else 1 end limit 1;
 NEW.price_estimate:=greatest(1000::numeric,coalesce(v_min_fare,0),round(v_raw/250)*250);
 NEW.commission:=0; NEW.status:='searching'; NEW.searching_started_at:=now(); return NEW;
end;
$function$;