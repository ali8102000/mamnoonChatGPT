ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS trip_type text NOT NULL DEFAULT 'one_way',
  ADD COLUMN IF NOT EXISTS extra_minutes integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.service_requests'::regclass
      AND conname = 'service_requests_trip_type_check'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_trip_type_check
      CHECK (trip_type IN ('one_way', 'round_trip', 'second_trip', 'stop'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.service_requests'::regclass
      AND conname = 'service_requests_extra_minutes_check'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_extra_minutes_check
      CHECK (extra_minutes BETWEEN 0 AND 120 AND extra_minutes % 5 = 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_multiplier numeric;
  v_rate numeric;
  v_base_fare numeric;
  v_economy_fare numeric;
  v_vehicle_multiplier numeric := 1;
  v_trip_multiplier numeric := 1;
  v_extra_time_fare numeric := 0;
BEGIN
  IF NEW.type = 'taxi' THEN
    NEW.trip_type := COALESCE(NEW.trip_type, 'one_way');
    NEW.extra_minutes := COALESCE(NEW.extra_minutes, 0);

    IF NEW.trip_type NOT IN ('one_way', 'round_trip', 'second_trip', 'stop') THEN
      RAISE EXCEPTION 'نوع الرحلة غير صالح';
    END IF;
    IF NEW.extra_minutes < 0 OR NEW.extra_minutes > 120 OR NEW.extra_minutes % 5 <> 0 THEN
      RAISE EXCEPTION 'وقت الانتظار يجب أن يكون من 5 إلى 120 دقيقة وبفواصل 5 دقائق';
    END IF;
    IF NEW.extra_minutes > 0 AND NOT EXISTS (
      SELECT 1
      FROM public.user_subscriptions s
      JOIN public.subscription_plans p ON p.id = s.plan_id
      WHERE s.user_id = NEW.customer_id
        AND p.code = 'gold'
        AND s.status = 'active'
        AND s.is_trial = false
        AND s.current_period_end > now()
    ) THEN
      RAISE EXCEPTION 'إضافة وقت الانتظار متاحة للمشترك الذهبي فقط';
    END IF;

    IF NEW.trip_type IN ('round_trip', 'second_trip') THEN
      v_trip_multiplier := 2;
    END IF;
    v_extra_time_fare := ceil(NEW.extra_minutes::numeric / 5) * 500;

    IF NEW.vehicle_category::text = 'large' THEN
      NEW.vehicle_type := COALESCE(
        NEW.vehicle_type,
        CASE WHEN COALESCE(NEW.notes, '') ILIKE '%كيا ركاب%' THEN 'kia_passenger'
             ELSE 'kia_cargo' END
      );
      IF NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL THEN
        RAISE EXCEPTION 'نقطة الانطلاق مطلوبة';
      END IF;
      NEW.distance_km := NULL;
      NEW.duration_min := NULL;
      NEW.price_estimate := NULL;
      NEW.commission := 0;
      NEW.status := 'searching';
      NEW.searching_started_at := now();
      IF NEW.customer_price IS NOT NULL THEN
        NEW.pricing_mode := 'fixed';
      ELSE
        NEW.pricing_mode := 'negotiable';
      END IF;
      RETURN NEW;
    ELSE
      NEW.vehicle_type := NULL;
    END IF;

    IF NEW.distance_km IS NULL OR NEW.distance_km < 0
       OR NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL
       OR NEW.dest_lat IS NULL OR NEW.dest_lng IS NULL THEN
      RAISE EXCEPTION 'مسافة الطريق ونقطتا الانطلاق والوجهة مطلوبة';
    END IF;

    v_rate := CASE WHEN COALESCE(NEW.is_intercity, false) THEN 187.5 ELSE 400 END;
    v_base_fare := NEW.distance_km * v_rate;
    v_multiplier := public.get_taxi_demand_multiplier(
      NEW.pickup_lat, NEW.pickup_lng, NEW.vehicle_category::text
    );
    v_multiplier := LEAST(1.50, GREATEST(0.80, v_multiplier));
    IF COALESCE(NEW.is_intercity, false) THEN
      v_multiplier := LEAST(1.10, GREATEST(0.95, v_multiplier));
    ELSE
      v_multiplier := LEAST(
        v_multiplier,
        1.10 + 0.40 * LEAST(1, GREATEST(0, (10000 - v_base_fare) / 5000))
      );
    END IF;
    v_economy_fare := v_base_fare * v_multiplier;

    IF NEW.vehicle_category::text = 'premium' THEN
      v_vehicle_multiplier := CASE
        WHEN COALESCE(NEW.is_intercity, false) OR v_economy_fare >= 5000 THEN 1.05
        ELSE 1.10
      END;
    ELSIF NEW.vehicle_category::text = 'luxury' THEN
      v_vehicle_multiplier := CASE
        WHEN COALESCE(NEW.is_intercity, false) OR v_economy_fare >= 5000 THEN 1.10
        ELSE 1.25
      END;
    END IF;

    NEW.price_estimate := round(((v_economy_fare * v_vehicle_multiplier * v_trip_multiplier) + v_extra_time_fare) / 250) * 250;
    NEW.commission := 0;
    NEW.status := 'searching';
    NEW.searching_started_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
