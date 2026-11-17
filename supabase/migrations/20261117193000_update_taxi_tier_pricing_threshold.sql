-- Keep the database trigger aligned with the server-authoritative taxi tier pricing.
CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base numeric;
  v_economy_raw numeric;
  v_raw numeric;
  v_trip_multiplier numeric := 1;
  v_extra_time_fare numeric := 0;
  v_base_fare numeric;
  v_rate numeric;
  v_per_min_rate numeric;
  v_min_fare numeric;
  v_uplift numeric := 0;
BEGIN
  IF NEW.type <> 'taxi' THEN RETURN NEW; END IF;

  NEW.trip_type := COALESCE(NEW.trip_type, 'one_way');
  NEW.extra_minutes := COALESCE(NEW.extra_minutes, 0);
  IF NEW.trip_type NOT IN ('one_way','round_trip','second_trip','stop') THEN
    RAISE EXCEPTION 'نوع الرحلة غير صالح';
  END IF;
  IF NEW.extra_minutes < 0 OR NEW.extra_minutes > 120 OR NEW.extra_minutes % 5 <> 0 THEN
    RAISE EXCEPTION 'وقت الانتظار يجب أن يكون من 5 إلى 120 دقيقة وبفواصل 5 دقائق';
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

  SELECT base_fare, per_km_rate, per_min_rate, min_fare
    INTO v_base_fare, v_rate, v_per_min_rate, v_min_fare
    FROM public.pricing_settings
    WHERE service_type = 'economy'
      AND is_intercity = COALESCE(NEW.is_intercity,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'إعدادات تسعير الاقتصادي غير متوفرة'; END IF;

  v_base := v_base_fare + (NEW.distance_km * v_rate) + (NEW.duration_min * v_per_min_rate);
  IF NEW.trip_type IN ('round_trip','second_trip') THEN
    v_trip_multiplier := CASE WHEN NEW.trip_type = 'round_trip' THEN 1.8 ELSE 2 END;
  END IF;
  v_extra_time_fare := ceil(NEW.extra_minutes::numeric / 5) * 500;
  IF NEW.trip_type = 'round_trip' THEN
    v_economy_raw := v_base * 2 * 0.9 + v_extra_time_fare;
  ELSE
    v_economy_raw := v_base * v_trip_multiplier + v_extra_time_fare;
  END IF;
  v_economy_raw := GREATEST(COALESCE(v_min_fare,0), v_economy_raw);

  IF NEW.vehicle_category::text = 'premium' THEN
    v_uplift := CASE WHEN v_economy_raw < 15000 THEN 0.10 ELSE 0.05 END;
  ELSIF NEW.vehicle_category::text = 'luxury' THEN
    v_uplift := CASE WHEN v_economy_raw < 15000 THEN 0.25 ELSE 0.10 END;
  END IF;

  v_raw := v_economy_raw * (1 + v_uplift);
  NEW.price_estimate := round(v_raw / 250) * 250;
  NEW.commission := 0;
  NEW.status := 'searching';
  NEW.searching_started_at := now();
  RETURN NEW;
END;
$$;
