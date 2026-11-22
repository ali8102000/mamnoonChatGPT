-- One canonical database-owned taxi quote calculator for previews and request inserts.
-- Only the trusted Edge Function service role may call the quote RPC directly.
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
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_economy public.pricing_settings%ROWTYPE;
  v_min_fare numeric;
  v_peak_enabled boolean := false;
  v_peak_percent numeric := 0;
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
  IF NOT FOUND OR v_economy.base_fare < 0 OR v_economy.per_km_rate <= 0 OR v_economy.per_min_rate < 0 THEN
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
    v_raw := v_raw * (1 + v_peak_percent / 100.0);
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
    'urgencyEnabled',v_urgency_percent > 0,
    'urgencyAllowed',COALESCE(v_urgency_enabled,false) AND COALESCE(v_urgency_cap,0) > 0,
    'urgencyPercent',v_urgency_percent
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_taxi_quote_internal(text,boolean,numeric,numeric,text,integer,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_taxi_quote_internal(text,boolean,numeric,numeric,text,integer,boolean)
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
    COALESCE(NEW.taxi_urgency_enabled,false)
  );
  v_final_price := (v_quote->'categoryPrices'->>NEW.vehicle_category::text)::numeric;
  IF v_final_price IS NULL OR v_final_price < 1000 THEN
    RAISE EXCEPTION 'تعذّر اعتماد السعر النهائي للرحلة';
  END IF;

  NEW.price_estimate := v_final_price;
  NEW.taxi_peak_percent := COALESCE((v_quote->>'peakPercent')::numeric,0);
  NEW.taxi_urgency_percent := COALESCE((v_quote->>'urgencyPercent')::numeric,0);
  NEW.taxi_urgency_enabled := COALESCE((v_quote->>'urgencyEnabled')::boolean,false);
  NEW.vehicle_type := NULL;
  NEW.commission := 0;
  NEW.status := 'searching';
  NEW.searching_started_at := now();
  RETURN NEW;
END;
$function$;
