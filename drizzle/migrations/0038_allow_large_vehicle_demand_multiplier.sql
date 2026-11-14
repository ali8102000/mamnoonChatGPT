-- Allow the large Kia category in demand multiplier checks.
-- The Web request form calls this RPC while the user selects a vehicle category.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_taxi_demand_multiplier(
  _lat numeric,
  _lng numeric,
  _category text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_drivers integer := 0;
  v_waiting integer := 0;
  v_ratio numeric;
BEGIN
  IF _lat IS NULL OR _lng IS NULL OR _lat NOT BETWEEN -90 AND 90 OR _lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'موقع الانطلاق غير صالح';
  END IF;
  IF _category IS NOT NULL
     AND _category NOT IN ('economy', 'premium', 'luxury', 'large') THEN
    RAISE EXCEPTION 'فئة السيارة غير صالحة';
  END IF;

  WITH locations AS (
    SELECT pp.user_id, pp.lat::numeric AS lat, pp.lng::numeric AS lng, pp.updated_at
    FROM public.provider_presence pp
    UNION ALL
    SELECT ll.user_id, ll.lat::numeric, ll.lng::numeric, ll.updated_at
    FROM public.live_locations ll
    WHERE ll.role = 'provider'
  ),
  latest AS (
    SELECT DISTINCT ON (user_id) user_id, lat, lng, updated_at
    FROM locations
    ORDER BY user_id, updated_at DESC
  )
  SELECT COUNT(*)::integer INTO v_drivers
  FROM public.driver_profiles dp
  JOIN latest loc ON loc.user_id = dp.user_id
  WHERE dp.available
    AND dp.status = 'approved'
    AND (_category IS NULL OR dp.vehicle_category::text = _category)
    AND loc.updated_at > now() - interval '5 minutes'
    AND 6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(_lat)) * cos(radians(loc.lat)) *
      cos(radians(loc.lng) - radians(_lng)) +
      sin(radians(_lat)) * sin(radians(loc.lat))
    ))) <= 5
    AND NOT EXISTS (
      SELECT 1 FROM public.service_requests active
      WHERE active.provider_id = dp.user_id
        AND active.status IN ('accepted', 'in_progress')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE b.user_id = dp.user_id
        AND (b.expires_at IS NULL OR b.expires_at > now())
    );

  SELECT COUNT(*)::integer INTO v_waiting
  FROM public.service_requests sr
  WHERE sr.type = 'taxi'
    AND sr.status IN ('pending', 'searching')
    AND sr.provider_id IS NULL
    AND sr.created_at > now() - interval '15 minutes'
    AND (_category IS NULL OR sr.vehicle_category::text = _category)
    AND sr.pickup_lat IS NOT NULL
    AND sr.pickup_lng IS NOT NULL
    AND 6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(_lat)) * cos(radians(sr.pickup_lat)) *
      cos(radians(sr.pickup_lng) - radians(_lng)) +
      sin(radians(_lat)) * sin(radians(sr.pickup_lat))
    ))) <= 5;

  v_ratio := v_drivers::numeric / GREATEST(v_waiting + 1, 1);

  IF v_ratio >= 3 THEN RETURN 0.80;
  ELSIF v_ratio >= 2 THEN RETURN 0.90;
  ELSIF v_ratio >= 1.25 THEN RETURN 1.00;
  ELSIF v_ratio >= 0.75 THEN RETURN 1.10;
  ELSIF v_ratio >= 0.50 THEN RETURN 1.25;
  ELSIF v_ratio >= 0.25 THEN RETURN 1.40;
  ELSE RETURN 1.50;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_taxi_demand_multiplier(numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_taxi_demand_multiplier(numeric, numeric, text)
  TO authenticated, service_role;

COMMIT;
