-- Route service requests to nearby, approved workers and expose only targeted offers.
-- Uses provider_presence because idle workers do not have request-scoped live_locations yet.

DROP POLICY IF EXISTS "Workers see available service requests" ON public.service_requests;
CREATE POLICY "Workers see offered service requests"
  ON public.service_requests FOR SELECT TO authenticated
  USING (
    type = 'service'
    AND status IN ('pending', 'searching')
    AND public.has_role(auth.uid(), 'worker'::public.app_role)
    AND public.has_offer(id, auth.uid())
  );

CREATE OR REPLACE FUNCTION public.dispatch_service_request(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.service_requests%ROWTYPE;
  v_count integer := 0;
BEGIN
  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND OR r.type <> 'service'
     OR r.status NOT IN ('pending', 'searching')
     OR r.provider_id IS NOT NULL
     OR r.service_id IS NULL THEN
    RETURN 0;
  END IF;

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
    WHERE c.distance_km <= 10
      AND c.user_id <> r.customer_id
      AND NOT EXISTS (
        SELECT 1 FROM public.request_offers existing
        WHERE existing.request_id = r.id
          AND existing.provider_id = c.user_id
      )
    ORDER BY c.distance_km ASC
    LIMIT 10
    ON CONFLICT (request_id, provider_id) DO NOTHING
    RETURNING id, provider_id, distance_km
  )
  INSERT INTO public.notifications (user_id, type, title, body, link, data)
  SELECT
    i.provider_id,
    'service_offer',
    'طلب خدمة جديد',
    'وصلك طلب ' || s.name_ar || ' بالقرب منك. افتح التفاصيل قبل انتهاء مهلة القبول.',
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
      'workers_count', r.workers_count
    )
  FROM inserted i
  JOIN public.services s ON s.id = r.service_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, data)
    VALUES (
      r.customer_id,
      'service_searching',
      'نبحث عن فني مناسب',
      'لم نعثر على فني متاح قريباً بعد. سيبقى طلبك ظاهراً ويمكنك المحاولة لاحقاً.',
      '/request/' || r.id,
      jsonb_build_object('request_id', r.id, 'service_id', r.service_id)
    );
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_service_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_service_request(uuid) TO service_role;

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

-- Workers may accept only a live offer addressed to their own account.
CREATE OR REPLACE FUNCTION public.accept_service_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer uuid;
  v_updated integer;
  r public.service_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.has_role(auth.uid(), 'driver') OR public.has_role(auth.uid(), 'worker')) THEN
    RAISE EXCEPTION 'provider_role_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE b.user_id = auth.uid()
      AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN RAISE EXCEPTION 'user_blocked'; END IF;

  PERFORM pg_advisory_xact_lock(91840060);
  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;

  IF NOT FOUND OR r.status NOT IN ('pending', 'searching') OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.service_requests
    WHERE provider_id = auth.uid() AND status IN ('accepted', 'in_progress')
  ) THEN RAISE EXCEPTION 'لديك طلب نشط بالفعل'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.request_offers o
    WHERE o.request_id = _request_id
      AND o.provider_id = auth.uid()
      AND o.status = 'pending'
      AND o.expires_at > now()
  ) THEN RAISE EXCEPTION 'request_offer_expired'; END IF;

  UPDATE public.service_requests
  SET provider_id = auth.uid(), status = 'accepted', accepted_at = now()
  WHERE id = _request_id
    AND (
      (type = 'taxi' AND public.has_role(auth.uid(), 'driver'))
      OR
      (type = 'service' AND public.has_role(auth.uid(), 'worker')
        AND (service_id IS NULL OR EXISTS (
          SELECT 1 FROM public.worker_services ws
          WHERE ws.worker_id = auth.uid() AND ws.service_id = service_requests.service_id
        )))
    )
  RETURNING customer_id INTO v_customer;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'request_unavailable'; END IF;

  INSERT INTO public.chats(request_id, customer_id, provider_id)
  VALUES (_request_id, v_customer, auth.uid())
  ON CONFLICT (request_id) DO UPDATE
    SET provider_id = EXCLUDED.provider_id, updated_at = now();

  UPDATE public.request_offers
  SET status = CASE WHEN provider_id = auth.uid() THEN 'accepted' ELSE 'cancelled' END,
      responded_at = now()
  WHERE request_id = _request_id AND status = 'pending';

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

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.request_offers;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END;
$$;
