-- Progressive nearest-first provider dispatch.
-- Technicians and large Kia requests expand to 25 km; regular taxis stop at 5 km.
BEGIN;

-- Technician/service request dispatch queue.
CREATE TABLE IF NOT EXISTS public.service_dispatch_queue (
  request_id uuid PRIMARY KEY REFERENCES public.service_requests(id) ON DELETE CASCADE,
  stage integer NOT NULL DEFAULT 0 CHECK (stage >= 0),
  next_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_dispatch_next_at
  ON public.service_dispatch_queue(next_at);
ALTER TABLE public.service_dispatch_queue ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.service_dispatch_queue TO service_role;

CREATE OR REPLACE FUNCTION public.advance_service_dispatch(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.service_requests%ROWTYPE;
  q public.service_dispatch_queue%ROWTYPE;
  v_radius numeric;
  v_min numeric;
  v_count integer := 0;
BEGIN
  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  SELECT * INTO q
  FROM public.service_dispatch_queue
  WHERE request_id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 0; END IF;
  IF r.type <> 'service' OR r.status NOT IN ('pending', 'searching')
     OR r.provider_id IS NOT NULL OR r.service_id IS NULL THEN
    DELETE FROM public.service_dispatch_queue WHERE request_id = _request_id;
    RETURN 0;
  END IF;
  IF q.next_at > now() THEN RETURN 0; END IF;

  IF q.stage >= 6 THEN
    DELETE FROM public.service_dispatch_queue WHERE request_id = _request_id;
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (
      r.customer_id,
      'service_searching',
      'انتهى البحث ضمن 25 كم',
      'لم نعثر على فني متاح ضمن مسافة 25 كم. يمكنك إعادة المحاولة لاحقاً.',
      '/request/' || r.id,
      jsonb_build_object('request_id', r.id, 'service_id', r.service_id, 'max_radius_km', 25)
    );
    RETURN 0;
  END IF;

  UPDATE public.request_offers
  SET status = 'expired', responded_at = now()
  WHERE request_id = _request_id
    AND status = 'pending'
    AND expires_at <= now();

  v_radius := (ARRAY[2, 5, 10, 15, 20, 25]::numeric[])[q.stage + 1];
  v_min := (ARRAY[0, 2, 5, 10, 15, 20]::numeric[])[q.stage + 1];

  WITH latest_presence AS (
    SELECT DISTINCT ON (pp.user_id)
      pp.user_id, pp.lat, pp.lng, pp.updated_at
    FROM public.provider_presence pp
    WHERE pp.updated_at > now() - interval '5 minutes'
    ORDER BY pp.user_id, pp.updated_at DESC
  ),
  candidates AS (
    SELECT
      wp.user_id,
      (6371 * acos(LEAST(1.0, GREATEST(-1.0,
        cos(radians(r.pickup_lat::double precision))
        * cos(radians(lp.lat))
        * cos(radians(lp.lng) - radians(r.pickup_lng::double precision))
        + sin(radians(r.pickup_lat::double precision))
        * sin(radians(lp.lat))
      ))))::numeric AS distance_km
    FROM public.worker_profiles wp
    JOIN public.worker_services ws
      ON ws.worker_id = wp.user_id
     AND ws.service_id = r.service_id
    JOIN latest_presence lp ON lp.user_id = wp.user_id
    WHERE wp.available = true
      AND wp.status = 'approved'
      AND (r.level_required IS NULL OR wp.level = r.level_required)
      AND r.pickup_lat IS NOT NULL
      AND r.pickup_lng IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.service_requests active
        WHERE active.provider_id = wp.user_id
          AND active.status IN ('accepted', 'in_progress')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE b.user_id = wp.user_id
          AND (b.expires_at IS NULL OR b.expires_at > now())
      )
  ),
  inserted AS (
    INSERT INTO public.request_offers
      (request_id, provider_id, distance_km, status, sent_at, expires_at)
    SELECT
      r.id, c.user_id, c.distance_km, 'pending', now(), now() + interval '60 seconds'
    FROM candidates c
    WHERE c.distance_km > v_min
      AND c.distance_km <= v_radius
      AND c.user_id <> r.customer_id
      AND NOT EXISTS (
        SELECT 1 FROM public.request_offers existing
        WHERE existing.request_id = r.id
          AND existing.provider_id = c.user_id
          AND existing.status IN ('pending', 'accepted', 'rejected')
      )
    ORDER BY c.distance_km ASC
    LIMIT 10
    ON CONFLICT (request_id, provider_id) DO UPDATE
      SET status = 'pending',
          distance_km = EXCLUDED.distance_km,
          sent_at = now(),
          expires_at = now() + interval '60 seconds',
          responded_at = NULL
      WHERE public.request_offers.status IN ('expired', 'cancelled')
    RETURNING id, provider_id, distance_km
  )
  INSERT INTO public.notifications (user_id, type, title, body, link, data)
  SELECT
    i.provider_id,
    'service_offer',
    'طلب خدمة جديد',
    'وصلك طلب ' || s.name_ar || ' بالقرب منك. لديك دقيقة للرد.',
    '/request/' || r.id,
    jsonb_build_object(
      'request_id', r.id,
      'offer_id', i.id,
      'service_id', r.service_id,
      'service_slug', s.slug,
      'service_name', s.name_ar,
      'distance_km', round(i.distance_km, 2),
      'price_iqd', COALESCE(r.customer_price, r.price_estimate),
      'pickup_text', r.pickup_text,
      'work_description', r.work_description,
      'workers_count', r.workers_count,
      'dispatch_radius_km', v_radius
    )
  FROM inserted i
  JOIN public.services s ON s.id = r.service_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.service_dispatch_queue
  SET stage = q.stage + 1,
      next_at = now() + interval '60 seconds'
  WHERE request_id = _request_id;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_service_dispatch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_service_dispatch(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_service_request(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.service_dispatch_queue(request_id, stage, next_at)
  SELECT id, 0, now()
  FROM public.service_requests
  WHERE id = _request_id AND type = 'service'
  ON CONFLICT (request_id) DO NOTHING;

  v_count := public.advance_service_dispatch(_request_id);

  IF EXISTS (SELECT 1 FROM public.service_dispatch_queue) THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'mamnoon-service-dispatch'
    ) THEN
      PERFORM cron.schedule(
        'mamnoon-service-dispatch',
        '5 seconds',
        'SELECT public.process_service_dispatch()'
      );
    END IF;
  END IF;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_service_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_service_request(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.process_service_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(91840061);
  FOR v_id IN
    SELECT request_id
    FROM public.service_dispatch_queue
    WHERE next_at <= now()
    ORDER BY next_at
    LIMIT 100
  LOOP
    PERFORM public.advance_service_dispatch(v_id);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.service_dispatch_queue) THEN
    PERFORM cron.unschedule('mamnoon-service-dispatch');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.process_service_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_service_dispatch() TO service_role;

-- Replace taxi stages with the requested limits. Large vehicles use six expanding rings.
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
  v_count integer := 0;
BEGIN
  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  SELECT * INTO q
  FROM public.taxi_dispatch_queue
  WHERE request_id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 0; END IF;
  IF r.status NOT IN ('pending', 'searching') OR r.provider_id IS NOT NULL THEN
    DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
    RETURN 0;
  END IF;
  IF q.next_at > now() THEN RETURN 0; END IF;

  UPDATE public.request_offers
  SET status = 'expired', responded_at = now()
  WHERE request_id = _request_id
    AND status = 'pending'
    AND expires_at <= now();

  IF r.vehicle_category::text = 'large' THEN
    IF q.stage >= 6 THEN
      DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
      INSERT INTO public.notifications(user_id, type, title, body, link, data)
      VALUES (
        r.customer_id,
        'large_vehicle_searching',
        'انتهى البحث ضمن 25 كم',
        'لم تصل عروض من أصحاب السيارات الكبيرة ضمن 25 كم. يمكنك إعادة إرسال الطلب.',
        '/request/' || r.id,
        jsonb_build_object('request_id', r.id, 'max_radius_km', 25)
      );
      RETURN 0;
    END IF;

    v_radius := (ARRAY[2, 5, 10, 15, 20, 25]::numeric[])[q.stage + 1];
    v_min := (ARRAY[0, 2, 5, 10, 15, 20]::numeric[])[q.stage + 1];

    WITH inserted AS (
      INSERT INTO public.request_offers
        (request_id, provider_id, distance_km, status, sent_at, expires_at)
      SELECT
        r.id, d.user_id, d.distance_km, 'pending', now(), now() + interval '24 hours'
      FROM public.find_nearby_drivers(
        r.pickup_lat, r.pickup_lng, 'large', v_radius, 250
      ) d
      JOIN public.driver_profiles dp ON dp.user_id = d.user_id
      WHERE d.distance_km > v_min
        AND d.user_id <> r.customer_id
        AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
        AND NOT EXISTS (
          SELECT 1 FROM public.request_offers o
          WHERE o.request_id = r.id
            AND o.provider_id = d.user_id
            AND o.status IN ('pending', 'accepted', 'rejected')
        )
      ORDER BY d.distance_km
      LIMIT 100
      ON CONFLICT (request_id, provider_id) DO UPDATE
        SET status = 'pending',
            distance_km = EXCLUDED.distance_km,
            sent_at = now(),
            expires_at = now() + interval '24 hours',
            responded_at = NULL,
            proposed_price = NULL,
            offer_message = NULL
        WHERE public.request_offers.status IN ('expired', 'cancelled')
      RETURNING provider_id
    )
    INSERT INTO public.notifications (user_id, type, title, body, link, data)
    SELECT
      i.provider_id,
      'ride_offer',
      'طلب سيارة كبيرة جديد',
      'وصل طلب كيا حمل/ركاب ضمن نطاقك. أرسل سعرك للزبون.',
      '/request/' || r.id,
      jsonb_build_object(
        'request_id', r.id,
        'vehicle_type', r.vehicle_type,
        'pickup_text', r.pickup_text,
        'dest_text', r.dest_text,
        'customer_price', r.customer_price,
        'dispatch_radius_km', v_radius
      )
    FROM inserted i;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.taxi_dispatch_queue
    SET stage = q.stage + 1, next_at = now() + interval '60 seconds'
    WHERE request_id = _request_id;
    RETURN v_count;
  END IF;

  IF q.stage >= 3 THEN
    DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
    UPDATE public.service_requests
    SET status = 'cancelled',
        cancellation_reason = 'لم يقبل أي سائق الطلب ضمن نطاق 5 كم',
        cancelled_by = NULL
    WHERE id = _request_id;
    UPDATE public.request_offers
    SET status = 'cancelled', responded_at = now()
    WHERE request_id = _request_id AND status = 'pending';
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (
      r.customer_id,
      'request_cancelled',
      'انتهى البحث عن سائق',
      'لم يقبل أي سائق الطلب ضمن مسافة 5 كم. يمكنك المحاولة مرة أخرى.',
      '/request/' || _request_id,
      jsonb_build_object('request_id', _request_id, 'max_radius_km', 5)
    );
    RETURN 0;
  END IF;

  v_radius := (ARRAY[1, 3, 5]::numeric[])[q.stage + 1];
  v_min := (ARRAY[0, 1, 3]::numeric[])[q.stage + 1];

  WITH inserted AS (
    INSERT INTO public.request_offers
      (request_id, provider_id, distance_km, status, sent_at, expires_at)
    SELECT
      _request_id, d.user_id, d.distance_km, 'pending', now(), now() + interval '60 seconds'
    FROM public.find_nearby_drivers(
      r.pickup_lat, r.pickup_lng, r.vehicle_category::text, v_radius, 100
    ) d
    WHERE d.distance_km > v_min
      AND d.user_id <> r.customer_id
      AND NOT EXISTS (
        SELECT 1 FROM public.request_offers o
        WHERE o.request_id = _request_id AND o.provider_id = d.user_id
      )
    ORDER BY d.distance_km
    LIMIT 10
    ON CONFLICT (request_id, provider_id) DO NOTHING
    RETURNING provider_id
  )
  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  SELECT
    provider_id,
    'ride_offer',
    'طلب رحلة جديد',
    'لديك دقيقة لقبول الرحلة من ' || COALESCE(r.pickup_text, 'الموقع المحدد')
      || ' إلى ' || COALESCE(r.dest_text, 'الوجهة المحددة'),
    '/request/' || _request_id,
    jsonb_build_object('request_id', _request_id, 'dispatch_radius_km', v_radius)
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

-- A customer retry restarts the large-vehicle search from the closest ring.
CREATE OR REPLACE FUNCTION public.retry_large_vehicle_dispatch(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.service_requests%ROWTYPE;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND OR r.customer_id <> auth.uid()
     OR r.type <> 'taxi' OR r.vehicle_category::text <> 'large'
     OR r.provider_id IS NOT NULL OR r.status NOT IN ('pending', 'searching') THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  INSERT INTO public.taxi_dispatch_queue(request_id, stage, next_at)
  VALUES (_request_id, 0, now())
  ON CONFLICT (request_id) DO UPDATE SET stage = 0, next_at = now();

  v_count := public.advance_taxi_dispatch(_request_id);

  IF EXISTS (SELECT 1 FROM public.taxi_dispatch_queue) THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'mamnoon-taxi-dispatch'
    ) THEN
      PERFORM cron.schedule(
        'mamnoon-taxi-dispatch',
        '5 seconds',
        'SELECT public.process_taxi_dispatch()'
      );
    END IF;
  END IF;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_large_vehicle_dispatch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_large_vehicle_dispatch(uuid) TO authenticated;


-- Keep the existing service-request insert trigger, but route new requests
-- through the progressive queue instead of the former one-shot 10 km dispatch.
CREATE OR REPLACE FUNCTION public.on_service_request_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'service' THEN
    PERFORM public.dispatch_service_request(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.on_service_request_created() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS service_request_dispatch_created ON public.service_requests;
CREATE TRIGGER service_request_dispatch_created
  AFTER INSERT ON public.service_requests
  FOR EACH ROW
  WHEN (NEW.type = 'service')
  EXECUTE FUNCTION public.on_service_request_created();

COMMIT;
