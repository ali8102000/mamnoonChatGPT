
-- Regional pricing markup and automatic monitoring controls.
ALTER TABLE public.regional_service_controls
  ADD COLUMN IF NOT EXISTS regional_surcharge_percent numeric(6,2)
  CHECK (regional_surcharge_percent BETWEEN 0 AND 200);

-- Keep automatic monitoring settings separate from manual peak overrides.
-- This prevents default auto rows from shadowing a governorate's inherited manual peak.
CREATE TABLE IF NOT EXISTS public.taxi_pricing_auto_controls (
  governorate_key text PRIMARY KEY CHECK (governorate_key IN
    ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')),
  auto_monitor_enabled boolean NOT NULL DEFAULT false,
  traffic_surcharge_cap_percent numeric(6,2) NOT NULL DEFAULT 0 CHECK (traffic_surcharge_cap_percent BETWEEN 0 AND 200),
  demand_increase_cap_percent numeric(6,2) NOT NULL DEFAULT 0 CHECK (demand_increase_cap_percent BETWEEN 0 AND 100),
  demand_discount_cap_percent numeric(6,2) NOT NULL DEFAULT 0 CHECK (demand_discount_cap_percent BETWEEN 0 AND 50),
  auto_demand_percent numeric(6,2) NOT NULL DEFAULT 0 CHECK (auto_demand_percent BETWEEN -50 AND 100),
  auto_active_drivers integer NOT NULL DEFAULT 0,
  auto_gps_observed integer NOT NULL DEFAULT 0,
  auto_pending_requests integer NOT NULL DEFAULT 0,
  auto_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.taxi_pricing_auto_controls ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.taxi_pricing_auto_controls TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.taxi_pricing_auto_controls TO service_role;
REVOKE INSERT,UPDATE,DELETE ON public.taxi_pricing_auto_controls FROM anon,authenticated;
DROP POLICY IF EXISTS "Authenticated users read automatic taxi pricing state" ON public.taxi_pricing_auto_controls;
CREATE POLICY "Authenticated users read automatic taxi pricing state"
  ON public.taxi_pricing_auto_controls FOR SELECT TO authenticated USING (true);

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS taxi_auto_percent numeric(6,2) NOT NULL DEFAULT 0
    CHECK (taxi_auto_percent BETWEEN -50 AND 200);

-- Store GPS quality alongside provider presence; stale or low-accuracy points
-- are excluded from the automatic supply/demand monitor.
ALTER TABLE public.provider_presence
  ADD COLUMN IF NOT EXISTS accuracy_m double precision
    CHECK (accuracy_m IS NULL OR accuracy_m BETWEEN 0 AND 1000),
  ADD COLUMN IF NOT EXISTS speed_mps double precision
    CHECK (speed_mps IS NULL OR speed_mps BETWEEN 0 AND 150);

CREATE OR REPLACE FUNCTION public.refresh_taxi_pricing_monitor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $monitor$
DECLARE
  v_key text;
  v_drivers integer;
  v_observed integer;
  v_waiting integer;
  v_ratio numeric;
  v_raw_percent numeric;
  v_enabled boolean;
  v_increase_cap numeric;
  v_discount_cap numeric;
BEGIN
  -- Only rows explicitly configured by an administrator are updated.
  -- This preserves global fallback for governorates without local overrides.

  FOR v_key IN
    SELECT governorate_key FROM public.governorate_boundaries
    UNION ALL SELECT 'all'
  LOOP
    IF v_key = 'all' THEN
      SELECT count(DISTINCT pp.user_id)::integer INTO v_observed
      FROM public.provider_presence pp
      JOIN public.driver_profiles dp ON dp.user_id=pp.user_id
      WHERE pp.updated_at > now()-interval '5 minutes'
        AND pp.accuracy_m IS NOT NULL AND pp.accuracy_m<=100
        AND dp.status='approved' AND dp.vehicle_category::text <> 'large'
        AND (dp.suspended_until IS NULL OR dp.suspended_until<=now());

      SELECT count(DISTINCT pp.user_id)::integer INTO v_drivers
      FROM public.provider_presence pp
      JOIN public.driver_profiles dp ON dp.user_id=pp.user_id
      WHERE pp.updated_at > now()-interval '5 minutes'
        AND pp.accuracy_m IS NOT NULL AND pp.accuracy_m<=100
        AND dp.available=true AND dp.status='approved' AND dp.vehicle_category::text <> 'large'
        AND (dp.suspended_until IS NULL OR dp.suspended_until<=now())
        AND NOT EXISTS (
          SELECT 1 FROM public.service_requests ar
          WHERE ar.provider_id=dp.user_id AND ar.status IN ('accepted','in_progress')
        );

      SELECT count(*)::integer INTO v_waiting
      FROM public.service_requests sr
      WHERE sr.type::text='taxi' AND coalesce(sr.vehicle_category::text,'') <> 'large'
        AND sr.status IN ('pending','searching') AND sr.provider_id IS NULL
        AND sr.created_at>now()-interval '15 minutes'
        AND sr.pickup_lat IS NOT NULL AND sr.pickup_lng IS NOT NULL;
    ELSE
      SELECT count(DISTINCT pp.user_id)::integer INTO v_observed
      FROM public.provider_presence pp
      JOIN public.driver_profiles dp ON dp.user_id=pp.user_id
      JOIN public.governorate_boundaries g ON g.governorate_key=v_key
      WHERE pp.updated_at > now()-interval '5 minutes'
        AND pp.accuracy_m IS NOT NULL AND pp.accuracy_m<=100
        AND dp.status='approved' AND dp.vehicle_category::text <> 'large'
        AND (dp.suspended_until IS NULL OR dp.suspended_until<=now())
        AND extensions.st_covers(g.boundary,
          extensions.st_setsrid(extensions.st_makepoint(pp.lng,pp.lat),4326));

      SELECT count(DISTINCT pp.user_id)::integer INTO v_drivers
      FROM public.provider_presence pp
      JOIN public.driver_profiles dp ON dp.user_id=pp.user_id
      JOIN public.governorate_boundaries g ON g.governorate_key=v_key
      WHERE pp.updated_at > now()-interval '5 minutes'
        AND pp.accuracy_m IS NOT NULL AND pp.accuracy_m<=100
        AND dp.available=true AND dp.status='approved' AND dp.vehicle_category::text <> 'large'
        AND (dp.suspended_until IS NULL OR dp.suspended_until<=now())
        AND extensions.st_covers(g.boundary,
          extensions.st_setsrid(extensions.st_makepoint(pp.lng,pp.lat),4326))
        AND NOT EXISTS (
          SELECT 1 FROM public.service_requests ar
          WHERE ar.provider_id=dp.user_id AND ar.status IN ('accepted','in_progress')
        );

      SELECT count(*)::integer INTO v_waiting
      FROM public.service_requests sr
      JOIN public.governorate_boundaries g ON g.governorate_key=v_key
      WHERE sr.type::text='taxi' AND coalesce(sr.vehicle_category::text,'') <> 'large'
        AND sr.status IN ('pending','searching') AND sr.provider_id IS NULL
        AND sr.created_at>now()-interval '15 minutes'
        AND sr.pickup_lat IS NOT NULL AND sr.pickup_lng IS NOT NULL
        AND extensions.st_covers(g.boundary,
          extensions.st_setsrid(extensions.st_makepoint(sr.pickup_lng::double precision,sr.pickup_lat::double precision),4326));
    END IF;

    SELECT auto_monitor_enabled,demand_increase_cap_percent,demand_discount_cap_percent
      INTO v_enabled,v_increase_cap,v_discount_cap
    FROM public.taxi_pricing_auto_controls WHERE governorate_key=v_key;

    IF NOT COALESCE(v_enabled,false) THEN CONTINUE; END IF;

    v_ratio := v_drivers::numeric / greatest(v_waiting,1);
    v_raw_percent := CASE
      WHEN COALESCE(v_observed,0)=0 THEN 0
      WHEN COALESCE(v_waiting,0)=0 AND COALESCE(v_drivers,0)>0 THEN -10
      WHEN COALESCE(v_waiting,0)=0 THEN 0
      WHEN v_ratio >= 3 THEN -20
      WHEN v_ratio >= 2 THEN -10
      WHEN v_ratio >= 1.25 THEN 0
      WHEN v_ratio >= 0.75 THEN 10
      WHEN v_ratio >= 0.50 THEN 25
      WHEN v_ratio >= 0.25 THEN 40
      ELSE 50
    END;

    UPDATE public.taxi_pricing_auto_controls
    SET auto_active_drivers=coalesce(v_drivers,0),
        auto_gps_observed=coalesce(v_observed,0),
        auto_pending_requests=coalesce(v_waiting,0),
        auto_demand_percent=CASE WHEN COALESCE(v_enabled,false)
          THEN greatest(-least(coalesce(v_discount_cap,0),50),
                 least(coalesce(v_increase_cap,0),v_raw_percent))
          ELSE 0 END,
        auto_updated_at=now(),
        updated_at=now()
    WHERE governorate_key=v_key;
  END LOOP;
END;
$monitor$;

REVOKE ALL ON FUNCTION public.refresh_taxi_pricing_monitor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_taxi_pricing_monitor() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_taxi_auto_monitor_settings(
  p_governorate_key text,
  p_enabled boolean,
  p_traffic_cap numeric,
  p_demand_increase_cap numeric,
  p_demand_discount_cap numeric
)
RETURNS public.taxi_pricing_auto_controls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $admin$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.taxi_pricing_auto_controls%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_governorate_key NOT IN ('all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah') THEN
    RAISE EXCEPTION 'invalid_governorate';
  END IF;
  IF p_traffic_cap IS NULL OR p_traffic_cap NOT BETWEEN 0 AND 200
     OR p_demand_increase_cap IS NULL OR p_demand_increase_cap NOT BETWEEN 0 AND 100
     OR p_demand_discount_cap IS NULL OR p_demand_discount_cap NOT BETWEEN 0 AND 50 THEN
    RAISE EXCEPTION 'invalid_automatic_pricing_limits';
  END IF;
  IF NOT public.admin_has_permission('pricing.peak.edit',
    CASE WHEN p_governorate_key='all' THEN 'global' ELSE 'governorate' END,
    CASE WHEN p_governorate_key='all' THEN NULL ELSE p_governorate_key END) THEN
    RAISE EXCEPTION 'missing_pricing_permission';
  END IF;

  INSERT INTO public.taxi_pricing_auto_controls(
    governorate_key,auto_monitor_enabled,traffic_surcharge_cap_percent,demand_increase_cap_percent,demand_discount_cap_percent
  )
  VALUES(p_governorate_key,p_enabled,p_traffic_cap,p_demand_increase_cap,p_demand_discount_cap)
  ON CONFLICT(governorate_key) DO UPDATE SET
    auto_monitor_enabled=excluded.auto_monitor_enabled,
    traffic_surcharge_cap_percent=excluded.traffic_surcharge_cap_percent,
    demand_increase_cap_percent=excluded.demand_increase_cap_percent,
    demand_discount_cap_percent=excluded.demand_discount_cap_percent,
    auto_demand_percent=CASE WHEN excluded.auto_monitor_enabled THEN taxi_pricing_auto_controls.auto_demand_percent ELSE 0 END,
    auto_updated_at=now(),
    updated_at=now()
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,target_type,target_id,details)
  VALUES(v_actor,'pricing.taxi.auto_monitor.updated','taxi_pricing_auto_controls',p_governorate_key,to_jsonb(v_row));
  RETURN v_row;
END;
$admin$;

REVOKE ALL ON FUNCTION public.admin_update_taxi_auto_monitor_settings(text,boolean,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_update_taxi_auto_monitor_settings(text,boolean,numeric,numeric,numeric) TO authenticated;

DO $cron$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname='mamnoon-taxi-pricing-monitor' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule('mamnoon-taxi-pricing-monitor','* * * * *','SELECT public.refresh_taxi_pricing_monitor();');
END;
$cron$;

-- One canonical database-owned taxi quote calculator for previews and request inserts.
-- Only the trusted Edge Function service role may call the quote RPC directly.
CREATE OR REPLACE FUNCTION public.calculate_taxi_quote_internal(
  p_governorate_key text,
  p_is_intercity boolean,
  p_distance_km numeric,
  p_duration_min numeric,
  p_trip_type text,
  p_extra_minutes integer,
  p_urgency_enabled boolean,
  p_auto_percent numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_economy public.pricing_settings%ROWTYPE;
  v_min_fare numeric;
  v_peak_enabled boolean := false;
  v_peak_percent numeric := 0;
  v_regional_percent numeric := 0;
  v_auto_percent numeric := 0;
  v_auto_enabled boolean := false;
  v_urgency_enabled boolean := false;
  v_urgency_cap numeric := 0;
  v_urgency_percent numeric := 0;
  v_economy_raw numeric;
  v_base numeric;
  v_tier_percent numeric;
  v_tier_multiplier numeric;
  v_trip_multiplier numeric;
  v_extra_fare numeric;
  v_raw numeric;
  v_price numeric;
  v_category text;
  v_prices jsonb := '{}'::jsonb;
  v_min_fares jsonb := '{}'::jsonb;
  v_governorates text[] := ARRAY[
    'baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala',
    'babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah'
  ];
BEGIN
  IF p_governorate_key IS NULL OR NOT (p_governorate_key = ANY(v_governorates)) THEN
    RAISE EXCEPTION 'invalid_taxi_governorate';
  END IF;
  IF p_is_intercity IS NULL THEN RAISE EXCEPTION 'invalid_intercity_flag'; END IF;
  IF p_auto_percent IS NULL OR p_auto_percent::text IN ('NaN','Infinity','-Infinity') OR p_auto_percent < -50 OR p_auto_percent > 200 THEN
    RAISE EXCEPTION 'invalid_auto_pricing_percent';
  END IF;
  IF p_distance_km IS NULL OR p_distance_km::text IN ('NaN','Infinity','-Infinity') OR p_distance_km <= 0
     OR p_duration_min IS NULL OR p_duration_min::text IN ('NaN','Infinity','-Infinity') OR p_duration_min <= 0 THEN
    RAISE EXCEPTION 'invalid_route_measurements';
  END IF;
  IF p_trip_type IS NULL OR p_trip_type NOT IN ('one_way','round_trip','second_trip','stop') THEN
    RAISE EXCEPTION 'invalid_trip_type';
  END IF;
  IF p_extra_minutes IS NULL OR p_extra_minutes < 0 OR p_extra_minutes > 120 OR p_extra_minutes % 5 <> 0 THEN
    RAISE EXCEPTION 'invalid_extra_minutes';
  END IF;

  SELECT * INTO v_economy
  FROM public.pricing_settings
  WHERE service_type = 'economy'
    AND is_intercity = p_is_intercity
    AND governorate_key = p_governorate_key;
  IF NOT FOUND THEN
    SELECT * INTO v_economy
    FROM public.pricing_settings
    WHERE service_type = 'economy'
      AND is_intercity = p_is_intercity
      AND governorate_key = 'all';
  END IF;
  IF NOT FOUND OR v_economy.base_fare < 0 OR v_economy.per_km_rate < 0 OR v_economy.per_min_rate < 0 THEN
    RAISE EXCEPTION 'economy_tariff_unavailable_or_invalid';
  END IF;

  v_economy_raw := v_economy.base_fare + (p_distance_km * v_economy.per_km_rate)
    + (p_duration_min * v_economy.per_min_rate);
  IF v_economy_raw::text IN ('NaN','Infinity','-Infinity') OR v_economy_raw < 0 THEN
    RAISE EXCEPTION 'invalid_economy_calculation';
  END IF;
  v_base := greatest(1000::numeric, v_economy_raw);

  SELECT peak_enabled, peak_percent INTO v_peak_enabled, v_peak_percent
  FROM public.taxi_pricing_controls
  WHERE governorate_key = p_governorate_key;
  IF NOT FOUND THEN
    SELECT peak_enabled, peak_percent INTO v_peak_enabled, v_peak_percent
    FROM public.taxi_pricing_controls WHERE governorate_key = 'all';
  END IF;
  v_peak_percent := CASE WHEN COALESCE(v_peak_enabled,false)
    THEN greatest(0,least(200,COALESCE(v_peak_percent,0))) ELSE 0 END;

  SELECT regional_surcharge_percent
    INTO v_regional_percent
  FROM public.regional_service_controls
  WHERE governorate_key = p_governorate_key;
  IF NOT FOUND OR v_regional_percent IS NULL THEN
    SELECT COALESCE(regional_surcharge_percent,0)
      INTO v_regional_percent
    FROM public.regional_service_controls
    WHERE governorate_key = 'all';
  END IF;
  v_regional_percent := greatest(0,least(200,COALESCE(v_regional_percent,0)));

  SELECT COALESCE(auto_monitor_enabled,false)
    INTO v_auto_enabled
  FROM public.taxi_pricing_auto_controls
  WHERE governorate_key = p_governorate_key;
  IF NOT FOUND THEN
    SELECT COALESCE(auto_monitor_enabled,false)
      INTO v_auto_enabled
    FROM public.taxi_pricing_auto_controls
    WHERE governorate_key = 'all';
  END IF;
  v_auto_percent := CASE WHEN COALESCE(v_auto_enabled,false)
    THEN greatest(-50,least(200,p_auto_percent)) ELSE 0 END;

  SELECT urgency_enabled, urgency_max_percent INTO v_urgency_enabled, v_urgency_cap
  FROM public.taxi_pricing_controls WHERE governorate_key = 'all';
  v_urgency_percent := CASE
    WHEN COALESCE(p_urgency_enabled,false) AND COALESCE(v_urgency_enabled,false)
      THEN greatest(0,least(100,COALESCE(v_urgency_cap,0)))
    ELSE 0
  END;

  v_trip_multiplier := CASE
    WHEN p_trip_type = 'round_trip' THEN 1.8
    WHEN p_trip_type = 'second_trip' THEN 2
    ELSE 1
  END;
  v_extra_fare := ceil(p_extra_minutes::numeric / 5) * 500;

  FOREACH v_category IN ARRAY ARRAY['economy','premium','luxury'] LOOP
    SELECT min_fare INTO v_min_fare
    FROM public.pricing_settings
    WHERE service_type = v_category
      AND is_intercity = p_is_intercity
      AND governorate_key = p_governorate_key;
    IF NOT FOUND THEN
      SELECT min_fare INTO v_min_fare
      FROM public.pricing_settings
      WHERE service_type = v_category
        AND is_intercity = p_is_intercity
        AND governorate_key = 'all';
    END IF;
    IF v_min_fare IS NULL OR v_min_fare < 0 THEN
      RAISE EXCEPTION 'category_minimum_tariff_unavailable: %', v_category;
    END IF;

    v_tier_percent := CASE
      WHEN v_category = 'economy' THEN 0
      WHEN v_category = 'premium' THEN
        CASE WHEN v_economy_raw < 10000 THEN 20 WHEN v_economy_raw <= 50000 THEN 15 ELSE 5 END
      ELSE
        CASE WHEN v_economy_raw < 10000 THEN 40 WHEN v_economy_raw <= 50000 THEN 25 ELSE 10 END
    END;
    v_tier_multiplier := 1 + (v_tier_percent / 100.0);
    v_raw := v_base * v_tier_multiplier * v_trip_multiplier + v_extra_fare;
    IF p_trip_type = 'round_trip' THEN
      v_raw := v_base * v_tier_multiplier * 2 * 0.9 + v_extra_fare;
    END IF;
    v_raw := v_raw * (1 + (v_peak_percent + v_regional_percent + v_auto_percent) / 100.0);
    v_raw := v_raw * (1 + v_urgency_percent / 100.0);
    v_price := greatest(1000::numeric, v_min_fare, round(v_raw / 250) * 250);
    IF v_price::text IN ('NaN','Infinity','-Infinity') OR v_price < 1000 THEN
      RAISE EXCEPTION 'invalid_final_taxi_fare: %', v_category;
    END IF;
    v_prices := v_prices || jsonb_build_object(v_category, v_price);
    v_min_fares := v_min_fares || jsonb_build_object(v_category, v_min_fare);
  END LOOP;

  RETURN jsonb_build_object(
    'economyRaw',v_economy_raw,
    'categoryPrices',v_prices,
    'minFares',v_min_fares,
    'peakPercent',v_peak_percent,
    'regionalPercent',v_regional_percent,
    'autoPercent',v_auto_percent,
    'effectivePeakPercent',v_peak_percent + v_regional_percent + v_auto_percent,
    'urgencyEnabled',v_urgency_percent > 0,
    'urgencyAllowed',COALESCE(v_urgency_enabled,false) AND COALESCE(v_urgency_cap,0) > 0,
    'urgencyPercent',v_urgency_percent
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_taxi_quote_internal(text,boolean,numeric,numeric,text,integer,boolean,numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_taxi_quote_internal(text,boolean,numeric,numeric,text,integer,boolean,numeric)
  TO service_role;

-- The insert trigger recalculates with the same canonical DB function, so
-- client values and preview calculations can never override the stored fare.
CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_pickup_governorate text;
  v_destination_governorate text;
  v_quote jsonb;
  v_final_price numeric;
BEGIN
  IF NEW.type::text <> 'taxi' THEN RETURN NEW; END IF;
  NEW.trip_type := COALESCE(NEW.trip_type,'one_way');
  NEW.extra_minutes := COALESCE(NEW.extra_minutes,0);

  IF NEW.trip_type NOT IN ('one_way','round_trip','second_trip','stop') THEN
    RAISE EXCEPTION 'نوع الرحلة غير صالح';
  END IF;
  IF NEW.extra_minutes < 0 OR NEW.extra_minutes > 120 OR NEW.extra_minutes % 5 <> 0 THEN
    RAISE EXCEPTION 'وقت الانتظار يجب أن يكون من 0 إلى 120 دقيقة وبفواصل 5 دقائق';
  END IF;

  IF NEW.vehicle_category::text = 'large' THEN
    NEW.vehicle_type := COALESCE(NEW.vehicle_type,
      CASE WHEN COALESCE(NEW.notes,'') ILIKE '%كيا ركاب%' THEN 'kia_passenger' ELSE 'kia_cargo' END);
    IF NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL THEN
      RAISE EXCEPTION 'نقطة الانطلاق مطلوبة';
    END IF;
    NEW.distance_km := NULL;
    NEW.duration_min := NULL;
    NEW.price_estimate := NULL;
    NEW.commission := 0;
    NEW.status := 'searching';
    NEW.searching_started_at := now();
    NEW.pricing_mode := CASE WHEN NEW.customer_price IS NOT NULL THEN 'fixed' ELSE 'negotiable' END;
    NEW.taxi_urgency_enabled := false;
    NEW.taxi_urgency_percent := 0;
    NEW.taxi_peak_percent := 0;
    NEW.taxi_auto_percent := 0;
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'أنشئ طلب التاكسي من خدمة التسعير الآمنة';
  END IF;
  IF NEW.vehicle_category IS NULL OR NEW.distance_km IS NULL OR NEW.distance_km <= 0
     OR NEW.duration_min IS NULL OR NEW.duration_min <= 0
     OR NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL
     OR NEW.dest_lat IS NULL OR NEW.dest_lng IS NULL THEN
    RAISE EXCEPTION 'بيانات الطريق غير مكتملة';
  END IF;

  v_pickup_governorate := public.infer_governorate_key(NEW.pickup_lat,NEW.pickup_lng);
  v_destination_governorate := public.infer_governorate_key(NEW.dest_lat,NEW.dest_lng);
  IF v_pickup_governorate IS NULL OR v_destination_governorate IS NULL THEN
    RAISE EXCEPTION 'تعذّر التحقق من محافظتي الرحلة';
  END IF;
  IF NEW.governorate_key IS DISTINCT FROM v_pickup_governorate THEN
    RAISE EXCEPTION 'محافظة الانطلاق لا تطابق الإحداثيات';
  END IF;
  IF COALESCE(NEW.is_intercity,false) IS DISTINCT FROM (v_pickup_governorate <> v_destination_governorate) THEN
    RAISE EXCEPTION 'نوع الرحلة بين المحافظات لا يطابق الإحداثيات';
  END IF;

  v_quote := public.calculate_taxi_quote_internal(
    v_pickup_governorate,
    v_pickup_governorate <> v_destination_governorate,
    NEW.distance_km,
    NEW.duration_min,
    NEW.trip_type,
    NEW.extra_minutes,
    COALESCE(NEW.taxi_urgency_enabled,false),
    COALESCE(NEW.taxi_auto_percent,0)
  );
  v_final_price := (v_quote->'categoryPrices'->>NEW.vehicle_category::text)::numeric;
  IF v_final_price IS NULL OR v_final_price < 1000 THEN
    RAISE EXCEPTION 'تعذّر اعتماد السعر النهائي للرحلة';
  END IF;

  -- If the admin tariff changed after the quote was shown, reject this insert.
  -- Never silently save a different fare from the one the customer confirmed.
  IF NEW.price_estimate IS NULL OR NEW.price_estimate IS DISTINCT FROM v_final_price THEN
    RAISE EXCEPTION 'تغيّرت تعرفة الإدارة بعد عرض السعر. أعد احتساب السعر قبل إرسال الطلب.';
  END IF;

  NEW.price_estimate := v_final_price;
  NEW.taxi_peak_percent := COALESCE((v_quote->>'peakPercent')::numeric,0);
  NEW.taxi_auto_percent := COALESCE((v_quote->>'autoPercent')::numeric,0);
  NEW.taxi_urgency_percent := COALESCE((v_quote->>'urgencyPercent')::numeric,0);
  NEW.taxi_urgency_enabled := COALESCE((v_quote->>'urgencyEnabled')::boolean,false);
  NEW.vehicle_type := NULL;
  NEW.commission := 0;
  NEW.status := 'searching';
  NEW.searching_started_at := now();
  RETURN NEW;
END;
$function$;

-- Use the exact same server-side gate while returning the requested customer-facing notice.
CREATE OR REPLACE FUNCTION public.guard_regional_service_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_detected_governorate text;
BEGIN
  IF public.is_platform_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='سنصل إليك قريباً. حدّد موقعك حتى نتحقق من توفر الخدمة في مدينتك.';
  END IF;
  v_detected_governorate := public.infer_governorate_key(NEW.pickup_lat,NEW.pickup_lng);
  IF v_detected_governorate IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='سنصل إليك قريباً. لم نتمكن من تحديد مدينتك بدقة.';
  END IF;
  NEW.governorate_key := v_detected_governorate;
  IF NEW.governorate_key IS NULL OR length(trim(NEW.governorate_key))=0 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='سنصل إليك قريباً. تعذّر تحديد مدينتك بدقة.';
  END IF;
  IF NOT public.regional_services_enabled(NEW.governorate_key) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='سنصل إليك قريباً. الخدمة غير متوفرة حالياً في مدينتك.';
  END IF;
  RETURN NEW;
END;
$function$;

DO $realtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='taxi_pricing_auto_controls') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.taxi_pricing_auto_controls;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='pricing_settings') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.pricing_settings;
    END IF;
  END IF;
END;
$realtime$;
