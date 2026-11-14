-- Mamnoon: consistent row/advisory lock ordering for taxi dispatch and offer acceptance.
-- Apply after 0044. This migration is shared by the web and Expo clients through Supabase.
BEGIN;

-- Lock order: service_requests row -> taxi_dispatch_queue row -> scheduler advisory lock.
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

  IF NOT FOUND THEN
    DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
    RETURN 0;
  END IF;

  SELECT * INTO q
  FROM public.taxi_dispatch_queue
  WHERE request_id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF r.status NOT IN ('pending', 'searching') OR r.provider_id IS NOT NULL THEN
    DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
    RETURN 0;
  END IF;

  IF q.next_at > now() THEN
    RETURN 0;
  END IF;

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
      FROM public.find_nearby_drivers(r.pickup_lat, r.pickup_lng, 'large', v_radius, 250) d
      JOIN public.driver_profiles dp ON dp.user_id = d.user_id
      WHERE d.distance_km > v_min
        AND d.user_id <> r.customer_id
        AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
        AND NOT EXISTS (
          SELECT 1
          FROM public.request_offers o
          WHERE o.request_id = r.id
            AND o.provider_id = d.user_id
            AND o.status IN ('pending', 'accepted', 'rejected')
        )
      ORDER BY d.distance_km
      LIMIT 100
      ON CONFLICT (request_id, provider_id) DO UPDATE SET
        status = 'pending',
        distance_km = EXCLUDED.distance_km,
        sent_at = now(),
        expires_at = now() + interval '24 hours',
        responded_at = NULL,
        proposed_price = NULL,
        offer_message = NULL
      WHERE public.request_offers.status IN ('expired', 'cancelled')
      RETURNING provider_id
    )
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
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
    SET stage = q.stage + 1,
        next_at = now() + interval '60 seconds'
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
        SELECT 1
        FROM public.request_offers o
        WHERE o.request_id = _request_id
          AND o.provider_id = d.user_id
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
    'لديك دقيقة لقبول الرحلة من ' ||
      COALESCE(r.pickup_text, 'الموقع المحدد') || ' إلى ' ||
      COALESCE(r.dest_text, 'الوجهة المحددة'),
    '/request/' || _request_id,
    jsonb_build_object('request_id', _request_id, 'dispatch_radius_km', v_radius)
  FROM inserted;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.taxi_dispatch_queue
  SET stage = q.stage + 1,
      next_at = now() + interval '60 seconds'
  WHERE request_id = _request_id;

  RETURN v_count;
END;
$$;

-- The worker must not hold the scheduler lock while waiting for request rows.
-- advance_taxi_dispatch serializes each request through its row locks.
CREATE OR REPLACE FUNCTION public.process_taxi_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_previous_defer text;
BEGIN
  v_previous_defer := current_setting('mamnoon.defer_taxi_scheduler_lock', true);
  PERFORM set_config('mamnoon.defer_taxi_scheduler_lock', 'true', true);

  FOR v_id IN
    SELECT request_id
    FROM public.taxi_dispatch_queue
    WHERE next_at <= now()
    ORDER BY next_at
    LIMIT 100
  LOOP
    PERFORM public.advance_taxi_dispatch(v_id);
  END LOOP;

  -- Triggers fired by this worker defer scheduler work until every request row is released.
  PERFORM set_config(
    'mamnoon.defer_taxi_scheduler_lock',
    COALESCE(v_previous_defer, 'false'),
    true
  );

  PERFORM pg_advisory_xact_lock(91840061);

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
  ELSIF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'mamnoon-taxi-dispatch'
  ) THEN
    PERFORM cron.unschedule('mamnoon-taxi-dispatch');
  END IF;
END;
$$;

-- Trigger runs after the service_requests row is already locked.
-- Use a separate scheduler lock, never the provider-acceptance lock.
CREATE OR REPLACE FUNCTION public.on_taxi_dispatch_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_defer_scheduler boolean :=
    COALESCE(current_setting('mamnoon.defer_taxi_scheduler_lock', true), 'false') = 'true';
BEGIN
  IF NEW.type <> 'taxi' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('pending', 'searching')
     AND NEW.provider_id IS NULL THEN

    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.taxi_dispatch_queue(request_id)
      VALUES (NEW.id)
      ON CONFLICT (request_id) DO NOTHING;

      PERFORM public.advance_taxi_dispatch(NEW.id);

    ELSIF OLD.type IS DISTINCT FROM 'taxi'
       OR OLD.status NOT IN ('pending', 'searching')
       OR OLD.provider_id IS NOT NULL THEN

      INSERT INTO public.taxi_dispatch_queue(request_id)
      VALUES (NEW.id)
      ON CONFLICT (request_id) DO NOTHING;

      PERFORM public.advance_taxi_dispatch(NEW.id);
    END IF;

    IF NOT v_defer_scheduler THEN
      -- Request/queue work is complete; serialize only the cron metadata change.
      PERFORM pg_advisory_xact_lock(91840061);

      IF EXISTS (SELECT 1 FROM public.taxi_dispatch_queue)
         AND NOT EXISTS (
           SELECT 1 FROM cron.job WHERE jobname = 'mamnoon-taxi-dispatch'
         ) THEN
        PERFORM cron.schedule(
          'mamnoon-taxi-dispatch',
          '5 seconds',
          'SELECT public.process_taxi_dispatch()'
        );
      END IF;
    END IF;

  ELSE
    DELETE FROM public.taxi_dispatch_queue
    WHERE request_id = NEW.id;

    UPDATE public.request_offers
    SET status = 'cancelled',
        responded_at = now()
    WHERE request_id = NEW.id
      AND status = 'pending'
      AND provider_id IS DISTINCT FROM NEW.provider_id;

    IF NOT v_defer_scheduler THEN
      -- The request and its queue/offers are already locked before scheduler coordination.
      PERFORM pg_advisory_xact_lock(91840061);

      IF NOT EXISTS (SELECT 1 FROM public.taxi_dispatch_queue)
         AND EXISTS (
           SELECT 1 FROM cron.job WHERE jobname = 'mamnoon-taxi-dispatch'
         ) THEN
        PERFORM cron.unschedule('mamnoon-taxi-dispatch');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Both retry paths lock the request first, then the queue/offers, then the scheduler.
CREATE OR REPLACE FUNCTION public.retry_taxi_dispatch(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.service_requests%ROWTYPE;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND OR r.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF r.type <> 'taxi'
     OR r.status NOT IN ('pending', 'searching')
     OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  UPDATE public.request_offers
  SET status = 'expired', responded_at = now()
  WHERE request_id = _request_id
    AND status = 'pending'
    AND expires_at <= now();

  SELECT count(*)::integer INTO v_count
  FROM public.request_offers
  WHERE request_id = _request_id
    AND status = 'pending'
    AND expires_at > now();

  IF v_count > 0 THEN
    RETURN v_count;
  END IF;

  PERFORM 1
  FROM public.taxi_dispatch_queue
  WHERE request_id = _request_id
    AND next_at > now()
  FOR UPDATE;

  IF FOUND THEN
    RETURN 0;
  END IF;

  INSERT INTO public.taxi_dispatch_queue(request_id, stage, next_at)
  VALUES (_request_id, 0, now())
  ON CONFLICT (request_id) DO NOTHING;

  v_count := public.advance_taxi_dispatch(_request_id);

  PERFORM pg_advisory_xact_lock(91840061);

  IF EXISTS (SELECT 1 FROM public.taxi_dispatch_queue)
     AND NOT EXISTS (
       SELECT 1 FROM cron.job WHERE jobname = 'mamnoon-taxi-dispatch'
     ) THEN
    PERFORM cron.schedule(
      'mamnoon-taxi-dispatch',
      '5 seconds',
      'SELECT public.process_taxi_dispatch()'
    );
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND
     OR r.customer_id <> auth.uid()
     OR r.type <> 'taxi'
     OR r.vehicle_category::text <> 'large'
     OR r.provider_id IS NOT NULL
     OR r.status NOT IN ('pending', 'searching') THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  INSERT INTO public.taxi_dispatch_queue(request_id, stage, next_at)
  VALUES (_request_id, 0, now())
  ON CONFLICT (request_id) DO UPDATE
  SET stage = 0, next_at = now();

  v_count := public.advance_taxi_dispatch(_request_id);

  PERFORM pg_advisory_xact_lock(91840061);

  IF EXISTS (SELECT 1 FROM public.taxi_dispatch_queue)
     AND NOT EXISTS (
       SELECT 1 FROM cron.job WHERE jobname = 'mamnoon-taxi-dispatch'
     ) THEN
    PERFORM cron.schedule(
      'mamnoon-taxi-dispatch',
      '5 seconds',
      'SELECT public.process_taxi_dispatch()'
    );
  END IF;

  RETURN v_count;
END;
$$;

-- Acceptance locks the request before its offer. This matches customer cancellation,
-- whose request update trigger subsequently changes request_offers.
CREATE OR REPLACE FUNCTION public.accept_service_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.service_requests%ROWTYPE;
  v_customer uuid;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'driver')
    OR public.has_role(auth.uid(), 'worker')
  ) THEN
    RAISE EXCEPTION 'provider_role_required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE b.user_id = auth.uid()
      AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'user_blocked';
  END IF;

  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  PERFORM 1
  FROM public.request_offers o
  WHERE o.request_id = _request_id
    AND o.provider_id = auth.uid()
    AND o.status = 'pending'
    AND o.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_offer_expired';
  END IF;

  -- Serialize a provider's active-request check across different requests.
  PERFORM pg_advisory_xact_lock(91840060);

  IF EXISTS (
    SELECT 1 FROM public.service_requests
    WHERE provider_id = auth.uid()
      AND status IN ('accepted', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'لديك طلب نشط بالفعل';
  END IF;

  UPDATE public.service_requests
  SET provider_id = auth.uid(),
      status = 'accepted',
      accepted_at = now()
  WHERE id = _request_id
    AND status IN ('pending', 'searching')
    AND provider_id IS NULL
    AND (
      (
        type = 'taxi'
        AND vehicle_category::text IS DISTINCT FROM 'large'
        AND public.has_role(auth.uid(), 'driver')
        AND EXISTS (
          SELECT 1 FROM public.driver_profiles dp
          WHERE dp.user_id = auth.uid()
            AND dp.vehicle_category = service_requests.vehicle_category
            AND dp.vehicle_category::text IN ('economy', 'premium', 'luxury')
            AND dp.status = 'approved'
            AND dp.available = true
        )
      )
      OR
      (
        type = 'service'
        AND public.has_role(auth.uid(), 'worker')
        AND EXISTS (
          SELECT 1 FROM public.worker_profiles wp
          WHERE wp.user_id = auth.uid()
            AND wp.status = 'approved'
            AND wp.available = true
        )
        AND (
          service_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.worker_services ws
            WHERE ws.worker_id = auth.uid()
              AND ws.service_id = service_requests.service_id
          )
        )
      )
    )
  RETURNING customer_id INTO v_customer;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  INSERT INTO public.chats(request_id, customer_id, provider_id)
  VALUES (_request_id, v_customer, auth.uid())
  ON CONFLICT (request_id) DO UPDATE
  SET provider_id = EXCLUDED.provider_id,
      updated_at = now();

  UPDATE public.request_offers
  SET status = CASE
        WHEN provider_id = auth.uid() THEN 'accepted'
        ELSE 'cancelled'
      END,
      responded_at = now()
  WHERE request_id = _request_id
    AND status = 'pending';

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    v_customer,
    'request_accepted',
    'تم قبول طلبك',
    'مقدّم الخدمة قبل طلبك ويمكنك متابعة التفاصيل الآن.',
    '/request/' || _request_id,
    jsonb_build_object('request_id', _request_id, 'provider_id', auth.uid())
  );

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_service_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_service_request(uuid) TO authenticated;

-- Read the request id first without locking, then lock request -> offer.
-- This prevents offer -> request inversion against customer cancellation.
CREATE OR REPLACE FUNCTION public.accept_large_vehicle_offer(_offer_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  o public.request_offers%ROWTYPE;
  r public.service_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT request_id INTO v_request_id
  FROM public.request_offers
  WHERE id = _offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_unavailable';
  END IF;

  SELECT * INTO r
  FROM public.service_requests
  WHERE id = v_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  SELECT * INTO o
  FROM public.request_offers
  WHERE id = _offer_id
  FOR UPDATE;

  IF NOT FOUND
     OR o.request_id <> v_request_id
     OR o.proposed_price IS NULL
     OR o.status <> 'pending'
     OR o.expires_at <= now() THEN
    RAISE EXCEPTION 'offer_unavailable';
  END IF;

  IF r.customer_id <> auth.uid()
     OR r.type <> 'taxi'
     OR r.vehicle_category::text <> 'large'
     OR r.status NOT IN ('pending', 'searching')
     OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  IF o.provider_id = auth.uid()
     OR NOT public.has_role(o.provider_id, 'large_driver')
     OR EXISTS (
       SELECT 1 FROM public.user_blocks b
       WHERE b.user_id = o.provider_id
         AND (b.expires_at IS NULL OR b.expires_at > now())
     )
     OR EXISTS (
       SELECT 1 FROM public.service_requests sr
       WHERE sr.provider_id = o.provider_id
         AND sr.status IN ('accepted', 'in_progress')
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.driver_profiles dp
       WHERE dp.user_id = o.provider_id
         AND dp.vehicle_category::text = 'large'
         AND dp.status = 'approved'
         AND dp.available = true
         AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
     ) THEN
    RAISE EXCEPTION 'large_driver_no_longer_eligible';
  END IF;

  PERFORM set_config('mamnoon.allow_large_vehicle_accept', 'true', true);

  UPDATE public.service_requests
  SET provider_id = o.provider_id,
      status = 'accepted',
      accepted_at = now(),
      price_estimate = o.proposed_price,
      customer_price = o.proposed_price,
      pricing_mode = 'fixed'
  WHERE id = r.id;

  UPDATE public.request_offers
  SET status = CASE
        WHEN id = _offer_id THEN 'accepted'
        ELSE 'cancelled'
      END,
      responded_at = now()
  WHERE request_id = r.id
    AND status = 'pending';

  INSERT INTO public.chats(request_id, customer_id, provider_id)
  VALUES (r.id, r.customer_id, o.provider_id)
  ON CONFLICT (request_id) DO UPDATE
  SET customer_id = EXCLUDED.customer_id,
      provider_id = EXCLUDED.provider_id,
      updated_at = now();

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    o.provider_id,
    'large_vehicle_offer_accepted',
    'تم قبول عرض سعرك',
    'وافق الزبون على عرضك. افتح الطلب للتواصل والبدء.',
    '/request/' || r.id,
    jsonb_build_object('request_id', r.id, 'offer_id', _offer_id)
  );

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_large_vehicle_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_large_vehicle_offer(uuid) TO authenticated;

COMMIT;
