create table if not exists public.coupon_assignments (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (coupon_id, user_id)
);

create index if not exists coupon_assignments_user_id_idx
  on public.coupon_assignments(user_id, assigned_at desc);
create index if not exists coupon_assignments_coupon_id_idx
  on public.coupon_assignments(coupon_id);

alter table public.coupon_assignments enable row level security;

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
    select p.id
    from public.profiles p
    where case p_target
      when 'all' then true
      when 'drivers' then exists (
        select 1 from public.user_roles r where r.user_id = p.id and r.role = 'driver'
      )
      when 'workers' then exists (
        select 1 from public.user_roles r where r.user_id = p.id and r.role = 'worker'
      )
      when 'single' then p.id = p_single_user_id
      else false
    end
  ),
  inserted as (
    insert into public.coupon_assignments(coupon_id,user_id,assigned_by)
    select p_coupon_id,t.id,auth.uid()
    from targets t
    on conflict (coupon_id,user_id) do nothing
    returning user_id
  )
  select count(*) into v_count from inserted;

  insert into public.notifications(user_id,type,title,body,link,data)
  select a.user_id,
         'coupon_received',
         'وصلك كوبون من ممنون 🎁',
         'الكود: ' || v_coupon.code || ' — خصم ' ||
           case when v_coupon.type='percentage'
             then trim(to_char(v_coupon.value,'FM999990.##')) || '%'
             else trim(to_char(v_coupon.value,'FM999999990')) || ' دينار'
           end,
         '/request/new?coupon=' || v_coupon.code,
         jsonb_build_object('coupon_id',v_coupon.id,'code',v_coupon.code,
           'type',v_coupon.type,'value',v_coupon.value,'expires_at',v_coupon.expires_at)
  from public.coupon_assignments a
  join targets_dummy_not_used on false
  where false;

  -- Notify only newly assigned recipients.
  insert into public.notifications(user_id,type,title,body,link,data)
  select ca.user_id,
         'coupon_received',
         'وصلك كوبون من ممنون 🎁',
         'الكود: ' || v_coupon.code || ' — ' ||
           case when v_coupon.type='percentage'
             then trim(to_char(v_coupon.value,'FM999990.##')) || '% خصم'
             else trim(to_char(v_coupon.value,'FM999999990')) || ' دينار خصم'
           end,
         '/request/new?coupon=' || v_coupon.code,
         jsonb_build_object('coupon_id',v_coupon.id,'code',v_coupon.code,
           'type',v_coupon.type,'value',v_coupon.value,'expires_at',v_coupon.expires_at)
  from public.coupon_assignments ca
  where ca.coupon_id = p_coupon_id
    and ca.assigned_at >= now() - interval '2 seconds'
    and ca.assigned_by is not distinct from auth.uid();

  perform public.log_admin_action(
    'distribute_coupon','coupon',p_coupon_id::text,
    jsonb_build_object('target',p_target,'sent',v_count)
  );
  return v_count;
end;
$function$;

create or replace function public.get_my_coupons()
returns table (
  id uuid,
  code text,
  type text,
  value numeric,
  min_amount numeric,
  expires_at timestamptz,
  active boolean,
  assigned_at timestamptz,
  used boolean
)
language sql
security definer
stable
set search_path = public
as $function$
  select c.id,c.code,c.type,c.value,c.min_amount,c.expires_at,c.active,
         a.assigned_at,
         exists (
           select 1 from public.notifications n
           where n.user_id = auth.uid()
             and n.type = 'coupon_redeemed'
             and n.data->>'coupon_id' = c.id::text
         ) as used
  from public.coupon_assignments a
  join public.coupons c on c.id = a.coupon_id
  where a.user_id = auth.uid()
  order by a.assigned_at desc;
$function$;

revoke all on function public.admin_distribute_coupon(uuid,text,uuid) from public, anon;
grant execute on function public.admin_distribute_coupon(uuid,text,uuid) to authenticated;
revoke all on function public.get_my_coupons() from public, anon;
grant execute on function public.get_my_coupons() to authenticated;
