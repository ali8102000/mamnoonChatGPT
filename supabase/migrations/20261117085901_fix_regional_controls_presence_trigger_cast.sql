-- Fix regional controls writes failing when provider GPS coordinates are double precision.
-- infer_governorate_key is defined for numeric,numeric, so cast provider_presence GPS values.
-- The cleanup trigger runs after every regional_service_controls INSERT/UPDATE/DELETE.
create or replace function public.cleanup_disabled_provider_presence()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.worker_profiles wp
     set available = false
    from public.profiles p
   where p.id = wp.user_id
     and wp.available = true
     and not public.regional_services_enabled(p.governorate_key);

  update public.driver_profiles dp
     set available = false
    from public.profiles p
   where p.id = dp.user_id
     and dp.available = true
     and not public.regional_services_enabled(p.governorate_key);

  update public.worker_profiles wp
     set available = false
   where wp.available = true
     and wp.user_id in (
       select pp.user_id
         from public.provider_presence pp
         left join public.profiles p on p.id = pp.user_id
        where not public.regional_services_enabled(
          coalesce(
            nullif(lower(trim(p.governorate_key)), ''),
            public.infer_governorate_key(pp.lat::numeric, pp.lng::numeric)
          )
        )
     );

  update public.driver_profiles dp
     set available = false
   where dp.available = true
     and dp.user_id in (
       select pp.user_id
         from public.provider_presence pp
         left join public.profiles p on p.id = pp.user_id
        where not public.regional_services_enabled(
          coalesce(
            nullif(lower(trim(p.governorate_key)), ''),
            public.infer_governorate_key(pp.lat::numeric, pp.lng::numeric)
          )
        )
     );

  delete from public.provider_presence pp
   using public.profiles p
   where p.id = pp.user_id
     and not public.regional_services_enabled(
       coalesce(
         nullif(lower(trim(p.governorate_key)), ''),
         public.infer_governorate_key(pp.lat::numeric, pp.lng::numeric)
       )
     );

  return null;
end;
$function$;
