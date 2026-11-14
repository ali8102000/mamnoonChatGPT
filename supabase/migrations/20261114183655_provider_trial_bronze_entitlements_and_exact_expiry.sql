-- Give every provider's two-month free trial the full Bronze entitlement.
-- Company-granted Silver/Gold plans retain their exact plan features and are admin-managed.
UPDATE public.subscription_plans t
SET tier=b.tier,
    max_requests_per_month=b.max_requests_per_month,
    priority_weight=b.priority_weight,
    offer_priority=b.offer_priority,
    badge_label='برونزي تجريبي',
    badge_color=b.badge_color,
    show_stats=b.show_stats,
    priority_support=b.priority_support,
    features=coalesce(b.features,'{}'::jsonb)||jsonb_build_object('trial',true)
FROM public.subscription_plans b
WHERE t.code='trial' AND b.code='bronze';

-- The trial clock starts when the provider role is assigned, not when the
-- underlying account/profile was originally created.
CREATE OR REPLACE FUNCTION public.mamnoon_start_provider_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_trial_plan uuid; v_kinds text[]; v_start timestamptz := now();
BEGIN
  IF NEW.role::text NOT IN ('worker','driver','large_driver') THEN RETURN NEW; END IF;
  SELECT id INTO v_trial_plan FROM public.subscription_plans WHERE code='trial' AND is_active LIMIT 1;
  IF v_trial_plan IS NULL THEN RETURN NEW; END IF;
  v_kinds := public.mamnoon_provider_kinds(NEW.user_id);
  INSERT INTO public.user_subscriptions
    (user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,
     request_count,resets_count_period_start,auto_renew,is_trial,trial_started_at,trial_ends_at,grant_type,provider_types)
  VALUES (NEW.user_id,v_trial_plan,'active','monthly',v_start,v_start+interval '2 months',
     0,v_start,false,true,v_start,v_start+interval '2 months','trial',v_kinds)
  ON CONFLICT (user_id) DO UPDATE SET
    provider_types=(SELECT array_agg(DISTINCT x) FROM unnest(public.user_subscriptions.provider_types||EXCLUDED.provider_types) x),
    updated_at=now()
  WHERE public.user_subscriptions.is_trial=true;
  RETURN NEW;
END;
$function$;

-- Persist expiration at the boundary (<= now). The request gate also checks
-- current_period_end > now(), so access stops at the exact timestamp.
CREATE OR REPLACE FUNCTION public.handle_expired_subscriptions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_expired_count integer:=0; v_days integer;
BEGIN
  WITH expired AS (
    UPDATE public.user_subscriptions SET status='expired',updated_at=now()
    WHERE status IN ('active','paused') AND current_period_end IS NOT NULL
      AND current_period_end<=now()
    RETURNING id,user_id,current_period_end
  )
  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  SELECT user_id,'subscription_expired','انتهى اشتراكك',
    'انتهت مدة اشتراكك. جدّد اشتراكك حتى تتمكن من استقبال طلبات جديدة.',
    '/profile',jsonb_build_object('subscription_id',id,'expired_at',current_period_end)
  FROM expired;
  GET DIAGNOSTICS v_expired_count=ROW_COUNT;

  FOREACH v_days IN ARRAY ARRAY[4,3,2,1] LOOP
    INSERT INTO public.notifications(user_id,type,title,body,link,data)
    SELECT us.user_id,'subscription_expiring',
      CASE WHEN v_days=1 THEN 'تنبيه أخير: اشتراكك ينتهي غداً' ELSE 'باقي '||v_days||' أيام على انتهاء اشتراكك' END,
      'اشتراك '||p.name_ar||' ينتهي بتاريخ '||
        to_char(us.current_period_end AT TIME ZONE 'Asia/Baghdad','YYYY-MM-DD HH24:MI')||
        '. جدّد الآن حتى لا يتوقف استقبال الطلبات الجديدة.',
      '/profile',jsonb_build_object('subscription_id',us.id,'days_before',v_days,
        'expires_at',us.current_period_end,'plan_name',p.name_ar)
    FROM public.user_subscriptions us JOIN public.subscription_plans p ON p.id=us.plan_id
    WHERE us.status='active' AND us.current_period_end IS NOT NULL
      AND us.current_period_end>now()
      AND us.current_period_end<=now()+make_interval(days=>v_days)
      AND us.current_period_end>now()+make_interval(days=>v_days-1)
    ON CONFLICT (user_id,((data->>'subscription_id')),((data->>'days_before')))
      WHERE type='subscription_expiring' AND data?'subscription_id' AND data?'days_before'
    DO NOTHING;
  END LOOP;
  RETURN v_expired_count;
END;
$function$;

-- A company grant cannot be paused, cancelled, resumed, or altered by its
-- recipient. Mamnoon staff retain their admin RPC controls.
CREATE OR REPLACE FUNCTION public.cancel_own_subscription_at_period_end()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_subscriptions WHERE user_id=auth.uid() AND grant_type='admin') THEN
    RAISE EXCEPTION 'company_granted_subscription_managed_by_admin';
  END IF;
  UPDATE public.user_subscriptions SET cancel_at_period_end=true,auto_renew=false,updated_at=now()
  WHERE user_id=auth.uid() AND status='active' AND current_period_end IS NOT NULL;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pause_own_subscription()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_subscriptions WHERE user_id=auth.uid() AND grant_type='admin') THEN
    RAISE EXCEPTION 'company_granted_subscription_managed_by_admin';
  END IF;
  UPDATE public.user_subscriptions SET status='paused',paused_at=now(),updated_at=now()
  WHERE user_id=auth.uid() AND status='active' AND (current_period_end IS NULL OR current_period_end>now());
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resume_own_subscription()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_subscriptions WHERE user_id=auth.uid() AND grant_type='admin') THEN
    RAISE EXCEPTION 'company_granted_subscription_managed_by_admin';
  END IF;
  UPDATE public.user_subscriptions SET status='active',paused_at=NULL,updated_at=now()
  WHERE user_id=auth.uid() AND status='paused' AND (current_period_end IS NULL OR current_period_end>now());
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM public.user_subscriptions WHERE user_id=auth.uid() AND status='paused') THEN
      RAISE EXCEPTION 'subscription_period_expired';
    END IF;
    RETURN false;
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_own_subscription_continuation()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_subscriptions WHERE user_id=auth.uid() AND grant_type='admin') THEN
    RAISE EXCEPTION 'company_granted_subscription_managed_by_admin';
  END IF;
  UPDATE public.user_subscriptions SET cancel_at_period_end=false,updated_at=now()
  WHERE user_id=auth.uid() AND status IN ('active','paused') AND cancel_at_period_end=true
    AND (current_period_end IS NULL OR current_period_end>now());
  RETURN FOUND;
END;
$function$;

-- Run expiry processing every minute. Request eligibility is denied at the
-- exact end timestamp; this job synchronizes persisted status/notifications.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='mamnoon-expire-subscriptions';
SELECT cron.schedule('mamnoon-expire-subscriptions','* * * * *',
                     'select public.handle_expired_subscriptions();');

-- Prevent a late QiCard callback from replacing a company-managed grant.
CREATE OR REPLACE FUNCTION public.finalize_qicard_subscription_payment(
  p_merchant_request_id uuid,
  p_gateway_payment_id text,
  p_confirmed_amount integer,
  p_currency text,
  p_gateway_status text,
  p_gateway_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_payment public.subscription_payments%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO v_payment FROM public.subscription_payments
  WHERE merchant_request_id=p_merchant_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF v_payment.status='paid' THEN RETURN true; END IF;
  IF v_payment.status <> 'pending' THEN RETURN false; END IF;
  IF p_gateway_status NOT IN ('SUCCESS','FAILED','AUTHENTICATION_FAILED','CANCELLED') THEN
    UPDATE public.subscription_payments
    SET gateway_status=p_gateway_status,
        gateway_payment_id=coalesce(gateway_payment_id,p_gateway_payment_id),
        metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_gateway_payload,'{}'::jsonb)
    WHERE id=v_payment.id;
    RETURN false;
  END IF;
  IF p_gateway_status <> 'SUCCESS' THEN
    UPDATE public.subscription_payments
    SET status='failed',gateway_status=p_gateway_status,
        gateway_payment_id=coalesce(gateway_payment_id,p_gateway_payment_id),
        metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_gateway_payload,'{}'::jsonb)
    WHERE id=v_payment.id;
    RETURN false;
  END IF;
  IF v_payment.amount <> p_confirmed_amount OR v_payment.currency <> p_currency OR p_currency <> 'IQD' THEN
    RAISE EXCEPTION 'payment_amount_or_currency_mismatch';
  END IF;
  IF v_payment.plan_id IS NULL THEN RAISE EXCEPTION 'payment_plan_missing'; END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id=v_payment.plan_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription_plan_unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_subscriptions WHERE user_id=v_payment.user_id AND grant_type='admin') THEN
    RAISE EXCEPTION 'company_granted_subscription_managed_by_admin';
  END IF;
  SELECT CASE WHEN us.status='active' AND NOT us.is_trial AND us.current_period_end>now()
              THEN us.current_period_end ELSE now() END
  INTO v_start FROM public.user_subscriptions us WHERE us.user_id=v_payment.user_id;
  IF v_start IS NULL THEN v_start:=now(); END IF;
  v_end:=v_start+interval '1 month';
  INSERT INTO public.user_subscriptions
    (user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,
     request_count,resets_count_period_start,auto_renew,is_trial,trial_started_at,trial_ends_at,
     granted_by,grant_type,cancel_at_period_end,cancelled_at,provider_types)
  VALUES
    (v_payment.user_id,v_payment.plan_id,'active','monthly',v_start,v_end,0,now(),false,
     false,null,null,null,'paid',false,null,public.mamnoon_provider_kinds(v_payment.user_id))
  ON CONFLICT (user_id) DO UPDATE SET
    plan_id=excluded.plan_id,status='active',billing_cycle='monthly',
    current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    request_count=0,resets_count_period_start=now(),auto_renew=false,
    is_trial=false,trial_started_at=null,trial_ends_at=null,granted_by=null,
    grant_type='paid',cancel_at_period_end=false,cancelled_at=null,
    provider_types=excluded.provider_types,updated_at=now();
  UPDATE public.subscription_payments
  SET status='paid',gateway_status='SUCCESS',gateway_payment_id=p_gateway_payment_id,
      paid_at=now(),period_start=v_start,period_end=v_end,
      metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_gateway_payload,'{}'::jsonb)
  WHERE id=v_payment.id;
  INSERT INTO public.notifications(user_id,type,title,body,link)
  VALUES(v_payment.user_id,'subscription_activated','تم تفعيل اشتراكك',
         'تم تأكيد الدفع وتفعيل باقة '||v_plan.name_ar||' لمدة شهر','/subscriptions');
  RETURN true;
END;
$function$;
