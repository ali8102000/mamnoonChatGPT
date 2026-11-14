BEGIN;

-- Add one large-vehicle tier while preserving the existing economy/premium/luxury tiers.
ALTER TYPE public.vehicle_category ADD VALUE IF NOT EXISTS 'large';

ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_type text;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS vehicle_type text;

ALTER TABLE public.driver_profiles
  DROP CONSTRAINT IF EXISTS driver_profiles_vehicle_type_check;
ALTER TABLE public.driver_profiles
  ADD CONSTRAINT driver_profiles_vehicle_type_check
  CHECK (vehicle_type IS NULL OR vehicle_type IN ('kia_cargo', 'kia_passenger'));

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_vehicle_type_check;
ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_vehicle_type_check
  CHECK (vehicle_type IS NULL OR vehicle_type IN ('kia_cargo', 'kia_passenger'));

-- Only offer large-vehicle requests to drivers registered for the matching Kia type.
CREATE OR REPLACE FUNCTION public.advance_taxi_dispatch(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.service_requests%ROWTYPE;
  q public.taxi_dispatch_queue%ROWTYPE;
  v_radius numeric;
  v_min numeric;
  v_count integer;
BEGIN
  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  SELECT * INTO q FROM public.taxi_dispatch_queue WHERE request_id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF r.status NOT IN ('pending','searching') OR r.provider_id IS NOT NULL THEN
    DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
    RETURN 0;
  END IF;
  IF q.next_at > now() THEN RETURN 0; END IF;

  UPDATE public.request_offers
  SET status = 'expired', responded_at = now()
  WHERE request_id = _request_id AND status = 'pending' AND expires_at <= now();

  IF q.stage >= 3 THEN
    DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
    UPDATE public.service_requests
    SET status = 'cancelled',
        cancellation_reason = 'لم يقبل أي سائق الطلب بعد انتهاء مراحل البحث',
        cancelled_by = NULL
    WHERE id = _request_id;
    UPDATE public.request_offers SET status = 'cancelled'
    WHERE request_id = _request_id AND status = 'pending';
    INSERT INTO public.notifications(user_id,type,title,body,link)
    VALUES (r.customer_id,'request_cancelled','أُلغي الطلب تلقائياً',
      'لم يتوفر سائق يقبل طلبك؛ يمكنك المحاولة مرة أخرى','/request/' || _request_id);
    RETURN 0;
  END IF;

  v_radius := (ARRAY[2,5,10]::numeric[])[q.stage+1];
  v_min := (ARRAY[-1,2,5]::numeric[])[q.stage+1];

  WITH inserted AS (
    INSERT INTO public.request_offers(request_id,provider_id,distance_km,status,sent_at,expires_at)
    SELECT _request_id,d.user_id,d.distance_km,'pending',now(),now()+interval '60 seconds'
    FROM public.find_nearby_drivers(r.pickup_lat,r.pickup_lng,r.vehicle_category::text,v_radius,100) d
    JOIN public.driver_profiles dp ON dp.user_id = d.user_id
    WHERE d.distance_km > v_min
      AND d.user_id <> r.customer_id
      AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
      AND NOT EXISTS (
        SELECT 1 FROM public.request_offers o
        WHERE o.request_id = _request_id AND o.provider_id = d.user_id
      )
    ORDER BY d.distance_km
    LIMIT 10
    ON CONFLICT(request_id,provider_id) DO NOTHING
    RETURNING provider_id
  )
  INSERT INTO public.notifications(user_id,type,title,body,link)
  SELECT provider_id,'ride_offer','طلب رحلة جديد',
    'لديك دقيقة لقبول الرحلة من ' || COALESCE(r.pickup_text,'الموقع المحدد') ||
    ' إلى ' || COALESCE(r.dest_text,'الوجهة المحددة'),
    '/request/' || _request_id
  FROM inserted;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.taxi_dispatch_queue
  SET stage = q.stage + 1, next_at = now() + interval '60 seconds'
  WHERE request_id = _request_id;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_taxi_dispatch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_taxi_dispatch(uuid) TO service_role;

COMMIT;
