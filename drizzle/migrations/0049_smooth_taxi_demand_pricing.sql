CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_multiplier numeric;
  v_rate numeric;
  v_base_fare numeric;
  v_economy_fare numeric;
  v_vehicle_multiplier numeric := 1;
BEGIN
  IF NEW.type = 'taxi' THEN
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
      -- Gradually taper demand uplift from 1.5x below 5,000 IQD to 1.1x at 10,000 IQD.
      -- Avoid a hard threshold that can make fares jump or drop abruptly.
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

    NEW.price_estimate := round((v_economy_fare * v_vehicle_multiplier) / 250) * 250;
    NEW.commission := 0;
    NEW.status := 'searching';
    NEW.searching_started_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_taxi_request() FROM PUBLIC, anon, authenticated;
