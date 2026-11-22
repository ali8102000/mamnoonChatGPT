-- Harden taxi tariff availability and preserve accurate nearby-provider coordinates.
-- No existing admin tariff values or user records are modified by this migration.

CREATE OR REPLACE FUNCTION public.guard_taxi_pricing_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_governorate text;
  v_intercity boolean;
BEGIN
  IF NEW.type::text <> 'taxi' OR NEW.vehicle_category::text = 'large' THEN
    RETURN NEW;
  END IF;

  v_governorate := COALESCE(
    NULLIF(NEW.governorate_key, ''),
    public.infer_governorate_key(NEW.pickup_lat, NEW.pickup_lng)
  );
  v_intercity := COALESCE(NEW.is_intercity, false);

  IF v_governorate IS NULL THEN
    RAISE EXCEPTION 'تعذّر تحديد محافظة الانطلاق لحساب التعرفة.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pricing_settings ps
    WHERE ps.service_type = 'economy'
      AND ps.is_intercity = v_intercity
      AND ps.governorate_key IN (v_governorate, 'all')
  ) THEN
    RAISE EXCEPTION 'تعرفة الاقتصاد غير متوفرة لهذه المحافظة ونوع الرحلة.';
  END IF;

  IF NEW.vehicle_category IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.pricing_settings ps
    WHERE ps.service_type = NEW.vehicle_category::text
      AND ps.is_intercity = v_intercity
      AND ps.governorate_key IN (v_governorate, 'all')
  ) THEN
    RAISE EXCEPTION 'تعرفة فئة السيارة المختارة غير متوفرة لهذه المحافظة.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_taxi_pricing_configuration() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_taxi_pricing_configuration_before_insert ON public.service_requests;
CREATE TRIGGER guard_taxi_pricing_configuration_before_insert
BEFORE INSERT ON public.service_requests
FOR EACH ROW
EXECUTE FUNCTION public.guard_taxi_pricing_configuration();

-- Provider markers were rounded to 3 decimals (roughly 100 m). Six decimals
-- preserve sub-meter coordinate detail while keeping the same return contract.
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
SET search_path TO 'public'
AS $function$
  WITH origin AS (
    SELECT extensions.st_setsrid(
      extensions.st_makepoint(_lng::double precision, _lat::double precision), 4326
    )::extensions.geography AS point
  )
  SELECT md5(pp.user_id::text), round(pp.lat::numeric, 6),
         round(pp.lng::numeric, 6), pp.heading::numeric
  FROM public.provider_presence pp
  CROSS JOIN origin o
  WHERE auth.uid() IS NOT NULL
    AND _lat BETWEEN -90 AND 90 AND _lng BETWEEN -180 AND 180
    AND _type IN ('taxi', 'service')
    AND pp.updated_at > now() - interval '5 minutes'
    AND extensions.st_dwithin(
      pp.location, o.point,
      least(greatest(coalesce(_radius_km, 5), 0.1), 25) * 1000
    )
    AND public.mamnoon_provider_subscription_active_internal(pp.user_id)
    AND (
      (
        _type = 'taxi'
        AND EXISTS (
          SELECT 1 FROM public.driver_profiles dp
          WHERE dp.user_id = pp.user_id AND dp.available = true
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
          SELECT 1 FROM public.worker_profiles wp
          WHERE wp.user_id = pp.user_id AND wp.available = true
            AND wp.status = 'approved'
            AND (wp.suspended_until IS NULL OR wp.suspended_until <= now())
            AND (
              _service_id IS NULL
              OR EXISTS (
                SELECT 1 FROM public.worker_services ws
                WHERE ws.worker_id = wp.user_id AND ws.service_id = _service_id
              )
            )
        )
      )
    )
  ORDER BY pp.location <-> o.point ASC, pp.updated_at DESC
  LIMIT least(greatest(coalesce(_limit, 30), 1), 30);
$function$;

