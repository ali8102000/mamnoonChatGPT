-- Re-apply the privacy boundary after production hardening replaces the provider-pin RPC.
-- Only customers may query nearby providers; returned positions are intentionally approximate.
CREATE OR REPLACE FUNCTION public.find_nearby_provider_pins(
  _lat numeric,
  _lng numeric,
  _type text,
  _category text DEFAULT NULL,
  _service_id uuid DEFAULT NULL,
  _radius_km numeric DEFAULT 5,
  _limit int DEFAULT 30
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
    NULL::numeric
  FROM public.provider_presence pp
  WHERE auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'customer'::public.app_role)
    AND _lat BETWEEN -90 AND 90
    AND _lng BETWEEN -180 AND 180
    AND _type IN ('taxi', 'service')
    AND pp.updated_at > now() - interval '90 seconds'
    AND (
      (_type = 'taxi' AND EXISTS (
        SELECT 1 FROM public.driver_profiles dp
        WHERE dp.user_id = pp.user_id
          AND dp.available
          AND dp.status = 'approved'
          AND dp.is_verified
          AND dp.verification_status = 'approved'
          AND public.has_role(dp.user_id, 'driver'::public.app_role)
          AND (_category IS NULL OR dp.vehicle_category::text = _category)
      ))
      OR
      (_type = 'service' AND EXISTS (
        SELECT 1 FROM public.worker_profiles wp
        WHERE wp.user_id = pp.user_id
          AND wp.available
          AND wp.status = 'approved'
          AND wp.is_verified
          AND wp.verification_status = 'approved'
          AND public.has_role(wp.user_id, 'worker'::public.app_role)
          AND (_service_id IS NULL OR EXISTS (
            SELECT 1 FROM public.worker_services ws
            WHERE ws.worker_id = wp.user_id AND ws.service_id = _service_id
          ))
      ))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.service_requests sr
      WHERE sr.provider_id = pp.user_id
        AND sr.status IN ('accepted'::public.request_status, 'in_progress'::public.request_status)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE b.user_id = pp.user_id
        AND (b.expires_at IS NULL OR b.expires_at > now())
    )
    AND 6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(_lat)) * cos(radians(pp.lat)) * cos(radians(pp.lng) - radians(_lng))
      + sin(radians(_lat)) * sin(radians(pp.lat))
    ))) <= LEAST(GREATEST(COALESCE(_radius_km, 5), 0.1), 15)
  ORDER BY 6371 * acos(LEAST(1.0, GREATEST(-1.0,
    cos(radians(_lat)) * cos(radians(pp.lat)) * cos(radians(pp.lng) - radians(_lng))
    + sin(radians(_lat)) * sin(radians(pp.lat))
  ))) ASC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 30), 1), 30)
$$;

REVOKE ALL ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,int)
  TO authenticated, service_role;
