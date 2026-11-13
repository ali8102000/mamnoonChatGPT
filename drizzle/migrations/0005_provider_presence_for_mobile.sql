-- Mobile providers need a dedicated last-known presence row.
-- Exact coordinates are writable/readable only by the provider; discovery uses
-- the SECURITY DEFINER RPC below and returns rounded coordinates only.

CREATE TABLE IF NOT EXISTS public.provider_presence (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  lat numeric NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng numeric NOT NULL CHECK (lng BETWEEN -180 AND 180),
  heading numeric CHECK (heading IS NULL OR heading BETWEEN 0 AND 360),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_presence_updated_at
  ON public.provider_presence (updated_at DESC);

ALTER TABLE public.provider_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_presence FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.provider_presence TO authenticated;
GRANT ALL ON public.provider_presence TO service_role;

-- Remove legacy policies from migration 0002; otherwise permissive policies combine with the stricter role checks below.
DROP POLICY IF EXISTS "Own presence read" ON public.provider_presence;
DROP POLICY IF EXISTS "Own presence insert" ON public.provider_presence;
DROP POLICY IF EXISTS "Own presence update" ON public.provider_presence;
DROP POLICY IF EXISTS "Own presence delete" ON public.provider_presence;

DROP POLICY IF EXISTS "Providers read own presence" ON public.provider_presence;
CREATE POLICY "Providers read own presence"
  ON public.provider_presence FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Providers insert own presence" ON public.provider_presence;
CREATE POLICY "Providers insert own presence"
  ON public.provider_presence FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "Providers update own presence" ON public.provider_presence;
CREATE POLICY "Providers update own presence"
  ON public.provider_presence FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  );

DROP TRIGGER IF EXISTS provider_presence_touch ON public.provider_presence;
CREATE TRIGGER provider_presence_touch
  BEFORE INSERT OR UPDATE ON public.provider_presence
  FOR EACH ROW EXECUTE FUNCTION public.touch_provider_presence();

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
    pp.heading
  FROM public.provider_presence pp
  WHERE auth.uid() IS NOT NULL
    AND _lat BETWEEN -90 AND 90
    AND _lng BETWEEN -180 AND 180
    AND _type IN ('taxi', 'service')
    AND pp.updated_at > now() - interval '5 minutes'
    AND (
      (_type = 'taxi' AND EXISTS (
        SELECT 1
        FROM public.driver_profiles dp
        WHERE dp.user_id = pp.user_id
          AND dp.available
          AND dp.status = 'approved'
          AND (_category IS NULL OR dp.vehicle_category::text = _category)
      ))
      OR
      (_type = 'service' AND EXISTS (
        SELECT 1
        FROM public.worker_profiles wp
        WHERE wp.user_id = pp.user_id
          AND wp.available
          AND wp.status = 'approved'
          AND (_service_id IS NULL OR EXISTS (
            SELECT 1
            FROM public.worker_services ws
            WHERE ws.worker_id = wp.user_id
              AND ws.service_id = _service_id
          ))
      ))
    )
    AND 6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(_lat)) * cos(radians(pp.lat)) *
      cos(radians(pp.lng) - radians(_lng)) +
      sin(radians(_lat)) * sin(radians(pp.lat))
    ))) <= LEAST(GREATEST(COALESCE(_radius_km, 5), 0.1), 15)
  ORDER BY pp.updated_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 30), 1), 30)
$$;

REVOKE ALL ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,int)
  TO authenticated, service_role;
