-- Atomically finalize a verified QiCard payment and activate/extend its subscription.
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
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if p_gateway_status <> 'SUCCESS' then
    update public.subscription_payments
      set status='failed',gateway_status=p_gateway_status,metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_gateway_payload,'{}'::jsonb)
    where merchant_request_id=p_merchant_request_id and status='pending';
    return false;
  end if;

  select * into v_payment
  from public.subscription_payments
  where merchant_request_id=p_merchant_request_id
  for update;
  if not found then raise exception 'payment_not_found'; end if;
  if v_payment.status='paid' then return true; end if;
  if v_payment.status <> 'pending' then raise exception 'payment_not_pending'; end if;
  if v_payment.amount <> p_confirmed_amount or v_payment.currency <> p_currency or p_currency <> 'IQD' then
    raise exception 'payment_amount_or_currency_mismatch';
  end if;
  if v_payment.plan_id is null then raise exception 'payment_plan_missing'; end if;

  select * into v_plan from public.subscription_plans where id=v_payment.plan_id and is_active;
  if not found then raise exception 'subscription_plan_unavailable'; end if;

  select case
    when us.status='active' and us.current_period_end > now() then us.current_period_end
    else now()
  end into v_start
  from public.user_subscriptions us where us.user_id=v_payment.user_id;

  if v_start is null then v_start := now(); end if;
  v_end := v_start + interval '1 month';

  insert into public.user_subscriptions
    (user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,
     request_count,resets_count_period_start,auto_renew,is_trial,trial_started_at,trial_ends_at,
     granted_by,grant_type,cancel_at_period_end,cancelled_at,provider_types)
  values
    (v_payment.user_id,v_payment.plan_id,'active','monthly',v_start,v_end,
     0,now(),false,false,null,null,null,'paid',false,null,
     public.mamnoon_provider_kinds(v_payment.user_id))
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
         'تم تأكيد الدفع وتفعيل باقة '||v_plan.name_ar||' لمدة شهر','/profile');

  return true;
end;
$$;

revoke all on function public.finalize_qicard_subscription_payment(uuid,text,integer,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.finalize_qicard_subscription_payment(uuid,text,integer,text,text,jsonb) to service_role;