-- Infer the Kia subtype from the note prefix as a compatibility path for the
-- Android create-taxi-request Edge Function, which historically forwards notes.
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
        CASE
          WHEN COALESCE(NEW.notes, '') ILIKE '%كيا ركاب%' THEN 'kia_passenger'
          ELSE 'kia_cargo'
        END
      );
    ELSE
      NEW.vehicle_type := NULL;
    END IF;

    IF NEW.distance_km IS NULL
       OR NEW.distance_km < 0
       OR NEW.pickup_lat IS NULL
       OR NEW.pickup_lng IS NULL
       OR NEW.dest_lat IS NULL
       OR NEW.dest_lng IS NULL THEN
      RAISE EXCEPTION 'مسافة الطريق ونقطتا الانطلاق والوجهة مطلوبة';
    END IF;

    v_rate := CASE WHEN COALESCE(NEW.is_intercity, false) THEN 187.5 ELSE 400 END;
    v_base_fare := NEW.distance_km * v_rate;
    v_multiplier := public.get_taxi_demand_multiplier(
      NEW.pickup_lat, NEW.pickup_lng, NEW.vehicle_category::text
    );

    v_multiplier := LEAST(1.50, GREATEST(0.80, v_multiplier));
    v_economy_fare := v_base_fare * v_multiplier;
    IF COALESCE(NEW.is_intercity, false) OR v_economy_fare >= 10000 THEN
      v_multiplier := LEAST(1.10, GREATEST(0.95, v_multiplier));
      v_economy_fare := v_base_fare * v_multiplier;
    END IF;

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
