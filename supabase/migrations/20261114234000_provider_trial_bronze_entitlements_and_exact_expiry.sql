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
