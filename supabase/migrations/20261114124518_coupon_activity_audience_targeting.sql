create or replace function public.admin_coupon_audience_count(p_target text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.assert_staff('admin');
  if p_target not in ('all','customers','drivers','workers','single','customers_1','customers_2','customers_3','customers_4','customers_5') then
    raise exception 'فئة التوزيع غير صحيحة';
  end if;

  if p_target = 'single' then
    return 1;
  elsif p_target in ('customers_1','customers_2','customers_3','customers_4','customers_5') then
    select count(*) into v_count
    from (
      select p.id
      from public.profiles p
      where exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='customer')
        and (
          select count(*)
          from public.service_requests sr
          where sr.customer_id=p.id
            and sr.created_at >= now() - interval '7 days'
            and sr.status::text <> 'cancelled'
        ) = case p_target
              when 'customers_1' then 1
              when 'customers_2' then 2
              when 'customers_3' then 3
              when 'customers_4' then 4
              else 5
            end
        and (p_target <> 'customers_5' or (
          select count(*) from public.service_requests sr
          where sr.customer_id=p.id
            and sr.created_at >= now() - interval '7 days'
            and sr.status::text <> 'cancelled'
        ) >= 5)
    ) audience;
  else
    select count(*) into v_count
    from public.profiles p
    where case p_target
      when 'all' then true
      when 'customers' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='customer')
      when 'drivers' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='driver')
      when 'workers' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='worker')
      else false
    end;
  end if;
  return coalesce(v_count,0);
end;
$$;

create or replace function public.admin_distribute_coupon(
  p_coupon_id uuid,
  p_target text default 'all',
  p_single_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon public.coupons%rowtype;
  v_count integer := 0;
begin
  perform public.assert_staff('admin');
  if p_target not in ('all','customers','drivers','workers','single','customers_1','customers_2','customers_3','customers_4','customers_5') then
    raise exception 'فئة التوزيع غير صحيحة';
  end if;
  if p_target = 'single' and p_single_user_id is null then
    raise exception 'حدد المستخدم المطلوب';
  end if;

  select * into v_coupon
  from public.coupons
  where id = p_coupon_id and active = true
    and (expires_at is null or expires_at > now())
    and used_count < max_uses
  for update;
  if not found then
    raise exception 'الكوبون غير فعال أو منتهي الصلاحية أو مكتمل الاستخدام';
  end if;

  with customer_activity as (
    select sr.customer_id, count(*)::integer as request_count
    from public.service_requests sr
    where sr.created_at >= now() - interval '7 days'
      and sr.status::text <> 'cancelled'
    group by sr.customer_id
  ),
  targets as (
    select p.id
    from public.profiles p
    left join customer_activity ca on ca.customer_id=p.id
    where case p_target
      when 'all' then true
      when 'customers' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='customer')
      when 'drivers' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='driver')
      when 'workers' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='worker')
      when 'single' then p.id=p_single_user_id
      when 'customers_1' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='customer') and coalesce(ca.request_count,0)=1
      when 'customers_2' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='customer') and coalesce(ca.request_count,0)=2
      when 'customers_3' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='customer') and coalesce(ca.request_count,0)=3
      when 'customers_4' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='customer') and coalesce(ca.request_count,0)=4
      when 'customers_5' then exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='customer') and coalesce(ca.request_count,0)>=5
      else false
    end
  ),
  inserted as (
    insert into public.coupon_assignments(coupon_id,user_id,assigned_by)
    select p_coupon_id,t.id,auth.uid() from targets t
    on conflict (coupon_id,user_id) do nothing
    returning user_id
  ),
  notified as (
    insert into public.notifications(user_id,type,title,body,link,data)
    select i.user_id,'coupon_received','وصلك كوبون من ممنون 🎁',
      'الكود: ' || v_coupon.code || ' — ' ||
      case when v_coupon.type='percentage'
        then trim(to_char(v_coupon.value,'FM999990.##')) || '% خصم'
        else trim(to_char(v_coupon.value,'FM999999990')) || ' دينار خصم'
      end,
      '/coupons',
      jsonb_build_object('coupon_id',v_coupon.id,'code',v_coupon.code,
        'type',v_coupon.type,'value',v_coupon.value,'expires_at',v_coupon.expires_at)
    from inserted i
    returning id
  )
  select count(*) into v_count from inserted;

  perform public.log_admin_action(
    'distribute_coupon','coupon',p_coupon_id::text,
    jsonb_build_object('target',p_target,'sent',v_count,'activity_window','7 days')
  );
  return v_count;
end;
$$;

revoke all on function public.admin_coupon_audience_count(text) from public, anon;
grant execute on function public.admin_coupon_audience_count(text) to authenticated;
