UPDATE public.subscription_plans AS free_plan
SET tier = bronze.tier,
    max_requests_per_month = bronze.max_requests_per_month,
    priority_weight = bronze.priority_weight,
    offer_priority = bronze.offer_priority,
    badge_label = 'برونزي',
    badge_color = bronze.badge_color,
    show_stats = bronze.show_stats,
    priority_support = bronze.priority_support,
    features = COALESCE(bronze.features, '{}'::jsonb),
    monthly_price = 0,
    yearly_price = 0,
    is_active = true
FROM public.subscription_plans AS bronze
WHERE free_plan.code = 'free'
  AND bronze.code = 'bronze';

CREATE OR REPLACE FUNCTION public.mamnoon_provider_subscription_active(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled boolean;
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_user_id
     AND NOT public.has_admin_access(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT subscription_enabled INTO v_enabled
  FROM public.subscription_settings
  WHERE id = 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN true;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role::text IN ('worker', 'driver', 'large_driver')
  ) THEN
    RETURN true;
  END IF;

  -- A still-valid paused subscription remains paused; it must not silently
  -- fall through to the free Bronze baseline.
  IF EXISTS (
    SELECT 1
    FROM public.user_subscriptions us
    WHERE us.user_id = p_user_id
      AND us.status = 'paused'
      AND (us.current_period_end IS NULL OR us.current_period_end > now())
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_subscriptions us
    WHERE us.user_id = p_user_id
      AND us.status = 'active'
      AND (
        (us.is_trial AND us.trial_ends_at > now())
        OR (us.current_period_end IS NOT NULL AND us.current_period_end > now())
        OR (us.current_period_end IS NULL AND us.grant_type = 'admin')
      )
  ) THEN
    RETURN true;
  END IF;

  -- Every provider without a currently valid paid/company/trial subscription
  -- receives the real free plan, whose entitlements mirror Bronze.
  RETURN EXISTS (
    SELECT 1
    FROM public.subscription_plans sp
    WHERE sp.code = 'free'
      AND sp.is_active = true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mamnoon_provider_subscription_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mamnoon_provider_subscription_active(uuid) TO authenticated, service_role;
