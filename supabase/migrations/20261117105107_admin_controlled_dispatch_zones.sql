-- Admin-controlled three-ring dispatch ranges for taxi drivers, large vehicles and technicians.
CREATE TABLE IF NOT EXISTS public.dispatch_zone_settings (
  dispatch_type text PRIMARY KEY CHECK (dispatch_type IN ('taxi','large_driver','technician')),
  ring1_min_km numeric(6,2) NOT NULL DEFAULT 0 CHECK (ring1_min_km >= 0),
  ring1_max_km numeric(6,2) NOT NULL,
  ring2_min_km numeric(6,2) NOT NULL,
  ring2_max_km numeric(6,2) NOT NULL,
  ring3_min_km numeric(6,2) NOT NULL,
  ring3_max_km numeric(6,2) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  CONSTRAINT dispatch_zone_settings_valid CHECK (
    ring1_min_km = 0 AND ring1_max_km > ring1_min_km AND
    ring2_min_km = ring1_max_km AND ring2_max_km > ring2_min_km AND
    ring3_min_km = ring2_max_km AND ring3_max_km > ring3_min_km AND
    ring3_max_km <= 55
  )
);
INSERT INTO public.dispatch_zone_settings
  (dispatch_type,ring1_min_km,ring1_max_km,ring2_min_km,ring2_max_km,ring3_min_km,ring3_max_km)
VALUES ('taxi',0,1,1,3,3,5),('large_driver',0,5,5,25,25,55),('technician',0,5,5,25,25,55)
ON CONFLICT (dispatch_type) DO NOTHING;
ALTER TABLE public.dispatch_zone_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dispatch_zone_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_zone_settings TO service_role;

CREATE OR REPLACE FUNCTION public.get_dispatch_ring(p_dispatch_type text,p_stage integer)
RETURNS TABLE(min_km numeric,max_km numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    CASE ((GREATEST(p_stage,0) % 3)+1) WHEN 1 THEN s.ring1_min_km WHEN 2 THEN s.ring2_min_km ELSE s.ring3_min_km END,
    CASE ((GREATEST(p_stage,0) % 3)+1) WHEN 1 THEN s.ring1_max_km WHEN 2 THEN s.ring2_max_km ELSE s.ring3_max_km END
  FROM public.dispatch_zone_settings s WHERE s.dispatch_type=p_dispatch_type;
$function$;
REVOKE ALL ON FUNCTION public.get_dispatch_ring(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dispatch_ring(text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_dispatch_zone_settings()
RETURNS TABLE(dispatch_type text,ring1_min_km numeric,ring1_max_km numeric,ring2_min_km numeric,ring2_max_km numeric,ring3_min_km numeric,ring3_max_km numeric,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_admin_access(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
 RETURN QUERY SELECT s.dispatch_type,s.ring1_min_km,s.ring1_max_km,s.ring2_min_km,s.ring2_max_km,s.ring3_min_km,s.ring3_max_km,s.updated_at FROM public.dispatch_zone_settings s ORDER BY CASE s.dispatch_type WHEN 'taxi' THEN 1 WHEN 'large_driver' THEN 2 ELSE 3 END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_dispatch_zone_settings(p_dispatch_type text,p_ring1_max_km numeric,p_ring2_max_km numeric,p_ring3_max_km numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_admin_access(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_dispatch_type NOT IN ('taxi','large_driver','technician') OR p_ring1_max_km <= 0 OR p_ring2_max_km <= p_ring1_max_km OR p_ring3_max_km <= p_ring2_max_km OR p_ring3_max_km > 55 THEN RAISE EXCEPTION 'invalid_dispatch_zone_ranges'; END IF;
 UPDATE public.dispatch_zone_settings SET ring1_min_km=0,ring1_max_km=p_ring1_max_km,ring2_min_km=p_ring1_max_km,ring2_max_km=p_ring2_max_km,ring3_min_km=p_ring2_max_km,ring3_max_km=p_ring3_max_km,updated_at=now(),updated_by=auth.uid() WHERE dispatch_type=p_dispatch_type;
 IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_zone_not_found'; END IF;
 RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_get_dispatch_zone_settings() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_update_dispatch_zone_settings(text,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_dispatch_zone_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_dispatch_zone_settings(text,numeric,numeric,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.advance_taxi_dispatch(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  q public.taxi_dispatch_queue%ROWTYPE;
  v_radius numeric;
  v_min numeric;
  v_zone integer;
  v_count integer := 0;
BEGIN
  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
    RETURN 0;
  END IF;

  SELECT * INTO q FROM public.taxi_dispatch_queue WHERE request_id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF r.status NOT IN ('pending', 'searching') OR r.provider_id IS NOT NULL THEN
    DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
    RETURN 0;
  END IF;
  IF q.next_at > now() THEN RETURN 0; END IF;

  UPDATE public.request_offers
  SET status = 'expired', responded_at = now()
  WHERE request_id = _request_id AND status = 'pending'
    AND expires_at <= now();

  -- Large vehicles keep their price-bid workflow, but each driver gets 60 seconds
  -- to submit a bid. A submitted bid remains available to the customer for 24 hours.
  IF r.vehicle_category::text = 'large' THEN
    IF q.stage >= 6 THEN
      DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
      IF EXISTS (
        SELECT 1 FROM public.request_offers
        WHERE request_id = _request_id AND status = 'pending'
          AND proposed_price IS NOT NULL AND expires_at > now()
      ) THEN
        INSERT INTO public.notifications(user_id, type, title, body, link, data)
        VALUES (
          r.customer_id, 'large_vehicle_searching', 'وصلت عروض أسعار لطلبك',
          'انتهت جولات البحث ووصلتك عروض من أصحاب السيارات. راجع الأسعار واختر العرض المناسب.',
          '/request/' || r.id,
          jsonb_build_object('request_id', r.id, 'max_radius_km', 55)
        );
      ELSE
        UPDATE public.service_requests
        SET status = 'cancelled',
            cancellation_reason = 'dispatch_no_provider',
            cancelled_by = NULL
        WHERE id = _request_id;
        UPDATE public.request_offers
        SET status = 'cancelled', responded_at = now()
        WHERE request_id = _request_id AND status = 'pending';
        INSERT INTO public.notifications(user_id, type, title, body, link, data)
        VALUES (
          r.customer_id, 'request_cancelled', 'عذراً، لم نعثر على سيارة متاحة',
          'بحثنا لدى أصحاب السيارات القريبة ثم الأبعد، لكن لم يصلنا عرض. تگدر تعيد المحاولة بنفس الطلب أو ترفع السعر المقترح.',
          '/request/' || r.id,
          jsonb_build_object('request_id', r.id, 'reason', 'dispatch_no_provider', 'max_radius_km', 55)
        );
      END IF;
      RETURN 0;
    END IF;

    SELECT min_km, max_km INTO v_min, v_radius
    FROM public.get_dispatch_ring('large_driver', q.stage);

    WITH inserted AS (
      INSERT INTO public.request_offers(
        request_id, provider_id, distance_km, status, sent_at, expires_at
      )
      SELECT r.id, d.user_id, d.distance_km, 'pending', now(), now() + interval '60 seconds'
      FROM public.find_nearby_drivers(r.pickup_lat, r.pickup_lng, 'large', v_radius, 1000) d
      JOIN public.driver_profiles dp ON dp.user_id = d.user_id
      WHERE d.distance_km > v_min
        AND d.user_id <> r.customer_id
        AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
        AND NOT EXISTS (
          SELECT 1 FROM public.request_offers o
          WHERE o.request_id = r.id AND o.provider_id = d.user_id
            AND o.status IN ('pending', 'accepted', 'rejected')
        )
      ORDER BY d.distance_km ASC
      ON CONFLICT (request_id, provider_id) DO UPDATE
      SET status = 'pending', distance_km = EXCLUDED.distance_km,
          sent_at = now(), expires_at = now() + interval '60 seconds',
          responded_at = NULL, proposed_price = NULL, offer_message = NULL
      WHERE public.request_offers.status IN ('expired', 'cancelled')
      RETURNING provider_id, distance_km
    )
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    SELECT i.provider_id, 'ride_offer', 'طلب سيارة كبيرة جديد',
      'طلب ' || CASE r.vehicle_type WHEN 'kia_passenger' THEN 'كيا ركاب' WHEN 'bus' THEN 'باص' ELSE 'كيا حمل' END ||
      ' من ' || COALESCE(r.pickup_text, 'الموقع المحدد') ||
      ' إلى ' || COALESCE(r.dest_text, 'الوجهة المحددة') ||
      '. لديك 60 ثانية لإرسال سعرك.',
      '/request/' || r.id,
      jsonb_build_object(
        'request_id', r.id, 'vehicle_type', r.vehicle_type,
        'pickup_text', r.pickup_text, 'dest_text', r.dest_text,
        'distance_km', round(i.distance_km, 2),
        'customer_price', r.customer_price,
        'dispatch_radius_km', v_radius, 'expires_in_seconds', 60
      )
    FROM inserted i;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.taxi_dispatch_queue
    SET stage = q.stage + 1, next_at = now() + interval '60 seconds'
    WHERE request_id = _request_id;
    RETURN v_count;
  END IF;

  -- Standard taxis: 0-1 km, 1-3 km, 3-5 km, then repeat those same rings.
  IF q.stage >= 6 THEN
    DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
    UPDATE public.service_requests
    SET status = 'cancelled',
        cancellation_reason = 'dispatch_no_provider',
        cancelled_by = NULL
    WHERE id = _request_id;
    UPDATE public.request_offers
    SET status = 'cancelled', responded_at = now()
    WHERE request_id = _request_id AND status = 'pending';
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (
      r.customer_id, 'request_cancelled', 'عذراً، لم نعثر على سائق متاح',
      'بحثنا عن سائق قريب ثم وسّعنا نطاق البحث وأعدنا المحاولة، لكن لم يقبل أحد الطلب. تگدر تعيد المحاولة بنفس التفاصيل أو ترفع السعر.',
      '/request/' || _request_id,
      jsonb_build_object('request_id', _request_id, 'reason', 'dispatch_no_provider', 'max_radius_km', 5)
    );
    RETURN 0;
  END IF;

  SELECT min_km, max_km INTO v_min, v_radius
  FROM public.get_dispatch_ring('taxi', q.stage);

  WITH inserted AS (
    INSERT INTO public.request_offers(
      request_id, provider_id, distance_km, status, sent_at, expires_at
    )
    SELECT _request_id, d.user_id, d.distance_km, 'pending', now(), now() + interval '60 seconds'
    FROM public.find_nearby_drivers(
      r.pickup_lat, r.pickup_lng, r.vehicle_category::text, v_radius, 1000
    ) d
    WHERE d.distance_km > v_min AND d.user_id <> r.customer_id
      AND NOT EXISTS (
        SELECT 1 FROM public.request_offers o
        WHERE o.request_id = _request_id AND o.provider_id = d.user_id
          AND o.status IN ('pending', 'accepted', 'rejected')
      )
    ORDER BY d.distance_km ASC
    ON CONFLICT (request_id, provider_id) DO UPDATE
    SET status = 'pending', distance_km = EXCLUDED.distance_km,
        sent_at = now(), expires_at = now() + interval '60 seconds',
        responded_at = NULL, proposed_price = NULL, offer_message = NULL
    WHERE public.request_offers.status IN ('expired', 'cancelled')
    RETURNING provider_id, distance_km
  )
  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  SELECT i.provider_id, 'ride_offer', 'طلب رحلة جديد',
    'من ' || COALESCE(r.pickup_text, 'الموقع المحدد') ||
    ' إلى ' || COALESCE(r.dest_text, 'الوجهة المحددة') ||
    '. المسافة ' || COALESCE(round(r.distance_km, 1)::text, 'غير محددة') ||
    ' كم، والسعر ' || COALESCE(round(r.price_estimate)::text, 'يُحدد') ||
    ' د.ع. لديك 60 ثانية لقبول الطلب.',
    '/request/' || _request_id,
    jsonb_build_object(
      'request_id', _request_id, 'dispatch_radius_km', v_radius,
      'distance_km', round(r.distance_km, 2),
      'pickup_text', r.pickup_text, 'dest_text', r.dest_text,
      'price_iqd', r.price_estimate, 'vehicle_category', r.vehicle_category,
      'expires_in_seconds', 60
    )
  FROM inserted i;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.taxi_dispatch_queue
  SET stage = q.stage + 1, next_at = now() + interval '60 seconds'
  WHERE request_id = _request_id;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_service_dispatch(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  q public.service_dispatch_queue%ROWTYPE;
  v_radius numeric;
  v_min numeric;
  v_zone integer;
  v_count integer := 0;
BEGIN
  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    DELETE FROM public.service_dispatch_queue WHERE request_id = _request_id;
    RETURN 0;
  END IF;
  SELECT * INTO q FROM public.service_dispatch_queue WHERE request_id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF r.type <> 'service' OR r.status NOT IN ('pending', 'searching')
     OR r.provider_id IS NOT NULL OR r.service_id IS NULL THEN
    DELETE FROM public.service_dispatch_queue WHERE request_id = _request_id;
    RETURN 0;
  END IF;
  IF q.next_at > now() THEN RETURN 0; END IF;

  UPDATE public.request_offers
  SET status = 'expired', responded_at = now()
  WHERE request_id = _request_id AND status = 'pending'
    AND expires_at <= now();

  IF q.stage >= 6 THEN
    DELETE FROM public.service_dispatch_queue WHERE request_id = _request_id;
    UPDATE public.service_requests
    SET status = 'cancelled',
        cancellation_reason = 'dispatch_no_provider',
        cancelled_by = NULL
    WHERE id = _request_id;
    UPDATE public.request_offers
    SET status = 'cancelled', responded_at = now()
    WHERE request_id = _request_id AND status = 'pending';
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (
      r.customer_id, 'request_cancelled', 'عذراً، لم نعثر على فني متاح',
      'بحثنا لدى الفنيين القريبين ثم وسّعنا نطاق البحث وأعدنا المحاولة، لكن لم يقبل أحد الطلب. تگدر تعيد المحاولة بنفس التفاصيل أو ترفع الأجر المقترح.',
      '/request/' || r.id,
      jsonb_build_object('request_id', r.id, 'service_id', r.service_id, 'reason', 'dispatch_no_provider', 'max_radius_km', 55)
    );
    RETURN 0;
  END IF;

  -- Three non-overlapping rings across the existing 55 km provider radius,
  -- repeated once: 0-5 km, 5-25 km, and 25-55 km.
  SELECT min_km, max_km INTO v_min, v_radius
  FROM public.get_dispatch_ring('technician', q.stage);

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
        cos(radians(r.pickup_lat::double precision)) *
        cos(radians(lp.lat)) *
        cos(radians(lp.lng) - radians(r.pickup_lng::double precision)) +
        sin(radians(r.pickup_lat::double precision)) * sin(radians(lp.lat))
      ))))::numeric AS distance_km,
      COALESCE(sp.priority_weight, 0) AS subscription_priority,
      LEAST(COALESCE(wp.service_radius_km, 25),
        CASE COALESCE(sp.code, 'bronze')
          WHEN 'gold' THEN 55 WHEN 'silver' THEN 40 ELSE 25
        END
      ) AS effective_radius_km
    FROM public.worker_profiles wp
    JOIN public.worker_services ws
      ON ws.worker_id = wp.user_id AND ws.service_id = r.service_id
    JOIN latest_presence lp ON lp.user_id = wp.user_id
    LEFT JOIN public.user_subscriptions us
      ON us.user_id = wp.user_id AND us.status = 'active'
      AND (us.current_period_end IS NULL OR us.current_period_end > now())
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE wp.available = true
      AND public.mamnoon_provider_subscription_active_internal(wp.user_id)
      AND wp.status = 'approved'
      AND (r.level_required IS NULL OR wp.level = r.level_required)
      AND r.pickup_lat IS NOT NULL AND r.pickup_lng IS NOT NULL
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
    INSERT INTO public.request_offers(
      request_id, provider_id, distance_km, status, sent_at, expires_at
    )
    SELECT r.id, c.user_id, c.distance_km, 'pending', now(), now() + interval '60 seconds'
    FROM candidates c
    WHERE c.distance_km > v_min
      AND c.distance_km <= v_radius
      AND c.distance_km <= c.effective_radius_km
      AND c.user_id <> r.customer_id
      AND NOT EXISTS (
        SELECT 1 FROM public.request_offers existing
        WHERE existing.request_id = r.id
          AND existing.provider_id = c.user_id
          AND existing.status IN ('pending', 'accepted', 'rejected')
      )
    ORDER BY c.subscription_priority DESC, c.distance_km ASC
    ON CONFLICT (request_id, provider_id) DO UPDATE
    SET status = 'pending', distance_km = EXCLUDED.distance_km,
        sent_at = now(), expires_at = now() + interval '60 seconds',
        responded_at = NULL, proposed_price = NULL, offer_message = NULL
    WHERE public.request_offers.status IN ('expired', 'cancelled')
    RETURNING id, provider_id, distance_km
  )
  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  SELECT
    i.provider_id, 'service_offer', 'طلب خدمة جديد',
    'وصلك طلب ' || s.name_ar || ' من ' || COALESCE(r.pickup_text, 'الموقع المحدد') ||
    CASE WHEN r.dest_text IS NOT NULL THEN ' إلى ' || r.dest_text ELSE '' END ||
    '. تبعد ' || round(i.distance_km, 1)::text ||
    ' كم، والأجر ' || COALESCE(r.customer_price::text, r.price_estimate::text, 'قابل للتفاوض') ||
    ' د.ع. لديك 60 ثانية لقبول الطلب.',
    '/request/' || r.id,
    jsonb_build_object(
      'request_id', r.id, 'offer_id', i.id, 'service_id', r.service_id,
      'service_slug', s.slug, 'service_name', s.name_ar,
      'distance_km', round(i.distance_km, 2),
      'price_iqd', COALESCE(r.customer_price, r.price_estimate),
      'pickup_text', r.pickup_text, 'dest_text', r.dest_text,
      'work_description', r.work_description, 'workers_count', r.workers_count,
      'dispatch_radius_km', v_radius, 'expires_in_seconds', 60
    )
  FROM inserted i
  JOIN public.services s ON s.id = r.service_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.service_dispatch_queue
  SET stage = q.stage + 1, next_at = now() + interval '60 seconds'
  WHERE request_id = _request_id;
  RETURN v_count;
END;
$function$;