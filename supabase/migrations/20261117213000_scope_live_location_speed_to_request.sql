-- Compare movement speed only against the previous point from the same active trip.
-- A stale point from a prior request must not block the first location update
-- of a new trip when the user starts far from the previous trip's last point.
CREATE OR REPLACE FUNCTION public.guard_live_location_speed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  prev RECORD;
  dist_km numeric;
  dt_sec numeric;
BEGIN
  SELECT lat, lng, updated_at
    INTO prev
  FROM public.live_locations
  WHERE user_id = NEW.user_id
    AND request_id = NEW.request_id
  ORDER BY updated_at DESC
  LIMIT 1;

  IF prev.lat IS NOT NULL THEN
    dt_sec := GREATEST(1, EXTRACT(EPOCH FROM (now() - prev.updated_at)));
    dist_km := 6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(prev.lat)) * cos(radians(NEW.lat))
      * cos(radians(NEW.lng) - radians(prev.lng))
      + sin(radians(prev.lat)) * sin(radians(NEW.lat))
    )));

    IF (dist_km / dt_sec) * 3600 > 250 AND dist_km > 1 THEN
      RAISE EXCEPTION 'implausible_speed';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_live_location_speed() FROM PUBLIC, anon, authenticated;
