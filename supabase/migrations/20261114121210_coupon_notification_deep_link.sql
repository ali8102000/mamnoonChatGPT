create or replace function public.admin_distribute_coupon(
  p_coupon_id uuid,
  p_target text default 'all',
  p_single_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_coupon public.coupons%rowtype;
  v_count integer := 0;
begin
  perform public.assert_staff('admin');
  if p_target not in ('all','drivers','workers','single') then
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

  with targets as (
    select p.id from public.profiles p
    where case p_target
      when 'all' then true
      when 'drivers' then exists (
        select 1 from public.user_roles r where r.user_id=p.id and r.role='driver'
      )
      when 'workers' then exists (
        select 1 from public.user_roles r where r.user_id=p.id and r.role='worker'
      )
      when 'single' then p.id=p_single_user_id
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
    jsonb_build_object('target',p_target,'sent',v_count)
  );
  return v_count;
end;
$function$;
