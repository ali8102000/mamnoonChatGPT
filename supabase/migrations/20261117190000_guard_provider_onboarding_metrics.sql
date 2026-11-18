-- Protect provider approval, suspension and all ranking metrics from client writes.
-- Metrics are derived only from completed requests and trusted ratings.
CREATE OR REPLACE FUNCTION public.guard_provider_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_is_admin boolean := auth.uid() IS NOT NULL AND public.has_admin_access(auth.uid());
  v_allow_metrics boolean := current_setting('mamnoon.allow_provider_metrics_update', true) = 'true';
  v_rating_count integer := 0;
  v_completed integer := 0;
  v_avg_rating numeric(3,2) := 0;
  v_tier text := 'unranked';
BEGIN
  -- Service-role jobs and authorized administrators are trusted writers.
  IF auth.uid() IS NULL OR v_is_admin THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'provider_profile_owner_mismatch';
    END IF;

    -- Every self-service provider starts unapproved and unavailable.
    NEW.status := 'pending';
    NEW.available := false;
    NEW.suspended_until := NULL;
    NEW.created_at := now();
    NEW.updated_at := now();

    SELECT COUNT(*)::integer, COALESCE(AVG(r.stars), 0)::numeric(3,2)
      INTO v_rating_count, v_avg_rating
    FROM public.ratings AS r
    WHERE r.ratee_id = NEW.user_id;

    NEW.rating_avg := v_avg_rating;
    NEW.ratings_count := v_rating_count;

    IF TG_TABLE_NAME = 'driver_profiles' THEN
      SELECT COUNT(*)::integer
        INTO v_completed
      FROM public.service_requests AS s
      WHERE s.provider_id = NEW.user_id
        AND s.type = 'taxi'
        AND s.status::text = 'completed';

      SELECT rule.tier
        INTO v_tier
      FROM public.driver_performance_tier_rules AS rule
      WHERE rule.is_active
        AND v_completed >= rule.min_completed_rides
        AND v_rating_count >= rule.min_ratings_count
        AND v_avg_rating >= rule.min_avg_rating
      ORDER BY rule.priority DESC, rule.min_completed_rides DESC
      LIMIT 1;

      NEW.completed_rides := v_completed;
      NEW.performance_tier := COALESCE(v_tier, 'unranked');
    ELSIF TG_TABLE_NAME = 'worker_profiles' THEN
      SELECT COUNT(*)::integer
        INTO v_completed
      FROM public.service_requests AS s
      WHERE s.provider_id = NEW.user_id
        AND s.type = 'service'
        AND s.status::text = 'completed';

      NEW.completed_jobs := v_completed;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'provider_profile_identity_readonly';
    END IF;

    -- A provider may resubmit a rejected profile, but cannot approve,
    -- suspend, or reset an already approved/suspended profile.
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'rejected' AND NEW.status = 'pending') THEN
      RAISE EXCEPTION 'status_readonly';
    END IF;

    IF NEW.suspended_until IS DISTINCT FROM OLD.suspended_until THEN
      RAISE EXCEPTION 'provider_suspension_readonly';
    END IF;

    -- Derived counters and ranking are writable only by trusted database
    -- recalculation functions, which set this transaction-local guard.
    IF NOT v_allow_metrics THEN
      IF TG_TABLE_NAME = 'driver_profiles' AND (
        NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
        OR NEW.ratings_count IS DISTINCT FROM OLD.ratings_count
        OR NEW.completed_rides IS DISTINCT FROM OLD.completed_rides
        OR NEW.performance_tier IS DISTINCT FROM OLD.performance_tier
      ) THEN
        RAISE EXCEPTION 'provider_metrics_readonly';
      END IF;

      IF TG_TABLE_NAME = 'worker_profiles' AND (
        NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
        OR NEW.ratings_count IS DISTINCT FROM OLD.ratings_count
        OR NEW.completed_jobs IS DISTINCT FROM OLD.completed_jobs
      ) THEN
        RAISE EXCEPTION 'provider_metrics_readonly';
      END IF;
    END IF;

    IF OLD.status = 'approved' THEN
      IF TG_TABLE_NAME = 'driver_profiles' AND (
        NEW.vehicle_make IS DISTINCT FROM OLD.vehicle_make
        OR NEW.vehicle_model IS DISTINCT FROM OLD.vehicle_model
        OR NEW.vehicle_year IS DISTINCT FROM OLD.vehicle_year
        OR NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category
        OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
        OR NEW.vehicle_plate IS DISTINCT FROM OLD.vehicle_plate
        OR NEW.vehicle_color IS DISTINCT FROM OLD.vehicle_color
      ) THEN
        RAISE EXCEPTION 'approved_vehicle_changes_require_admin_review';
      END IF;

      IF TG_TABLE_NAME = 'worker_profiles'
         AND NEW.level IS DISTINCT FROM OLD.level THEN
        RAISE EXCEPTION 'approved_worker_level_change_requires_admin_review';
      END IF;
    END IF;

    IF NEW.status <> 'approved' THEN
      NEW.available := false;
    END IF;
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_provider_status() FROM PUBLIC, anon, authenticated;

-- Driver performance tiers are based on taxi rides and trusted ratings.
CREATE OR REPLACE FUNCTION public.recalculate_driver_performance_tier(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_completed integer := 0;
  v_rating_count integer := 0;
  v_avg_rating numeric := 0;
  v_tier text := 'unranked';
  v_previous_setting text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'unranked';
  END IF;

  SELECT COUNT(*)::integer
    INTO v_completed
  FROM public.service_requests AS s
  WHERE s.provider_id = p_user_id
    AND s.type = 'taxi'
    AND s.status::text = 'completed';

  SELECT COUNT(*)::integer, COALESCE(AVG(r.stars), 0)
    INTO v_rating_count, v_avg_rating
  FROM public.ratings AS r
  WHERE r.ratee_id = p_user_id;

  SELECT rule.tier
    INTO v_tier
  FROM public.driver_performance_tier_rules AS rule
  WHERE rule.is_active
    AND v_completed >= rule.min_completed_rides
    AND v_rating_count >= rule.min_ratings_count
    AND v_avg_rating >= rule.min_avg_rating
  ORDER BY rule.priority DESC, rule.min_completed_rides DESC
  LIMIT 1;

  v_tier := COALESCE(v_tier, 'unranked');
  v_previous_setting := current_setting('mamnoon.allow_provider_metrics_update', true);
  PERFORM set_config('mamnoon.allow_provider_metrics_update', 'true', true);

  UPDATE public.driver_profiles
  SET performance_tier = v_tier,
      completed_rides = v_completed,
      rating_avg = v_avg_rating,
      ratings_count = v_rating_count,
      updated_at = now()
  WHERE user_id = p_user_id;

  PERFORM set_config('mamnoon.allow_provider_metrics_update', COALESCE(v_previous_setting, ''), true);
  RETURN v_tier;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_driver_performance_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_driver_performance_tier(uuid) TO service_role;

-- Backfill the derived counters from their authoritative sources.
DO $function$
DECLARE
  v_user_id uuid;
BEGIN
  FOR v_user_id IN SELECT user_id FROM public.driver_profiles LOOP
    PERFORM public.recalculate_driver_performance_tier(v_user_id);
  END LOOP;
END
$function$;

UPDATE public.worker_profiles AS wp
SET rating_avg = COALESCE((
      SELECT AVG(r.stars)::numeric(3,2)
      FROM public.ratings AS r
      WHERE r.ratee_id = wp.user_id
    ), 0),
    ratings_count = (
      SELECT COUNT(*)::integer
      FROM public.ratings AS r
      WHERE r.ratee_id = wp.user_id
    ),
    completed_jobs = (
      SELECT COUNT(*)::integer
      FROM public.service_requests AS s
      WHERE s.provider_id = wp.user_id
        AND s.type = 'service'
        AND s.status::text = 'completed'
    ),
    updated_at = now();
