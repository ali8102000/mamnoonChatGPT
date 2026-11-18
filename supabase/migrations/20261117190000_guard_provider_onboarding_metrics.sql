-- Prevent users from seeding trusted provider metrics during self-service onboarding.
-- RLS limits profile creation to auth.uid() = user_id and the status guard
-- forces pending approval. Derive all ranking metrics from trusted records.
CREATE OR REPLACE FUNCTION public.guard_provider_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := to_jsonb(OLD);
  v_rating_count integer := 0;
  v_completed integer := 0;
  v_avg_rating numeric(3,2) := 0;
  v_tier text := 'unranked';
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_admin_access(auth.uid()) THEN
    IF TG_OP = 'INSERT' THEN
      -- Every self-service provider starts unapproved and unavailable.
      NEW.status := 'pending';
      NEW.available := false;
      NEW.suspended_until := NULL;

      -- Never trust rating/achievement counters supplied by the client.
      SELECT COUNT(*)::integer, COALESCE(AVG(stars), 0)::numeric(3,2)
        INTO v_rating_count, v_avg_rating
      FROM public.ratings
      WHERE ratee_id = NEW.user_id;

      NEW.rating_avg := v_avg_rating;
      NEW.ratings_count := v_rating_count;

      IF TG_TABLE_NAME = 'driver_profiles' THEN
        SELECT COUNT(*)::integer
          INTO v_completed
        FROM public.service_requests
        WHERE provider_id = NEW.user_id
          AND type = 'taxi'
          AND status::text = 'completed';

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
        FROM public.service_requests
        WHERE provider_id = NEW.user_id
          AND type = 'service'
          AND status::text = 'completed';

        NEW.completed_jobs := v_completed;
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF TG_TABLE_NAME = 'driver_profiles'
           AND auth.uid() = OLD.user_id
           AND OLD.status = 'rejected'
           AND NEW.status = 'pending' THEN
          NULL; -- Allow a rejected driver to resubmit for review.
        ELSE
          RAISE EXCEPTION 'status_readonly';
        END IF;
      END IF;

      IF OLD.status = 'approved' THEN
        IF TG_TABLE_NAME = 'driver_profiles' AND (
          v_new->'vehicle_make' IS DISTINCT FROM v_old->'vehicle_make'
          OR v_new->'vehicle_model' IS DISTINCT FROM v_old->'vehicle_model'
          OR v_new->'vehicle_year' IS DISTINCT FROM v_old->'vehicle_year'
          OR v_new->'vehicle_category' IS DISTINCT FROM v_old->'vehicle_category'
          OR v_new->'vehicle_type' IS DISTINCT FROM v_old->'vehicle_type'
          OR v_new->'vehicle_plate' IS DISTINCT FROM v_old->'vehicle_plate'
          OR v_new->'vehicle_color' IS DISTINCT FROM v_old->'vehicle_color'
        ) THEN
          RAISE EXCEPTION 'approved_vehicle_changes_require_admin_review';
        END IF;

        IF TG_TABLE_NAME = 'worker_profiles'
           AND v_new->'level' IS DISTINCT FROM v_old->'level' THEN
          RAISE EXCEPTION 'approved_worker_level_change_requires_admin_review';
        END IF;
      END IF;

      IF NEW.rating_avg IS DISTINCT FROM OLD.rating_avg THEN
        RAISE EXCEPTION 'rating_readonly';
      END IF;

      IF NEW.status <> 'approved' AND NEW.available THEN
        NEW.available := false;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

-- Driver performance tiers are based on taxi rides, not service jobs.
CREATE OR REPLACE FUNCTION public.recalculate_driver_performance_tier(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_completed integer := 0;
  v_rating_count integer := 0;
  v_avg_rating numeric := 0;
  v_tier text := 'unranked';
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'unranked';
  END IF;

  SELECT COUNT(*)::integer
    INTO v_completed
  FROM public.service_requests
  WHERE provider_id = p_user_id
    AND type = 'taxi'
    AND status::text = 'completed';

  SELECT COUNT(*)::integer, COALESCE(AVG(stars), 0)
    INTO v_rating_count, v_avg_rating
  FROM public.ratings
  WHERE ratee_id = p_user_id;

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

  UPDATE public.driver_profiles
  SET performance_tier = v_tier,
      completed_rides = v_completed,
      rating_avg = v_avg_rating,
      ratings_count = v_rating_count,
      updated_at = now()
  WHERE user_id = p_user_id;

  RETURN v_tier;
END;
$$;


-- Backfill the derived counters from their authoritative sources. This also
-- repairs profiles created before ratings existed or before the correct role
-- profile was created. The migration runs as the database owner.
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  FOR v_user_id IN SELECT user_id FROM public.driver_profiles LOOP
    PERFORM public.recalculate_driver_performance_tier(v_user_id);
  END LOOP;
END
$$;

UPDATE public.worker_profiles wp
SET rating_avg = COALESCE((
      SELECT AVG(r.stars)::numeric(3,2)
      FROM public.ratings r
      WHERE r.ratee_id = wp.user_id
    ), 0),
    ratings_count = (
      SELECT COUNT(*)::integer
      FROM public.ratings r
      WHERE r.ratee_id = wp.user_id
    ),
    completed_jobs = (
      SELECT COUNT(*)::integer
      FROM public.service_requests s
      WHERE s.provider_id = wp.user_id
        AND s.type = 'service'
        AND s.status::text = 'completed'
    ),
    updated_at = now();
