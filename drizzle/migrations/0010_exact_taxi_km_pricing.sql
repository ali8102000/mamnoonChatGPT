-- Enforce the current Mamnoon taxi tariff: exactly 400 IQD per confirmed
-- driving kilometer, with no base fare, minimum, or 250-IQD rounding.
DROP TRIGGER IF EXISTS zz_taxi_round_price ON public.service_requests;
DROP FUNCTION IF EXISTS public.round_taxi_price_estimate();
DROP FUNCTION IF EXISTS public.round_to_250(numeric);

CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'taxi' THEN
    IF NEW.distance_km IS NULL
       OR NEW.distance_km < 0
       OR NEW.pickup_lat IS NULL
       OR NEW.pickup_lng IS NULL
       OR NEW.dest_lat IS NULL
       OR NEW.dest_lng IS NULL THEN
      RAISE EXCEPTION 'مسافة الطريق ونقطتا الانطلاق والوجهة مطلوبة';
    END IF;
    NEW.price_estimate := NEW.distance_km * 400;
    NEW.commission := 0;
    NEW.status := 'searching';
    NEW.searching_started_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_taxi_request() FROM PUBLIC, anon, authenticated;
