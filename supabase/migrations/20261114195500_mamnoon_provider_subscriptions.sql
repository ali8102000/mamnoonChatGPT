-- Mamnoon provider subscriptions, trials, admin grants and QiCard payment ledger.
-- Safe additive migration: existing user/request/payment rows are preserved.
begin;

alter table public.subscription_plans
  add column if not exists features jsonb not null default '{}'::jsonb,
  add column if not exists governorate_limit integer not null default 0;

alter table public.user_subscriptions
  add column if not exists is_trial boolean not null default false,
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists granted_by uuid references public.profiles(id),
  add column if not exists grant_type text not null default 'paid',
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists provider_types text[] not null default '{}'::text[],
  add column if not exists allowed_governorates text[] not null default '{}'::text[],
  add column if not exists gateway_customer_ref text,
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists payment_token_ciphertext text,
  add column if not exists payment_token_iv text,
  add column if not exists payment_token_tag text,
  add column if not exists payment_token_type text;

create unique index if not exists user_subscriptions_user_id_uidx
  on public.user_subscriptions(user_id);

alter table public.subscription_payments
  add column if not exists provider text,
  add column if not exists merchant_request_id uuid,
  add column if not exists gateway_payment_id text,
  add column if not exists gateway_status text,
  add column if not exists failure_code text,
  add column if not exists paid_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists subscription_payments_merchant_request_uidx
  on public.subscription_payments(merchant_request_id)
  where merchant_request_id is not null;
create unique index if not exists subscription_payments_gateway_payment_uidx
  on public.subscription_payments(gateway_payment_id)
  where gateway_payment_id is not null;

update public.subscription_plans
set monthly_price = 0, yearly_price = 0, currency = 'IQD', is_active = true
where code = 'free';

insert into public.subscription_plans
  (code,name_ar,name_en,description_ar,tier,max_requests_per_month,priority_weight,offer_priority,
   badge_label,badge_color,show_stats,priority_support,monthly_price,yearly_price,currency,is_active,sort_order,features,governorate_limit)
values
  ('bronze','برونزي','Bronze','باقة البداية لمقدمي الخدمة',1,null,10,10,'برونزي','#CD7F32',true,false,10000,0,'IQD',true,10,
   '{"profile_promotion_monthly":4,"photos":true,"share_profile":true,"basic_analytics":true,"schedule_controls":true,"request_alerts":true,"support_priority":"standard"}'::jsonb,0),
  ('silver','فضي','Silver','باقة نمو وظهور متقدم',2,null,20,20,'فضي','#A7B0BC',true,true,15000,0,'IQD',true,20,
   '{"profile_promotion_monthly":8,"photos":true,"videos":true,"offers":true,"weekly_monthly_reports":true,"support_priority":"priority"}'::jsonb,1),
  ('gold','ذهبي','Gold','أعلى مستوى ظهور وتسويق ودعم',3,null,30,30,'ذهبي','#D4AF37',true,true,20000,0,'IQD',true,30,
   '{"profile_promotion_monthly":16,"photos":true,"videos":true,"offers":true,"featured_services":true,"top_provider_listing":true,"advanced_analytics":true,"campaigns":true,"support_priority":"urgent"}'::jsonb,2)
on conflict (code) do update set
  name_ar=excluded.name_ar,name_en=excluded.name_en,description_ar=excluded.description_ar,
  tier=excluded.tier,priority_weight=excluded.priority_weight,offer_priority=excluded.offer_priority,
  badge_label=excluded.badge_label,badge_color=excluded.badge_color,show_stats=true,
  priority_support=excluded.priority_support,monthly_price=excluded.monthly_price,
  currency='IQD',is_active=true,sort_order=excluded.sort_order,features=excluded.features,
  governorate_limit=excluded.governorate_limit;

insert into public.subscription_plans
  (code,name_ar,name_en,description_ar,tier,max_requests_per_month,priority_weight,offer_priority,
   badge_label,badge_color,show_stats,priority_support,monthly_price,yearly_price,currency,is_active,sort_order,features,governorate_limit)
values
  ('trial','تجريبي','Trial','تجربة مجانية لمقدمي الخدمة لمدة شهرين',0,null,0,0,'تجريبي','#64748B',true,false,0,0,'IQD',true,1,'{"trial":true}'::jsonb,0)
on conflict (code) do update set
  name_ar=excluded.name_ar,name_en=excluded.name_en,description_ar=excluded.description_ar,
  monthly_price=0,yearly_price=0,is_active=true,features=excluded.features;

create or replace function public.mamnoon_provider_kinds(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct
    case ur.role::text
      when 'worker' then 'worker'
      when 'large_driver' then 'kia'
      when 'driver' then
        case when exists (
          select 1 from public.driver_profiles dp
          where dp.user_id = ur.user_id
            and dp.vehicle_type in ('kia_cargo','kia_passenger','bus')
        ) then 'kia' else 'taxi' end
    end
  ), '{}'::text[])
  from public.user_roles ur
  where ur.user_id = p_user_id
    and ur.role::text in ('worker','driver','large_driver')
$$;

create or replace function public.mamnoon_start_provider_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trial_plan uuid;
  v_kinds text[];
  v_start timestamptz;
begin
  if new.role::text not in ('worker','driver','large_driver') then
    return new;
  end if;

  select id into v_trial_plan from public.subscription_plans where code='trial' and is_active limit 1;
  if v_trial_plan is null then return new; end if;

  v_kinds := public.mamnoon_provider_kinds(new.user_id);
  v_start := coalesce(new.created_at, now());

  insert into public.user_subscriptions
    (user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,
     request_count,resets_count_period_start,auto_renew,is_trial,trial_started_at,trial_ends_at,
     grant_type,provider_types)
  values
    (new.user_id,v_trial_plan,'active','monthly',v_start,v_start + interval '2 months',
     0,v_start,false,true,v_start,v_start + interval '2 months','trial',v_kinds)
  on conflict (user_id) do update
    set provider_types = (
      select array_agg(distinct x) from unnest(
        public.user_subscriptions.provider_types || excluded.provider_types
      ) x
    ),
    updated_at=now()
    where public.user_subscriptions.is_trial = true;

  return new;
end;
$$;

drop trigger if exists mamnoon_provider_trial_on_role_insert on public.user_roles;
create trigger mamnoon_provider_trial_on_role_insert
after insert on public.user_roles
for each row execute function public.mamnoon_start_provider_trial();

-- Backfill a one-time trial for existing providers, anchored to their earliest provider-role date.
with provider_first_seen as (
  select ur.user_id, min(ur.created_at) as first_seen
  from public.user_roles ur
  where ur.role::text in ('worker','driver','large_driver')
  group by ur.user_id
), kinds as (
  select p.user_id, p.first_seen, public.mamnoon_provider_kinds(p.user_id) as provider_types
  from provider_first_seen p
), trial_plan as (
  select id from public.subscription_plans where code='trial' limit 1
)
insert into public.user_subscriptions
  (user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,
   request_count,resets_count_period_start,auto_renew,is_trial,trial_started_at,trial_ends_at,
   grant_type,provider_types)
select k.user_id,tp.id,
       case when k.first_seen + interval '2 months' > now() then 'active' else 'expired' end,
       'monthly',k.first_seen,k.first_seen + interval '2 months',0,k.first_seen,false,true,
       k.first_seen,k.first_seen + interval '2 months','trial',k.provider_types
from kinds k cross join trial_plan tp
on conflict (user_id) do nothing;

create or replace function public.mamnoon_provider_subscription_active(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  select subscription_enabled into v_enabled
  from public.subscription_settings where id=1;
  if not coalesce(v_enabled,false) then return true; end if;

  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id=p_user_id
      and ur.role::text in ('worker','driver','large_driver')
  ) then
    return true;
  end if;

  return exists (
    select 1 from public.user_subscriptions us
    where us.user_id=p_user_id
      and us.status='active'
      and (
        (us.is_trial and us.trial_ends_at > now())
        or (us.current_period_end is not null and us.current_period_end > now())
        or (us.current_period_end is null and us.grant_type='admin')
      )
  );
end;
$$;

create or replace function public.mamnoon_guard_provider_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mamnoon_provider_subscription_active(new.provider_id) then
    raise exception 'subscription_required';
  end if;
  return new;
end;
$$;

drop trigger if exists mamnoon_require_subscription_for_offer on public.request_offers;
create trigger mamnoon_require_subscription_for_offer
before insert on public.request_offers
for each row execute function public.mamnoon_guard_provider_offer();

create or replace function public.mamnoon_guard_provider_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.provider_id is not null
     and (old.provider_id is null or old.provider_id is distinct from new.provider_id)
     and new.status::text in ('accepted','in_progress')
     and not public.mamnoon_provider_subscription_active(new.provider_id) then
    raise exception 'subscription_required';
  end if;
  return new;
end;
$$;

drop trigger if exists mamnoon_require_subscription_for_assignment on public.service_requests;
create trigger mamnoon_require_subscription_for_assignment
before update on public.service_requests
for each row execute function public.mamnoon_guard_provider_assignment();

create or replace function public.admin_grant_subscription(
  p_user_id uuid,
  p_plan_code text,
  p_duration text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_subscription_id uuid;
  v_start timestamptz := now();
  v_end timestamptz;
begin
  perform public.assert_staff('admin');
  if p_duration not in ('month','two_months','year','permanent') then
    raise exception 'invalid_duration';
  end if;
  select id into v_plan_id from public.subscription_plans
  where code=p_plan_code and is_active limit 1;
  if v_plan_id is null then raise exception 'plan_not_found'; end if;

  v_end := case p_duration
    when 'month' then v_start + interval '1 month'
    when 'two_months' then v_start + interval '2 months'
    when 'year' then v_start + interval '1 year'
    else null end;

  insert into public.user_subscriptions
    (user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,
     request_count,resets_count_period_start,auto_renew,is_trial,trial_started_at,trial_ends_at,
     granted_by,grant_type,cancel_at_period_end,cancelled_at,provider_types)
  values
    (p_user_id,v_plan_id,'active','monthly',v_start,v_end,0,v_start,false,false,null,null,
     auth.uid(),'admin',false,null,public.mamnoon_provider_kinds(p_user_id))
  on conflict (user_id) do update set
    plan_id=excluded.plan_id,status='active',billing_cycle='monthly',
    current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    request_count=0,resets_count_period_start=excluded.resets_count_period_start,auto_renew=false,
    is_trial=false,trial_started_at=null,trial_ends_at=null,granted_by=auth.uid(),
    grant_type='admin',cancel_at_period_end=false,cancelled_at=null,
    provider_types=excluded.provider_types,updated_at=now()
  returning id into v_subscription_id;

  return v_subscription_id;
end;
$$;

create or replace function public.admin_cancel_free_subscription(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('admin');
  update public.user_subscriptions
  set status='cancelled',cancelled_at=now(),cancel_at_period_end=false,updated_at=now()
  where user_id=p_user_id and grant_type='admin' and status='active';
  return found;
end;
$$;

create or replace function public.cancel_own_subscription_at_period_end()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  update public.user_subscriptions
  set cancel_at_period_end=true,auto_renew=false,updated_at=now()
  where user_id=auth.uid() and status='active'
    and current_period_end is not null;
  return found;
end;
$$;

create or replace function public.check_request_allowed(_user_id uuid)
returns table(allowed boolean, reason text, plan_code text, requests_used integer, requests_limit integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
begin
  if auth.uid() is not null and auth.uid() <> _user_id
     and not public.has_admin_access(auth.uid()) then
    raise exception 'forbidden';
  end if;

  if exists (select 1 from public.user_blocks b where b.user_id=_user_id
             and (b.expires_at is null or b.expires_at>now())) then
    return query select false,'blocked'::text,null::text,0,null::int; return;
  end if;

  select * into s from public.get_user_subscription(_user_id) limit 1;
  if not found then
    return query select false,'subscription_required'::text,'free'::text,0,null::int; return;
  end if;

  if not public.mamnoon_provider_subscription_active(_user_id) then
    return query select false,'subscription_required'::text,coalesce(s.plan_code,'free'),
      coalesce(s.request_count,0),s.max_requests_per_month; return;
  end if;

  if s.max_requests_per_month is not null and s.request_count>=s.max_requests_per_month then
    return query select false,'limit_reached'::text,s.plan_code,s.request_count,s.max_requests_per_month; return;
  end if;

  return query select true,'ok'::text,s.plan_code,s.request_count,s.max_requests_per_month;
end;
$$;

-- Keep reads scoped to the signed-in user (or an authenticated administrator).
create or replace function public.get_user_subscription(_user_id uuid)
returns table(
  plan_code text, plan_name_ar text, tier integer, max_requests_per_month integer,
  priority_weight integer, offer_priority integer, badge_label text, badge_color text,
  show_stats boolean, priority_support boolean, status text,
  current_period_end timestamptz, request_count integer, auto_renew boolean,
  subscription_enabled boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() <> _user_id
     and not public.has_admin_access(auth.uid()) then
    raise exception 'forbidden';
  end if;
  return query
  select p.code,p.name_ar,p.tier,p.max_requests_per_month,p.priority_weight,p.offer_priority,
         p.badge_label,p.badge_color,p.show_stats,p.priority_support,
         coalesce(us.status,'active'),us.current_period_end,coalesce(us.request_count,0),
         coalesce(us.auto_renew,false),
         (select ss.subscription_enabled from public.subscription_settings ss where ss.id=1)
  from public.subscription_plans p
  left join public.user_subscriptions us on us.user_id=_user_id and us.plan_id=p.id
       and us.status='active'
  where p.id=coalesce(
    (select x.plan_id from public.user_subscriptions x
      where x.user_id=_user_id and x.status='active' limit 1),
    (select y.id from public.subscription_plans y where y.code='free' limit 1)
  )
  limit 1;
end;
$$;

update public.subscription_settings
set subscription_enabled=true, minimum_downloads_before_activation=0, updated_at=now()
where id=1;

revoke all on function public.mamnoon_provider_kinds(uuid) from public, anon, authenticated;
revoke all on function public.mamnoon_provider_subscription_active(uuid) from public, anon, authenticated;
revoke all on function public.mamnoon_guard_provider_offer() from public, anon, authenticated;
revoke all on function public.mamnoon_guard_provider_assignment() from public, anon, authenticated;
revoke all on function public.mamnoon_start_provider_trial() from public, anon, authenticated;

revoke all on function public.admin_grant_subscription(uuid,text,text) from public, anon;
revoke all on function public.admin_cancel_free_subscription(uuid) from public, anon;
revoke all on function public.cancel_own_subscription_at_period_end() from public, anon;
grant execute on function public.admin_grant_subscription(uuid,text,text) to authenticated;
grant execute on function public.admin_cancel_free_subscription(uuid) to authenticated;
grant execute on function public.cancel_own_subscription_at_period_end() to authenticated;
grant execute on function public.check_request_allowed(uuid) to authenticated, service_role;
grant execute on function public.get_user_subscription(uuid) to authenticated, service_role;

commit;