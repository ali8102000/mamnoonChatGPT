-- Fix three-valued SQL logic that excluded approved taxi drivers when optional
-- vehicle_type is NULL. Keep the existing invoker security and service_role grant.
create or replace function public.admin_governorate_user_stats()
returns table (
  governorate_key text,
  workers bigint,
  large_drivers bigint,
  taxi_drivers bigint,
  customers bigint,
  total_users bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with role_sets as (
    select user_id, array_agg(role::text) as roles
    from public.user_roles
    group by user_id
  ),
  activity_regions as (
    select distinct on (user_id) user_id, governorate_key
    from (
      select customer_id as user_id, governorate_key, created_at
      from public.service_requests where customer_id is not null and governorate_key is not null
      union all
      select provider_id as user_id, governorate_key, created_at
      from public.service_requests where provider_id is not null and governorate_key is not null
    ) activity
    order by user_id, created_at desc
  ),
  classified as (
    select
      p.id,
      coalesce(nullif(p.governorate_key, ''), ar.governorate_key, 'unknown') as region,
      coalesce('worker' = any(r.roles), false) or wp.user_id is not null as is_worker,
      (
        coalesce('large_driver' = any(r.roles), false)
        or coalesce(dp.vehicle_category::text = 'large', false)
        or coalesce(dp.vehicle_type in ('kia_cargo', 'kia_passenger'), false)
      ) as is_large_driver,
      coalesce('driver' = any(r.roles), false) and not (
        coalesce('large_driver' = any(r.roles), false)
        or coalesce(dp.vehicle_category::text = 'large', false)
        or coalesce(dp.vehicle_type in ('kia_cargo', 'kia_passenger'), false)
      ) as is_taxi_driver,
      coalesce('customer' = any(r.roles), false)
        or not (
          coalesce('worker' = any(r.roles), false) or wp.user_id is not null
          or coalesce('driver' = any(r.roles), false)
          or coalesce('large_driver' = any(r.roles), false)
          or dp.user_id is not null
        ) as is_customer
    from public.profiles p
    left join role_sets r on r.user_id = p.id
    left join activity_regions ar on ar.user_id = p.id
    left join public.driver_profiles dp on dp.user_id = p.id
    left join public.worker_profiles wp on wp.user_id = p.id
  )
  select
    case when grouping(region) = 1 then '__all__' else region end,
    count(*) filter (where is_worker),
    count(*) filter (where is_large_driver),
    count(*) filter (where is_taxi_driver),
    count(*) filter (where is_customer),
    count(*)
  from classified
  group by grouping sets ((region), ())
  order by grouping(region) desc, region;
$$;

revoke all on function public.admin_governorate_user_stats() from public, anon, authenticated;
grant execute on function public.admin_governorate_user_stats() to service_role;
