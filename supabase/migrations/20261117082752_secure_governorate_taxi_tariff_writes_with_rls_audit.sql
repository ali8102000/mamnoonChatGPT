alter function public.admin_update_taxi_pricing_settings_scoped(text,boolean,numeric,numeric,numeric,numeric,text) security invoker;
grant insert (service_type,is_intercity,base_fare,per_km_rate,per_min_rate,min_fare,governorate_key,updated_at) on public.pricing_settings to authenticated;
grant update (base_fare,per_km_rate,per_min_rate,min_fare,updated_at) on public.pricing_settings to authenticated;
drop policy if exists pricing_settings_admin_insert_scoped on public.pricing_settings;
create policy pricing_settings_admin_insert_scoped on public.pricing_settings for insert to authenticated
with check (public.admin_has_permission('pricing.taxi.edit',case when governorate_key='all' then 'global' else 'governorate' end,case when governorate_key='all' then null else governorate_key end));
drop policy if exists pricing_settings_admin_update_scoped on public.pricing_settings;
create policy pricing_settings_admin_update_scoped on public.pricing_settings for update to authenticated
using (public.admin_has_permission('pricing.taxi.edit',case when governorate_key='all' then 'global' else 'governorate' end,case when governorate_key='all' then null else governorate_key end))
with check (public.admin_has_permission('pricing.taxi.edit',case when governorate_key='all' then 'global' else 'governorate' end,case when governorate_key='all' then null else governorate_key end));
create or replace function public.audit_pricing_settings_change() returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
begin
 if auth.uid() is null then raise exception 'unauthorized_pricing_audit_context'; end if;
 insert into public.audit_logs(user_id,action,target_type,target_id,details)
 values(auth.uid(),'pricing.taxi.tariff.updated','pricing_settings',new.id::text,
  jsonb_build_object('operation',tg_op,'governorate_key',new.governorate_key,'service_type',new.service_type,
   'is_intercity',new.is_intercity,'before',case when tg_op='UPDATE' then to_jsonb(old) else null end,'after',to_jsonb(new)));
 return new;
end;
$function$;
revoke all on function public.audit_pricing_settings_change() from public,anon,authenticated;
drop trigger if exists audit_pricing_settings_change on public.pricing_settings;
create trigger audit_pricing_settings_change after insert or update on public.pricing_settings for each row execute function public.audit_pricing_settings_change();