-- Restrict privileged peak-pricing RPCs to authenticated callers.
-- These functions are security-definer and must not inherit PostgreSQL's default PUBLIC execute grant.
revoke all on function public.admin_save_taxi_peak_weather_settings(text,text,boolean,numeric,numeric,numeric,integer,integer,integer,integer,integer) from public, anon;
grant execute on function public.admin_save_taxi_peak_weather_settings(text,text,boolean,numeric,numeric,numeric,integer,integer,integer,integer,integer) to authenticated;

revoke all on function public.admin_save_service_peak_policy(text,text,text,boolean,numeric,boolean,numeric,numeric,numeric,integer) from public, anon;
grant execute on function public.admin_save_service_peak_policy(text,text,text,boolean,numeric,boolean,numeric,numeric,numeric,integer) to authenticated;

revoke all on function public.set_my_service_peak_percent(text,text,numeric) from public, anon;
grant execute on function public.set_my_service_peak_percent(text,text,numeric) to authenticated;
