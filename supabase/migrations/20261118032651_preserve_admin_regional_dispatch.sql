-- Preserve dispatch records for admin-owned requests/providers when regional controls change.
create or replace function public.cleanup_disabled_regional_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.request_offers o
     set status = 'cancelled', responded_at = now()
    from public.service_requests sr
   where sr.id = o.request_id
     and o.status = 'pending'
     and not public.is_platform_admin(sr.customer_id)
     and not public.is_platform_admin(sr.provider_id)
     and not public.regional_services_enabled(coalesce(sr.governorate_key, public.infer_governorate_key(sr.pickup_lat, sr.pickup_lng)));

  delete from public.service_dispatch_queue q
   using public.service_requests sr
   where sr.id = q.request_id
     and not public.is_platform_admin(sr.customer_id)
     and not public.is_platform_admin(sr.provider_id)
     and not public.regional_services_enabled(coalesce(sr.governorate_key, public.infer_governorate_key(sr.pickup_lat, sr.pickup_lng)));

  delete from public.taxi_dispatch_queue q
   using public.service_requests sr
   where sr.id = q.request_id
     and not public.is_platform_admin(sr.customer_id)
     and not public.is_platform_admin(sr.provider_id)
     and not public.regional_services_enabled(coalesce(sr.governorate_key, public.infer_governorate_key(sr.pickup_lat, sr.pickup_lng)));

  return null;
end;
$$;

revoke all on function public.cleanup_disabled_regional_dispatch() from public, anon, authenticated;