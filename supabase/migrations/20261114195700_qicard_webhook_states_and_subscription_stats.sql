-- Correct pending QiCard webhook handling and provide subscription dashboard aggregates.
create or replace function public.finalize_qicard_subscription_payment(
  p_merchant_request_id uuid,
  p_gateway_payment_id text,
  p_confirmed_amount integer,
  p_currency text,
  p_gateway_status text,
  p_gateway_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.subscription_payments%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_start timestamptz;
  v_end timestamptz;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;

  select * into v_payment from public.subscription_payments
  where merchant_request_id=p_merchant_request_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if v_payment.status='paid' then return true; end if;
  if v_payment.status <> 'pending' then return false; end if;

  if p_gateway_status not in ('SUCCESS','FAILED','AUTHENTICATION_FAILED','CANCELLED') then
    update public.subscription_payments
    set gateway_status=p_gateway_status,
        gateway_payment_id=coalesce(gateway_payment_id,p_gateway_payment_id),
        metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_gateway_payload,'{}'::jsonb)
    where id=v_payment.id;
    return false;
  end if;

  if p_gateway_status <> 'SUCCESS' then
    update public.subscription_payments
    set status='failed',gateway_status=p_gateway_status,
        gateway_payment_id=coalesce(gateway_payment_id,p_gateway_payment_id),
        metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_gateway_payload,'{}'::jsonb)
    where id=v_payment.id;
    return false;
  end if;

  if v_payment.amount <> p_confirmed_amount or v_payment.currency <> p_currency or p_currency <> 'IQD' then
    raise exception 'payment_amount_or_currency_mismatch';
  end if;
  if v_payment.plan_id is null then raise exception 'payment_plan_missing'; end if;
  select * into v_plan from public.subscription_plans where id=v_payment.plan_id and is_active;
  if not found then raise exception 'subscription_plan_unavailable'; end if;

  select case when us.status='active' and not us.is_trial and us.current_period_end > now()
              then us.current_period_end else now() end
  into v_start from public.user_subscriptions us where us.user_id=v_payment.user_id;
  if v_start is null then v_start:=now(); end if;
  v_end:=v_start+interval '1 month';

  insert into public.user_subscriptions
    (user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,
     request_count,resets_count_period_start,auto_renew,is_trial,trial_started_at,trial_ends_at,
     granted_by,grant_type,cancel_at_period_end,cancelled_at,provider_types)
  values
    (v_payment.user_id,v_payment.plan_id,'active','monthly',v_start,v_end,0,now(),false,
     false,null,null,null,'paid',false,null,public.mamnoon_provider_kinds(v_payment.user_id))
  on conflict (user_id) do update set
    plan_id=excluded.plan_id,status='active',billing_cycle='monthly',
    current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    request_count=0,resets_count_period_start=now(),auto_renew=false,
    is_trial=false,trial_started_at=null,trial_ends_at=null,granted_by=null,
    grant_type='paid',cancel_at_period_end=false,cancelled_at=null,
    provider_types=excluded.provider_types,updated_at=now();

  update public.subscription_payments
  set status='paid',gateway_status='SUCCESS',gateway_payment_id=p_gateway_payment_id,
      paid_at=now(),period_start=v_start,period_end=v_end,
      metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_gateway_payload,'{}'::jsonb)
  where id=v_payment.id;

  insert into public.notifications(user_id,type,title,body,link)
  values(v_payment.user_id,'subscription_activated','تم تفعيل اشتراكك',
         'تم تأكيد الدفع وتفعيل باقة '||v_plan.name_ar||' لمدة شهر','/subscriptions');
  return true;
end;
$$;

create or replace function public.get_subscription_stats_v2()
returns table(
  total_subscribers bigint,
  active_subscriptions bigint,
  expired_subscriptions bigint,
  monthly_revenue bigint,
  yearly_revenue bigint,
  free_count bigint,
  bronze_count bigint,
  silver_count bigint,
  gold_count bigint,
  trial_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('admin');
  return query
  select
    count(*)::bigint,
    count(*) filter (where us.status='active' and (us.current_period_end is null or us.current_period_end>now()))::bigint,
    count(*) filter (where us.status='expired' or (us.current_period_end is not null and us.current_period_end<=now()))::bigint,
    coalesce((select sum(sp.amount)::bigint from public.subscription_payments sp
      where sp.status='paid' and sp.paid_at>=date_trunc('month',now())),0),
    coalesce((select sum(sp.amount)::bigint from public.subscription_payments sp
      where sp.status='paid' and sp.paid_at>=date_trunc('year',now())),0),
    count(*) filter (where p.code='free')::bigint,
    count(*) filter (where p.code='bronze')::bigint,
    count(*) filter (where p.code='silver')::bigint,
    count(*) filter (where p.code='gold')::bigint,
    count(*) filter (where us.is_trial)::bigint
  from public.user_subscriptions us
  join public.subscription_plans p on p.id=us.plan_id;
end;
$$;
revoke all on function public.get_subscription_stats_v2() from public, anon;
grant execute on function public.get_subscription_stats_v2() to authenticated;