-- Canonical server-side taxi quote used by auto-taxi-pricing.
-- Reads only admin-managed tariff/control rows and mirrors prepare_taxi_request().
-- This migration does not change any tariff values or existing requests.

CREATE OR REPLACE FUNCTION public.calculate_taxi_quote_internal(
  p_governorate_key text,
  p_is_intercity boolean,
  p_distance_km numeric,
  p_duration_min numeric,
  p_trip_type text,
  p_extra_minutes integer,
  p_urgency_enabled boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_governorate text := NULLIF(BTRIM(p_governorate_key), '');
  v_base_fare numeric;
  v_per_km_rate numeric;
  v_per_min_rate numeric;
  v_economy_raw numeric;
  v_min_economy numeric;
  v_min_premium numeric;
  v_min_luxury numeric;
  v_peak_enabled boolean := false;
  v_peak_percent numeric := 0;
  v_urgency_allowed boolean := false;
  v_urgency_cap numeric := 0;
  v_effective_peak numeric := 0;
  v_effective_urgency numeric := 0;
  v_extra_fare numeric;
  v_trip_multiplier numeric := 1;
  v_economy_tier numeric := 0;
  v_premium_tier numeric := 0;
  v_luxury_tier numeric := 0;
  v_economy_raw_total numeric;
  v_premium_raw_total numeric;
  v_luxury_raw_total numeric;
  v_category_prices jsonb;
  v_min_fares jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'هذه العملية متاحة لخدمة التسعير الآمنة فقط.';
  END IF;

  IF v_governorate IS NULL OR p_is_intercity IS NULL
     OR p_distance_km IS NULL OR p_distance_km <= 0
     OR p_duration_min IS NULL OR p_duration_min < 0
     OR p_trip_type NOT IN ('one_way', 'round_trip', 'second_trip', 'stop')
     OR p_extra_minutes IS NULL OR p_extra_minutes < 0
     OR p_extra_minutes > 120 OR p_extra_minutes % 5 <> 0 THEN
    RAISE EXCEPTION 'بيانات التسعير أو الطريق غير صالحة.';
  END IF;

  -- Match the same local-governorate-first, global-fallback rule used by
  -- prepare_taxi_request. The admin economy tariff is the fare basis.
  SELECT ps.base_fare, ps.per_km_rate, ps.per_min_rate
    INTO v_base_fare, v_per_km_rate, v_per_min_rate
    FROM public.pricing_settings ps
   WHERE ps.service_type = 'economy'
     AND ps.is_intercity = p_is_intercity
     AND ps.governorate_key = v_governorate;

  IF NOT FOUND AND v_governorate <> 'all' THEN
    SELECT ps.base_fare, ps.per_km_rate, ps.per_min_rate
      INTO v_base_fare, v_per_km_rate, v_per_min_rate
      FROM public.pricing_settings ps
     WHERE ps.service_type = 'economy'
       AND ps.is_intercity = p_is_intercity
       AND ps.governorate_key = 'all';
  END IF;

  IF v_base_fare IS NULL OR v_per_km_rate IS NULL OR v_per_min_rate IS NULL
     OR v_base_fare < 0 OR v_per_km_rate < 0 OR v_per_min_rate < 0 THEN
    RAISE EXCEPTION 'تعرفة الاقتصاد غير متوفرة أو غير صالحة لهذه المحافظة.';
  END IF;

  v_economy_raw := GREATEST(
    1000::numeric,
    v_base_fare + (p_distance_km * v_per_km_rate) + (p_duration_min * v_per_min_rate)
  );

  -- Each category minimum is independently controlled by the admin panel.
  SELECT ps.min_fare INTO v_min_economy
    FROM public.pricing_settings ps
   WHERE ps.service_type = 'economy'
     AND ps.is_intercity = p_is_intercity
     AND ps.governorate_key = v_governorate;
  IF NOT FOUND AND v_governorate <> 'all' THEN
    SELECT ps.min_fare INTO v_min_economy
      FROM public.pricing_settings ps
     WHERE ps.service_type = 'economy'
       AND ps.is_intercity = p_is_intercity
       AND ps.governorate_key = 'all';
  END IF;

  SELECT ps.min_fare INTO v_min_premium
    FROM public.pricing_settings ps
   WHERE ps.service_type = 'premium'
     AND ps.is_intercity = p_is_intercity
     AND ps.governorate_key = v_governorate;
  IF NOT FOUND AND v_governorate <> 'all' THEN
    SELECT ps.min_fare INTO v_min_premium
      FROM public.pricing_settings ps
     WHERE ps.service_type = 'premium'
       AND ps.is_intercity = p_is_intercity
       AND ps.governorate_key = 'all';
  END IF;

  SELECT ps.min_fare INTO v_min_luxury
    FROM public.pricing_settings ps
   WHERE ps.service_type = 'luxury'
     AND ps.is_intercity = p_is_intercity
     AND ps.governorate_key = v_governorate;
  IF NOT FOUND AND v_governorate <> 'all' THEN
    SELECT ps.min_fare INTO v_min_luxury
      FROM public.pricing_settings ps
     WHERE ps.service_type = 'luxury'
       AND ps.is_intercity = p_is_intercity
       AND ps.governorate_key = 'all';
  END IF;

  IF v_min_economy IS NULL OR v_min_premium IS NULL OR v_min_luxury IS NULL
     OR v_min_economy < 0 OR v_min_premium < 0 OR v_min_luxury < 0 THEN
    RAISE EXCEPTION 'الحد الأدنى لتعرفة إحدى فئات التاكسي غير متوفر أو غير صالح.';
  END IF;

  -- Peak controls: governorate override, then global. Urgency is global,
  -- matching the existing database insert trigger.
  SELECT c.peak_enabled, c.peak_percent
    INTO v_peak_enabled, v_peak_percent
    FROM public.taxi_pricing_controls c
   WHERE c.governorate_key = v_governorate;
  IF NOT FOUND AND v_governorate <> 'all' THEN
    SELECT c.peak_enabled, c.peak_percent
      INTO v_peak_enabled, v_peak_percent
      FROM public.taxi_pricing_controls c
     WHERE c.governorate_key = 'all';
  END IF;

  SELECT c.urgency_enabled, c.urgency_max_percent
    INTO v_urgency_allowed, v_urgency_cap
    FROM public.taxi_pricing_controls c
   WHERE c.governorate_key = 'all';

  v_effective_peak := CASE
    WHEN COALESCE(v_peak_enabled, false)
      THEN GREATEST(0, LEAST(200, COALESCE(v_peak_percent, 0)))
    ELSE 0
  END;
  v_effective_urgency := CASE
    WHEN COALESCE(p_urgency_enabled, false) AND COALESCE(v_urgency_allowed, false)
      THEN GREATEST(0, LEAST(100, COALESCE(v_urgency_cap, 0)))
    ELSE 0
  END;

  IF p_trip_type = 'round_trip' THEN
    v_trip_multiplier := 1.8;
  ELSIF p_trip_type = 'second_trip' THEN
    v_trip_multiplier := 2;
  END IF;

  v_extra_fare := CEIL(p_extra_minutes::numeric / 5) * 500;

  v_economy_tier := 0;
  v_premium_tier := CASE WHEN v_economy_raw < 10000 THEN 20
                         WHEN v_economy_raw <= 50000 THEN 15 ELSE 5 END;
  v_luxury_tier := CASE WHEN v_economy_raw < 10000 THEN 40
                        WHEN v_economy_raw <= 50000 THEN 25 ELSE 10 END;

  v_economy_raw_total := GREATEST(1000::numeric, v_economy_raw)
    * (1 + v_economy_tier / 100.0) * v_trip_multiplier + v_extra_fare;
  v_premium_raw_total := GREATEST(1000::numeric, v_economy_raw)
    * (1 + v_premium_tier / 100.0) * v_trip_multiplier + v_extra_fare;
  v_luxury_raw_total := GREATEST(1000::numeric, v_economy_raw)
    * (1 + v_luxury_tier / 100.0) * v_trip_multiplier + v_extra_fare;

  IF p_trip_type = 'round_trip' THEN
    v_economy_raw_total := GREATEST(1000::numeric, v_economy_raw)
      * (1 + v_economy_tier / 100.0) * 2 * 0.9 + v_extra_fare;
    v_premium_raw_total := GREATEST(1000::numeric, v_economy_raw)
      * (1 + v_premium_tier / 100.0) * 2 * 0.9 + v_extra_fare;
    v_luxury_raw_total := GREATEST(1000::numeric, v_economy_raw)
      * (1 + v_luxury_tier / 100.0) * 2 * 0.9 + v_extra_fare;
  END IF;

  v_economy_raw_total := v_economy_raw_total * (1 + v_effective_peak / 100.0)
    * (1 + v_effective_urgency / 100.0);
  v_premium_raw_total := v_premium_raw_total * (1 + v_effective_peak / 100.0)
    * (1 + v_effective_urgency / 100.0);
  v_luxury_raw_total := v_luxury_raw_total * (1 + v_effective_peak / 100.0)
    * (1 + v_effective_urgency / 100.0);

  v_min_fares := jsonb_build_object(
    'economy', v_min_economy,
    'premium', v_min_premium,
    'luxury', v_min_luxury
  );
  v_category_prices := jsonb_build_object(
    'economy', GREATEST(1000::numeric, v_min_economy, ROUND(v_economy_raw_total / 250) * 250),
    'premium', GREATEST(1000::numeric, v_min_premium, ROUND(v_premium_raw_total / 250) * 250),
    'luxury', GREATEST(1000::numeric, v_min_luxury, ROUND(v_luxury_raw_total / 250) * 250)
  );

  RETURN jsonb_build_object(
    'categoryPrices', v_category_prices,
    'minFares', v_min_fares,
    'economyRaw', v_economy_raw,
    'peakPercent', v_effective_peak,
    'urgencyPercent', v_effective_urgency,
    'urgencyAllowed', COALESCE(v_urgency_allowed, false) AND COALESCE(v_urgency_cap, 0) > 0,
    'urgencyEnabled', v_effective_urgency > 0
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_taxi_quote_internal(
  text, boolean, numeric, numeric, text, integer, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.calculate_taxi_quote_internal(
  text, boolean, numeric, numeric, text, integer, boolean
) TO service_role;
