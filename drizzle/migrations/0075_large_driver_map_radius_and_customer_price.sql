-- Extend large-vehicle nearby map discovery to 25 km without replacing
-- subscription-aware dispatch or its larger plan-based dispatch radii.
CREATE OR REPLACE FUNCTION public.find_nearby_provider_pins(
  _lat numeric,
  _lng numeric,
  _type text,
  _category text DEFAULT NULL,
  _service_id uuid DEFAULT NULL,
  _radius_km numeric DEFAULT 5,
  _limit integer DEFAULT 30
)
RETURNS TABLE(pin_id text, lat numeric, lng numeric, heading numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    md5(pp.user_id::text),
    round(pp.lat::numeric, 3),
    round(pp.lng::numeric, 3),
    pp.heading::numeric
  FROM public.provider_presence pp
  WHERE auth.uid() IS NOT NULL
    AND _lat BETWEEN -90 AND 90
    AND _lng BETWEEN -180 AND 180
    AND _type IN ('taxi', 'service')
    AND pp.updated_at > now() - interval '5 minutes'
    AND public.mamnoon_provider_subscription_active_internal(pp.user_id)
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
              OR
              (_category IS DISTINCT FROM 'large'
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
                WHERE ws.worker_id = wp.user_id
                  AND ws.service_id = _service_id
              )
            )
        )
      )
    )
    AND 6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(_lat)) * cos(radians(pp.lat)) *
      cos(radians(pp.lng) - radians(_lng)) +
      sin(radians(_lat)) * sin(radians(pp.lat))
    ))) <= LEAST(GREATEST(COALESCE(_radius_km, 5), 0.1), 25)
  ORDER BY pp.updated_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 30), 1), 30);
$$;

REVOKE ALL ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,integer)
  TO authenticated, service_role;

-- Enforce the large-vehicle customer budget on both insert and later edits.
-- Keep this separate from prepare_taxi_request to preserve current fare,
-- round-trip, extra-time and subscription-aware request behavior.
CREATE OR REPLACE FUNCTION public.guard_large_vehicle_customer_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.type::text = 'taxi'
     AND NEW.vehicle_category::text = 'large'
     AND NEW.customer_price IS NOT NULL
     AND (
       NEW.customer_price < 250
       OR NEW.customer_price > 50000
       OR NEW.customer_price % 250 <> 0
     ) THEN
    RAISE EXCEPTION 'السعر المقترح يجب أن يكون من 250 إلى 50000 دينار ومن مضاعفات 250';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_large_vehicle_customer_price ON public.service_requests;
CREATE TRIGGER trg_guard_large_vehicle_customer_price
  BEFORE INSERT OR UPDATE OF type, vehicle_category, customer_price
  ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_large_vehicle_customer_price();

REVOKE EXECUTE ON FUNCTION public.guard_large_vehicle_customer_price()
  FROM PUBLIC, anon, authenticated;
