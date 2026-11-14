ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS paused_at timestamptz;

CREATE OR REPLACE FUNCTION public.pause_own_subscription()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.user_subscriptions SET status='paused', paused_at=now(), updated_at=now()
  WHERE user_id=auth.uid() AND status='active'
    AND (current_period_end IS NULL OR current_period_end > now());
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resume_own_subscription()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.user_subscriptions SET status='active', paused_at=NULL, updated_at=now()
  WHERE user_id=auth.uid() AND status='paused'
    AND (current_period_end IS NULL OR current_period_end > now());
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.user_subscriptions WHERE user_id=auth.uid() AND status='paused') THEN
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
  UPDATE public.user_subscriptions SET cancel_at_period_end=false, updated_at=now()
  WHERE user_id=auth.uid() AND status IN ('active','paused') AND cancel_at_period_end=true
    AND (current_period_end IS NULL OR current_period_end > now());
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.pause_own_subscription() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resume_own_subscription() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_own_subscription_continuation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pause_own_subscription() TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_own_subscription() TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_own_subscription_continuation() TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_expired_subscriptions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_expired_count integer := 0; v_days integer;
BEGIN
  WITH expired AS (
    UPDATE public.user_subscriptions SET status='expired', updated_at=now()
    WHERE status IN ('active','paused') AND current_period_end IS NOT NULL AND current_period_end < now()
    RETURNING id,user_id,current_period_end
  )
  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  SELECT user_id,'subscription_expired','انتهى اشتراكك',
    'انتهت مدة اشتراكك. جدّد اشتراكك حتى تتمكن من استقبال طلبات جديدة.',
    '/profile',jsonb_build_object('subscription_id',id,'expired_at',current_period_end)
  FROM expired;
  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  FOREACH v_days IN ARRAY ARRAY[4,3,2,1] LOOP
    INSERT INTO public.notifications(user_id,type,title,body,link,data)
    SELECT us.user_id,'subscription_expiring',
      CASE WHEN v_days=1 THEN 'تنبيه أخير: اشتراكك ينتهي غداً'
        ELSE 'باقي '||v_days||' أيام على انتهاء اشتراكك' END,
      'اشتراك '||p.name_ar||' ينتهي بتاريخ '||
        to_char(us.current_period_end AT TIME ZONE 'Asia/Baghdad','YYYY-MM-DD HH24:MI')||
        '. جدّد الآن حتى لا يتوقف استقبال الطلبات الجديدة.',
      '/profile',jsonb_build_object('subscription_id',us.id,'days_before',v_days,
        'expires_at',us.current_period_end,'plan_name',p.name_ar)
    FROM public.user_subscriptions us JOIN public.subscription_plans p ON p.id=us.plan_id
    WHERE us.status='active' AND us.current_period_end IS NOT NULL
      AND us.current_period_end>now()
      AND us.current_period_end::date=(now()+make_interval(days=>v_days))::date
    ON CONFLICT (user_id,((data->>'subscription_id')),((data->>'days_before')))
      WHERE type='subscription_expiring' AND data?'subscription_id' AND data?'days_before'
    DO NOTHING;
  END LOOP;
  RETURN v_expired_count;
END;
$function$;
