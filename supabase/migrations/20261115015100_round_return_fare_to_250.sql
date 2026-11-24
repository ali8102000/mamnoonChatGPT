-- Stable location-independent taxi fares, discounted round trips, and customer-controlled stop time.
CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
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
    IF NEW.trip_type IN ('round_trip', 'second_trip') THEN
      v_trip_multiplier := CASE WHEN NEW.trip_type = 'round_trip' THEN 1.8 ELSE 2 END;
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
    -- Fixed, location-independent rate: moving the pickup pin cannot change the fare multiplier.
    v_economy_fare := v_base_fare;

    IF NEW.vehicle_category::text = 'premium' THEN
      v_vehicle_multiplier := CASE
        WHEN COALESCE(NEW.is_intercity, false) THEN 1.05
        ELSE 1.10 - 0.05 * LEAST(1, GREATEST(0, (v_economy_fare - 4500) / 1000))
      END;
    ELSIF NEW.vehicle_category::text = 'luxury' THEN
      v_vehicle_multiplier := CASE
        WHEN COALESCE(NEW.is_intercity, false) THEN 1.10
        ELSE 1.25 - 0.15 * LEAST(1, GREATEST(0, (v_economy_fare - 4500) / 1000))
      END;
    END IF;

    NEW.price_estimate := CASE
      WHEN NEW.trip_type = 'round_trip' THEN
        round((v_economy_fare * v_vehicle_multiplier * 2 * 0.90 + v_extra_time_fare) / 250) * 250
      ELSE
        round(((v_economy_fare * v_vehicle_multiplier * v_trip_multiplier) + v_extra_time_fare) / 250) * 250
    END;
    NEW.commission := 0;
    NEW.status := 'searching';
    NEW.searching_started_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
