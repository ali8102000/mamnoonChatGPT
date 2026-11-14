-- Notify a provider in the in-app notification center whenever an administrator grants a free subscription.
CREATE OR REPLACE FUNCTION public.admin_grant_subscription(p_user_id uuid, p_plan_code text, p_duration text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_plan_id uuid;
  v_plan_name text;
  v_subscription_id uuid;
  v_start timestamptz := now();
  v_end timestamptz;
  v_duration_label text;
begin
  perform public.assert_staff('admin');
  if p_duration not in ('month','two_months','year','permanent') then
    raise exception 'invalid_duration';
  end if;

  select id, name_ar into v_plan_id, v_plan_name
  from public.subscription_plans
  where code=p_plan_code and is_active
  limit 1;
  if v_plan_id is null then raise exception 'plan_not_found'; end if;

  v_end := case p_duration
    when 'month' then v_start + interval '1 month'
    when 'two_months' then v_start + interval '2 months'
    when 'year' then v_start + interval '1 year'
    else null end;

  v_duration_label := case p_duration
    when 'month' then 'شهر واحد'
    when 'two_months' then 'شهرين'
    when 'year' then 'سنة واحدة'
    else 'اشتراك دائم' end;

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

  insert into public.notifications (user_id, type, title, body, link, data)
  values (
    p_user_id,
    'subscription_granted',
    'ممنون منحك اشتراكاً مجانياً',
    'تم منحك باقة ' || v_plan_name || ' لمدة ' || v_duration_label ||
      case when v_end is null then '.' else '، وينتهي اشتراكك بتاريخ ' ||
        to_char(v_end at time zone 'Asia/Baghdad', 'YYYY-MM-DD HH24:MI') || '.' end ||
      ' استمتع بمزايا اشتراكك في ممنون.',
    '/profile',
    jsonb_build_object(
      'subscription_id', v_subscription_id,
      'plan_code', p_plan_code,
      'plan_name', v_plan_name,
      'duration', p_duration,
      'granted_by', auth.uid(),
      'expires_at', v_end
    )
  );

  return v_subscription_id;
end;
$function$;
