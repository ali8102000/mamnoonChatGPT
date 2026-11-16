-- Server-authoritative routing and pricing for automatically priced taxi categories only.
CREATE TABLE IF NOT EXISTS public.pricing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL CHECK (service_type IN ('economy','premium','luxury')),
  is_intercity boolean NOT NULL DEFAULT false,
  base_fare numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_fare >= 0),
  per_km_rate numeric(12,2) NOT NULL CHECK (per_km_rate >= 0),
  per_min_rate numeric(12,2) NOT NULL DEFAULT 0 CHECK (per_min_rate >= 0),
  min_fare numeric(12,2) NOT NULL DEFAULT 0 CHECK (min_fare >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_type, is_intercity)
);

ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_settings FROM anon, authenticated;
GRANT SELECT ON public.pricing_settings TO authenticated;
DROP POLICY IF EXISTS "Authenticated users can read taxi pricing" ON public.pricing_settings;
CREATE POLICY "Authenticated users can read taxi pricing"
  ON public.pricing_settings FOR SELECT TO authenticated USING (true);

INSERT INTO public.pricing_settings
  (service_type,is_intercity,base_fare,per_km_rate,per_min_rate,min_fare)
VALUES
  ('economy',false,0,400,0,0),
  ('premium',false,0,400,0,0),
  ('luxury',false,0,400,0,0),
  ('economy',true,0,187.5,0,0),
  ('premium',true,0,187.5,0,0),
  ('luxury',true,0,187.5,0,0)
ON CONFLICT (service_type,is_intercity) DO NOTHING;

-- Only the authenticated Edge Function using the service role may create
-- automatically priced taxi requests. Large vehicles keep their existing flow.
CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
  v_base numeric;
  v_raw numeric;
  v_tier_multiplier numeric := 1;
  v_trip_multiplier numeric := 1;
  v_extra_time_fare numeric := 0;
  v_base_fare numeric;
  v_per_min_rate numeric;
  v_min_fare numeric;
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

  IF auth.role() <> 'service_role' THEN
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
    WHERE service_type = NEW.vehicle_category::text
      AND is_intercity = COALESCE(NEW.is_intercity,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'إعدادات تسعير هذه الفئة غير متوفرة'; END IF;

  v_base := v_base_fare + (NEW.distance_km * v_rate) + (NEW.duration_min * v_per_min_rate);
  IF NEW.vehicle_category::text = 'premium' THEN
    v_tier_multiplier := CASE
      WHEN COALESCE(NEW.is_intercity,false) THEN 1.05
      ELSE 1.10 - 0.05 * LEAST(1,GREATEST(0,(v_base - 4500)/1000))
    END;
  ELSIF NEW.vehicle_category::text = 'luxury' THEN
    v_tier_multiplier := CASE
      WHEN COALESCE(NEW.is_intercity,false) THEN 1.10
      ELSE 1.25 - 0.15 * LEAST(1,GREATEST(0,(v_base - 4500)/1000))
    END;
  END IF;
  IF NEW.trip_type IN ('round_trip','second_trip') THEN
    v_trip_multiplier := CASE WHEN NEW.trip_type = 'round_trip' THEN 1.8 ELSE 2 END;
  END IF;
  v_extra_time_fare := ceil(NEW.extra_minutes::numeric / 5) * 500;
  v_raw := v_base * v_tier_multiplier * v_trip_multiplier + v_extra_time_fare;
  IF NEW.trip_type = 'round_trip' THEN v_raw := v_base * v_tier_multiplier * 2 * 0.9 + v_extra_time_fare; END IF;

  NEW.price_estimate := GREATEST(v_min_fare, ceil(v_raw / 250) * 250);
  NEW.commission := 0;
  NEW.status := 'searching';
  NEW.searching_started_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_taxi_request() FROM PUBLIC, anon, authenticated;
