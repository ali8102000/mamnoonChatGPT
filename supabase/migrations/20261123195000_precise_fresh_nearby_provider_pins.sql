-- Keep nearby provider markers precise and expose freshness/accuracy metadata.
-- The previous RPC rounded coordinates to 3 decimal places (~100 m near Najaf)
-- and the client could retain stale markers when the result became empty.
DROP FUNCTION IF EXISTS public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,integer);

CREATE FUNCTION public.find_nearby_provider_pins(
  _lat numeric,
  _lng numeric,
  _type text,
  _category text DEFAULT NULL,
  _service_id uuid DEFAULT NULL,
  _radius_km numeric DEFAULT 5,
  _limit integer DEFAULT 30
)
RETURNS TABLE(
  pin_id text,
  lat numeric,
  lng numeric,
  heading numeric,
  updated_at timestamptz,
  accuracy_m double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH origin AS (
    SELECT extensions.st_setsrid(
      extensions.st_makepoint(_lng::double precision, _lat::double precision), 4326
    )::extensions.geography AS point
  )
  SELECT
    md5(pp.user_id::text),
    pp.lat::numeric,
    pp.lng::numeric,
    pp.heading::numeric,
    pp.updated_at,
    pp.accuracy_m
  FROM public.provider_presence pp
  CROSS JOIN origin o
  WHERE auth.uid() IS NOT NULL
    AND _lat BETWEEN -90 AND 90
    AND _lng BETWEEN -180 AND 180
    AND _type IN ('taxi', 'service')
    AND pp.updated_at > now() - interval '90 seconds'
    AND (pp.accuracy_m IS NULL OR pp.accuracy_m <= 100)
    AND extensions.st_dwithin(
      pp.location, o.point,
      (least(greatest(coalesce(_radius_km, 5), 0.1), 25) * 1000 * 1.01) + 5
    )
    AND (
      (
        _type = 'taxi'
        AND EXISTS (
          SELECT 1
          FROM public.driver_profiles dp
          WHERE dp.user_id = pp.user_id
            AND dp.available = true
            AND dp.status = 'approved'
            AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())
            AND (_category IS NULL OR dp.vehicle_category::text = _category)
            AND (
              (_category = 'large' AND public.has_role(dp.user_id, 'large_driver'::public.app_role))
              OR (_category IS DISTINCT FROM 'large'
                AND public.has_role(dp.user_id, 'driver'::public.app_role))
            )
        )
      )
      OR
      (
        _type = 'service'
        AND public.has_role(pp.user_id, 'worker'::public.app_role)
        AND EXISTS (
          SELECT 1
          FROM public.worker_profiles wp
          WHERE wp.user_id = pp.user_id
            AND wp.available = true
            AND wp.status = 'approved'
            AND (wp.suspended_until IS NULL OR wp.suspended_until <= now())
            AND (
              _service_id IS NULL
              OR EXISTS (
                SELECT 1
                FROM public.worker_services ws
                WHERE ws.worker_id = wp.user_id AND ws.service_id = _service_id
              )
            )
        )
      )
    )
    AND 6371 * acos(least(1.0, greatest(-1.0,
      cos(radians(_lat::double precision)) * cos(radians(pp.lat)) *
      cos(radians(pp.lng) - radians(_lng::double precision)) +
      sin(radians(_lat::double precision)) * sin(radians(pp.lat))
    ))) <= least(greatest(coalesce(_radius_km, 5), 0.1), 25)
  ORDER BY pp.updated_at DESC
  LIMIT least(greatest(coalesce(_limit, 30), 1), 30);
$function$;

REVOKE ALL ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,integer) TO authenticated;
