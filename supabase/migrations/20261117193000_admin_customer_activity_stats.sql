create or replace function public.admin_customer_activity_stats(
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with role_counts as (
  select role::text as role, count(*)::bigint as accounts
  from public.user_roles group by role
),
request_status_counts as (
  select status::text as status, count(*)::bigint as requests
  from public.service_requests group by status
),
request_by_customer as (
  select customer_id,
    count(*)::bigint as total_requests,
    count(*) filter (where lower(status) in ('pending','searching','accepted','in_progress'))::bigint as active_requests,
    count(*) filter (where lower(status) = 'completed')::bigint as completed_requests,
    count(*) filter (where lower(status) = 'cancelled')::bigint as cancelled_requests,
    count(*) filter (where type = 'taxi')::bigint as taxi_requests,
    count(*) filter (where type = 'service')::bigint as service_requests,
    coalesce(jsonb_object_agg(status,status_count),'{}'::jsonb) as statuses
  from (
    select customer_id,status::text as status,type::text as type,
      count(*) over (partition by customer_id,status) as status_count
    from public.service_requests where customer_id is not null
  ) r
  group by customer_id
),
customers as (
  select p.id, coalesce(nullif(p.full_name,''),'بدون اسم') as full_name,
    p.phone,p.email,p.created_at,
    coalesce(nullif(p.governorate_key,''),ar.governorate_key,'unknown') as governorate_key,
    coalesce(ur.roles,array[]::text[]) as roles,coalesce(cardinality(ur.roles),0) as roles_count,
    coalesce(rc.total_requests,0) as total_requests,
    coalesce(rc.active_requests,0) as active_requests,
    coalesce(rc.completed_requests,0) as completed_requests,
    coalesce(rc.cancelled_requests,0) as cancelled_requests,
    coalesce(rc.taxi_requests,0) as taxi_requests,
    coalesce(rc.service_requests,0) as service_requests,
    coalesce(rc.statuses,'{}'::jsonb) as statuses
  from public.profiles p
  join public.user_roles cr on cr.user_id=p.id and cr.role::text='customer'
  left join lateral (
    select array_agg(distinct role::text order by role::text) as roles
    from public.user_roles where user_id=p.id
  ) ur on true
  left join request_by_customer rc on rc.customer_id=p.id
  left join lateral (
    select governorate_key from public.service_requests sr
    where sr.customer_id=p.id and sr.governorate_key is not null
    order by sr.created_at desc limit 1
  ) ar on true
),
customer_page as (
  select * from customers order by created_at desc,id
  limit greatest(1,least(coalesce(p_limit,200),500))
  offset greatest(coalesce(p_offset,0),0)
),
customer_summary as (
  select count(*)::bigint as total_customers,
    coalesce(sum(total_requests),0)::bigint as customer_requests,
    coalesce(sum(active_requests),0)::bigint as customer_active_requests,
    coalesce(sum(completed_requests),0)::bigint as customer_completed_requests,
    coalesce(sum(cancelled_requests),0)::bigint as customer_cancelled_requests
  from customers
)
select jsonb_build_object(
  'summary',jsonb_build_object(
    'total_users',(select count(*) from public.profiles),
    'total_role_assignments',(select count(*) from public.user_roles),
    'total_customers',cs.total_customers,
    'customer_requests',cs.customer_requests,
    'customer_active_requests',cs.customer_active_requests,
    'customer_completed_requests',cs.customer_completed_requests,
    'customer_cancelled_requests',cs.customer_cancelled_requests,
    'all_requests',(select coalesce(sum(requests),0) from request_status_counts)
  ),
  'role_counts',coalesce((select jsonb_agg(jsonb_build_object('role',role,'accounts',accounts) order by role) from role_counts),'[]'::jsonb),
  'request_status_counts',coalesce((select jsonb_agg(jsonb_build_object('status',status,'requests',requests) order by status) from request_status_counts),'[]'::jsonb),
  'customers',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'full_name',full_name,'phone',phone,'email',email,'created_at',created_at,
    'governorate_key',governorate_key,'roles',roles,'roles_count',roles_count,
    'total_requests',total_requests,'active_requests',active_requests,
    'completed_requests',completed_requests,'cancelled_requests',cancelled_requests,
    'taxi_requests',taxi_requests,'service_requests',service_requests,'statuses',statuses
  ) order by created_at desc,id) from customer_page),'[]'::jsonb),
  'page',jsonb_build_object(
    'limit',greatest(1,least(coalesce(p_limit,200),500)),
    'offset',greatest(coalesce(p_offset,0),0),
    'returned',(select count(*) from customer_page),
    'has_more',(select count(*) from customers)>greatest(coalesce(p_offset,0),0)+greatest(1,least(coalesce(p_limit,200),500))
  )
)
from customer_summary cs;
$$;
revoke all on function public.admin_customer_activity_stats(integer,integer) from public,anon,authenticated;
grant execute on function public.admin_customer_activity_stats(integer,integer) to service_role;
