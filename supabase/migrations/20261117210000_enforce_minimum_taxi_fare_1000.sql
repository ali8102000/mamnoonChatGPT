-- Enforce a 1,000 IQD floor for ordinary auto-priced taxi rides.
-- The floor is a minimum, never an extra charge on top of a fare above 1,000.
-- When raw economy fare is below 1,000, premium/luxury percentages use 1,000.
CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
  v_base_fare numeric;
  v_per_min_rate numeric;
  v_min_fare numeric;
  v_base numeric;
  v_raw numeric;
  v_tier_percent numeric := 0;
  v_peak_enabled boolean := false;
  v_peak_percent numeric := 0;
  v_urgency_enabled boolean := false;
  v_urgency_cap numeric := 0;
  v_tier_multiplier numeric := 1;
  v_trip_multiplier numeric := 1;
  v_extra_time_fare numeric := 0;
  v_governorate text;
BEGIN
  IF NEW.type <> 'taxi' THEN RETURN NEW; END IF;

  NEW.trip_type := COALESCE(NEW.trip_type, 'one_way');
  NEW.extra_minutes := COALESCE(NEW.extra_minutes, 0);
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

  NEW.vehicle_type := NULL;
  IF NEW.distance_km IS NULL OR NEW.distance_km <= 0 OR NEW.duration_min IS NULL
     OR NEW.duration_min < 0 OR NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL
     OR NEW.dest_lat IS NULL OR NEW.dest_lng IS NULL THEN
    RAISE EXCEPTION 'بيانات الطريق غير مكتملة';
  END IF;

  SELECT base_fare, per_km_rate INTO v_base_fare, v_rate
    FROM public.pricing_settings
    WHERE service_type = 'economy'
      AND is_intercity = COALESCE(NEW.is_intercity,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'تعريفة الاقتصاد غير متوفرة'; END IF;
  SELECT per_min_rate INTO v_per_min_rate
    FROM public.pricing_settings
    WHERE service_type = 'economy'
      AND is_intercity = COALESCE(NEW.is_intercity,false);
  v_base := GREATEST(1000::numeric, v_base_fare + (NEW.distance_km * v_rate) + (NEW.duration_min * v_per_min_rate));

  IF NEW.vehicle_category::text = 'premium' THEN
    v_tier_percent := CASE WHEN v_base < 10000 THEN 20 WHEN v_base <= 50000 THEN 15 ELSE 5 END;
  ELSIF NEW.vehicle_category::text = 'luxury' THEN
    v_tier_percent := CASE WHEN v_base < 10000 THEN 40 WHEN v_base <= 50000 THEN 25 ELSE 10 END;
  END IF;

  v_governorate := COALESCE(NEW.governorate_key, 'all');
  SELECT peak_enabled, peak_percent INTO v_peak_enabled, v_peak_percent
    FROM public.taxi_pricing_controls WHERE governorate_key = v_governorate;
  IF NOT FOUND THEN
    SELECT peak_enabled, peak_percent INTO v_peak_enabled, v_peak_percent
      FROM public.taxi_pricing_controls WHERE governorate_key = 'all';
  END IF;
  SELECT urgency_enabled, urgency_max_percent INTO v_urgency_enabled, v_urgency_cap
    FROM public.taxi_pricing_controls WHERE governorate_key = 'all';

  IF NEW.trip_type IN ('round_trip','second_trip') THEN
    v_trip_multiplier := CASE WHEN NEW.trip_type = 'round_trip' THEN 1.8 ELSE 2 END;
  END IF;
  v_extra_time_fare := ceil(NEW.extra_minutes::numeric / 5) * 500;
  v_tier_multiplier := 1 + (v_tier_percent / 100.0);
  v_raw := v_base * v_tier_multiplier * v_trip_multiplier + v_extra_time_fare;
  IF NEW.trip_type = 'round_trip' THEN
    v_raw := v_base * v_tier_multiplier * 2 * 0.9 + v_extra_time_fare;
  END IF;

  IF COALESCE(v_peak_enabled,false) THEN
    v_raw := v_raw * (1 + greatest(0,least(200,COALESCE(v_peak_percent,0))) / 100.0);
    NEW.taxi_peak_percent := greatest(0,least(200,COALESCE(v_peak_percent,0)));
  ELSE
    NEW.taxi_peak_percent := 0;
  END IF;
  IF COALESCE(NEW.taxi_urgency_enabled,false) AND COALESCE(v_urgency_enabled,false) THEN
    NEW.taxi_urgency_percent := greatest(0,least(COALESCE(v_urgency_cap,0),100));
    v_raw := v_raw * (1 + NEW.taxi_urgency_percent / 100.0);
    NEW.taxi_urgency_enabled := NEW.taxi_urgency_percent > 0;
  ELSE
    NEW.taxi_urgency_enabled := false;
    NEW.taxi_urgency_percent := 0;
  END IF;

  SELECT min_fare INTO v_min_fare
    FROM public.pricing_settings
    WHERE service_type = NEW.vehicle_category::text
      AND is_intercity = COALESCE(NEW.is_intercity,false);
  NEW.price_estimate := GREATEST(1000::numeric, COALESCE(v_min_fare,0), round(v_raw / 250) * 250);
  NEW.commission := 0;
  NEW.status := 'searching';
  NEW.searching_started_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_taxi_request() FROM PUBLIC, anon, authenticated;
