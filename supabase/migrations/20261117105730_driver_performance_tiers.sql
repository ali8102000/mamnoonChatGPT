-- Separate the driver's performance rank from the vehicle/pricing category.
-- Vehicle category remains unchanged because pricing and dispatch still depend on it.
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS performance_tier text NOT NULL DEFAULT 'unranked'
  CHECK (performance_tier IN ('unranked', 'economy', 'premium', 'luxury'));

CREATE TABLE IF NOT EXISTS public.driver_performance_tier_rules (
  tier text PRIMARY KEY CHECK (tier IN ('economy', 'premium', 'luxury')),
  label_ar text NOT NULL,
  min_completed_rides integer NOT NULL DEFAULT 0 CHECK (min_completed_rides >= 0),
  min_ratings_count integer NOT NULL DEFAULT 0 CHECK (min_ratings_count >= 0),
  min_avg_rating numeric(3,2) NOT NULL DEFAULT 0 CHECK (min_avg_rating >= 0 AND min_avg_rating <= 5),
  priority integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO public.driver_performance_tier_rules
  (tier, label_ar, min_completed_rides, min_ratings_count, min_avg_rating, priority)
VALUES
  ('economy', 'اقتصادي', 5, 1, 3.50, 10),
  ('premium', 'متميز', 30, 10, 4.50, 20),
  ('luxury', 'فاخر', 100, 30, 4.80, 30)
ON CONFLICT (tier) DO NOTHING;

ALTER TABLE public.driver_performance_tier_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_performance_tier_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.driver_performance_tier_rules TO service_role;

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

REVOKE ALL ON FUNCTION public.recalculate_driver_performance_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_driver_performance_tier(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_driver_performance_tier_from_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.provider_id IS NOT NULL THEN
      PERFORM public.recalculate_driver_performance_tier(OLD.provider_id);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.provider_id IS DISTINCT FROM NEW.provider_id
     AND OLD.provider_id IS NOT NULL THEN
    PERFORM public.recalculate_driver_performance_tier(OLD.provider_id);
  END IF;

  IF NEW.provider_id IS NOT NULL THEN
    PERFORM public.recalculate_driver_performance_tier(NEW.provider_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_driver_performance_tier_from_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_driver_performance_tier(OLD.ratee_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.ratee_id IS DISTINCT FROM NEW.ratee_id THEN
    PERFORM public.recalculate_driver_performance_tier(OLD.ratee_id);
  END IF;

  PERFORM public.recalculate_driver_performance_tier(NEW.ratee_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_performance_tier_request_refresh ON public.service_requests;
CREATE TRIGGER driver_performance_tier_request_refresh
AFTER INSERT OR UPDATE OF provider_id, status OR DELETE
ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.refresh_driver_performance_tier_from_request();

DROP TRIGGER IF EXISTS driver_performance_tier_rating_refresh ON public.ratings;
CREATE TRIGGER driver_performance_tier_rating_refresh
AFTER INSERT OR UPDATE OF ratee_id, stars OR DELETE
ON public.ratings
FOR EACH ROW EXECUTE FUNCTION public.refresh_driver_performance_tier_from_rating();

CREATE OR REPLACE FUNCTION public.admin_list_driver_performance_tier_rules()
RETURNS TABLE (
  tier text,
  label_ar text,
  min_completed_rides integer,
  min_ratings_count integer,
  min_avg_rating numeric,
  priority integer,
  is_active boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_access(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT r.tier, r.label_ar, r.min_completed_rides, r.min_ratings_count,
         r.min_avg_rating, r.priority, r.is_active, r.updated_at
  FROM public.driver_performance_tier_rules r
  ORDER BY r.priority;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_driver_performance_tier_rule(
  p_tier text,
  p_min_completed_rides integer,
  p_min_ratings_count integer,
  p_min_avg_rating numeric,
  p_is_active boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_access(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_tier NOT IN ('economy', 'premium', 'luxury')
     OR p_min_completed_rides < 0
     OR p_min_ratings_count < 0
     OR p_min_avg_rating < 0 OR p_min_avg_rating > 5 THEN
    RAISE EXCEPTION 'invalid_rule';
  END IF;

  UPDATE public.driver_performance_tier_rules
  SET min_completed_rides = p_min_completed_rides,
      min_ratings_count = p_min_ratings_count,
      min_avg_rating = p_min_avg_rating,
      is_active = p_is_active,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE tier = p_tier;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rule_not_found';
  END IF;

  -- Recalculate every driver using real completed requests and ratings.
  PERFORM public.recalculate_driver_performance_tier(dp.user_id)
  FROM public.driver_profiles dp;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_driver_performance_tier_rules() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_driver_performance_tier_rule(text, integer, integer, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_driver_performance_tier_rules() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_driver_performance_tier_rule(text, integer, integer, numeric, boolean) TO authenticated;

-- Backfill ranks once from authoritative production rows when this migration is applied.
DO $$
DECLARE
  driver record;
BEGIN
  FOR driver IN SELECT user_id FROM public.driver_profiles LOOP
    PERFORM public.recalculate_driver_performance_tier(driver.user_id);
  END LOOP;
END;
$$;


-- Keep the existing reputation API shape, but source driver level from the
-- configurable performance_tier field instead of hard-coded rating thresholds.
CREATE OR REPLACE FUNCTION public.get_provider_reputation(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_avg numeric := 0;
  v_prof numeric := 0;
  v_punc numeric := 0;
  v_qual numeric := 0;
  v_cnt integer := 0;
  v_done integer := 0;
  v_score integer := 0;
  v_level text;
  v_name text;
  v_icon text;
  v_color text;
  v_badges jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(AVG(stars), 0),
         COALESCE(AVG(professionalism), 0),
         COALESCE(AVG(punctuality), 0),
         COALESCE(AVG(quality), 0),
         COUNT(*)::integer
    INTO v_avg, v_prof, v_punc, v_qual, v_cnt
  FROM public.ratings
  WHERE ratee_id = p_user_id;

  SELECT COUNT(*)::integer
    INTO v_done
  FROM public.service_requests
  WHERE provider_id = p_user_id
    AND status::text = 'completed';

  v_score := LEAST(1000, ROUND(v_avg * 100 + LEAST(v_done, 500))::integer);

  IF EXISTS (SELECT 1 FROM public.driver_profiles WHERE user_id = p_user_id) THEN
    SELECT performance_tier INTO v_level
    FROM public.driver_profiles
    WHERE user_id = p_user_id;

    CASE COALESCE(v_level, 'unranked')
      WHEN 'luxury' THEN v_name := 'فاخر'; v_icon := '👑'; v_color := '#A78BFA';
      WHEN 'premium' THEN v_name := 'متميز'; v_icon := '⭐'; v_color := '#0EA5E9';
      WHEN 'economy' THEN v_name := 'اقتصادي'; v_icon := '🚕'; v_color := '#10B981';
      ELSE v_level := 'unranked'; v_name := 'قيد التقييم'; v_icon := '🌱'; v_color := '#94A3B8';
    END CASE;
  ELSE
    IF v_done >= 200 AND v_avg >= 4.7 THEN
      v_level := 'diamond'; v_name := 'ماسي'; v_icon := '💎'; v_color := '#7DD3FC';
    ELSIF v_done >= 100 AND v_avg >= 4.5 THEN
      v_level := 'gold'; v_name := 'ذهبي'; v_icon := '🥇'; v_color := '#FFD700';
    ELSIF v_done >= 30 AND v_avg >= 4.0 THEN
      v_level := 'silver'; v_name := 'فضي'; v_icon := '🥈'; v_color := '#C0C0C0';
    ELSE
      v_level := 'bronze'; v_name := 'برونزي'; v_icon := '🥉'; v_color := '#CD7F32';
    END IF;
  END IF;

  IF v_cnt >= 10 AND v_avg >= 4.8 THEN
    v_badges := v_badges || jsonb_build_object('code','top_rated','name_ar','الأعلى تقييماً','icon','⭐','color','#F59E0B');
  END IF;
  IF v_cnt >= 5 AND v_punc >= 4.8 THEN
    v_badges := v_badges || jsonb_build_object('code','punctual','name_ar','دقيق بالمواعيد','icon','⏱️','color','#10B981');
  END IF;
  IF v_cnt >= 5 AND v_qual >= 4.8 THEN
    v_badges := v_badges || jsonb_build_object('code','quality','name_ar','جودة عالية','icon','🏆','color','#6366F1');
  END IF;
  IF v_done >= 100 THEN
    v_badges := v_badges || jsonb_build_object('code','veteran','name_ar','خبرة +100','icon','🎖️','color','#EF4444');
  END IF;

  RETURN jsonb_build_object(
    'score', v_score,
    'level', v_level,
    'level_name', v_name,
    'level_icon', v_icon,
    'level_color', v_color,
    'avg_stars', round(v_avg, 2),
    'professionalism_avg', round(v_prof, 2),
    'punctuality_avg', round(v_punc, 2),
    'quality_avg', round(v_qual, 2),
    'ratings_count', v_cnt,
    'completed_jobs', v_done,
    'badges', v_badges
  );
END;
$function$;
