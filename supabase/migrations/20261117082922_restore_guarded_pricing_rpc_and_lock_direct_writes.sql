revoke all on public.pricing_settings from authenticated;
grant select on public.pricing_settings to authenticated;
revoke insert (service_type,is_intercity,base_fare,per_km_rate,per_min_rate,min_fare,governorate_key,updated_at)
  on public.pricing_settings from authenticated;
revoke update (base_fare,per_km_rate,per_min_rate,min_fare,updated_at)
  on public.pricing_settings from authenticated;
drop policy if exists pricing_settings_admin_insert_scoped on public.pricing_settings;
drop policy if exists pricing_settings_admin_update_scoped on public.pricing_settings;
alter function public.admin_update_taxi_pricing_settings_scoped(text,boolean,numeric,numeric,numeric,numeric,text) security definer;