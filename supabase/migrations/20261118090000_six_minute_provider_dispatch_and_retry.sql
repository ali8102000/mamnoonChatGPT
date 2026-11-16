-- Six-minute provider dispatch: three distance rings, delivered twice.
-- Each provider offer expires after 60 seconds; the database worker owns progression.

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

    v_zone := (q.stage % 3) + 1;
    v_radius := (ARRAY[5, 25, 55]::numeric[])[v_zone];
    v_min := (ARRAY[0, 5, 25]::numeric[])[v_zone];

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

  v_zone := (q.stage % 3) + 1;
  v_radius := (ARRAY[1, 3, 5]::numeric[])[v_zone];
  v_min := (ARRAY[0, 1, 3]::numeric[])[v_zone];

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
  v_zone := (q.stage % 3) + 1;
  v_radius := (ARRAY[5, 25, 55]::numeric[])[v_zone];
  v_min := (ARRAY[0, 5, 25]::numeric[])[v_zone];

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

-- Permit only the authenticated owner-driven retry RPC to restore a terminal
-- no-provider request and adjust its agreed customer price.
CREATE OR REPLACE FUNCTION public.guard_customer_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('mamnoon.allow_large_vehicle_accept', true) = 'true'
     AND OLD.vehicle_category::text = 'large'
     AND NEW.vehicle_category::text = 'large'
     AND auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF current_setting('mamnoon.allow_dispatch_retry', true) = 'true'
     AND auth.uid() = OLD.customer_id
     AND OLD.status = 'cancelled'
     AND NEW.status = 'searching' THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.service_id IS DISTINCT FROM OLD.service_id
       OR NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category
       OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
       OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat
       OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng
       OR NEW.dest_lat IS DISTINCT FROM OLD.dest_lat
       OR NEW.dest_lng IS DISTINCT FROM OLD.dest_lng THEN
      RAISE EXCEPTION 'retry_request_immutable_fields_changed';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.provider_id THEN
    IF current_setting('mamnoon.allow_provider_request_transition', true) = 'true' THEN
      RETURN NEW;
    END IF;
    IF pg_trigger_depth() > 1
       AND (to_jsonb(NEW) - ARRAY['commission', 'updated_at'])
           = (to_jsonb(OLD) - ARRAY['commission', 'updated_at']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'provider_request_update_requires_rpc';
  END IF;

  IF auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN RAISE EXCEPTION 'customer_id_immutable'; END IF;
  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN RAISE EXCEPTION 'provider_id_readonly_for_customer'; END IF;
  IF NEW.type IS DISTINCT FROM OLD.type THEN RAISE EXCEPTION 'type_immutable'; END IF;
  IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN RAISE EXCEPTION 'service_id_immutable'; END IF;
  IF NEW.price_estimate IS DISTINCT FROM OLD.price_estimate THEN RAISE EXCEPTION 'price_readonly_for_customer'; END IF;
  IF NEW.commission IS DISTINCT FROM OLD.commission THEN RAISE EXCEPTION 'commission_readonly'; END IF;
  IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN RAISE EXCEPTION 'accepted_at_readonly'; END IF;
  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN RAISE EXCEPTION 'completed_at_readonly'; END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (NEW.status = 'cancelled' AND OLD.status IN ('pending','searching','accepted','in_progress')) THEN
      RAISE EXCEPTION 'invalid_status_transition_for_customer';
    END IF;
    NEW.cancelled_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_request_coupon_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.coupon_code IS DISTINCT FROM OLD.coupon_code
     OR NEW.coupon_id IS DISTINCT FROM OLD.coupon_id
     OR NEW.coupon_discount IS DISTINCT FROM OLD.coupon_discount THEN
    RAISE EXCEPTION 'لا يمكن تعديل الكوبون أو الخصم بعد إرسال الطلب';
  END IF;
  IF NEW.customer_payable IS DISTINCT FROM OLD.customer_payable
     AND current_setting('mamnoon.allow_dispatch_retry', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'لا يمكن تعديل المبلغ المستحق بعد إرسال الطلب';
  END IF;
  RETURN NEW;
END;
$function$;


-- Expand the existing bounded driver discovery page so each dispatch wave reaches
-- every eligible nearby driver up to a safe 1,000-row ceiling.
CREATE OR REPLACE FUNCTION public.find_nearby_drivers(
  _lat numeric,
  _lng numeric,
  _category text,
  _radius_km numeric DEFAULT 5,
  _limit integer DEFAULT 10
)
RETURNS TABLE(user_id uuid, distance_km numeric, rating_avg numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT x.user_id, x.distance_km, x.rating_avg
  FROM (
    SELECT DISTINCT ON (dp.user_id)
      dp.user_id,
      dp.rating_avg,
      COALESCE(sp.priority_weight, 0) AS subscription_priority,
      (
        6371 * acos(LEAST(1.0, GREATEST(-1.0,
          cos(radians(_lat)) * cos(radians(loc.lat)) *
          cos(radians(loc.lng) - radians(_lng)) +
          sin(radians(_lat)) * sin(radians(loc.lat))
        )))
      )::numeric AS distance_km
    FROM public.driver_profiles dp
    JOIN (
      SELECT pp.user_id, pp.lat, pp.lng, pp.updated_at
      FROM public.provider_presence pp
      UNION ALL
      SELECT ll.user_id, ll.lat, ll.lng, ll.updated_at
      FROM public.live_locations ll
    ) loc ON loc.user_id = dp.user_id
    LEFT JOIN public.user_subscriptions us
      ON us.user_id = dp.user_id AND us.status = 'active'
      AND (us.current_period_end IS NULL OR us.current_period_end > now())
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE dp.available = true
      AND public.mamnoon_provider_subscription_active_internal(dp.user_id)
      AND dp.status = 'approved'
      AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())
      AND (_category IS NULL OR dp.vehicle_category::text = _category)
      AND (
        (_category = 'large' AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = dp.user_id AND ur.role = 'large_driver'::public.app_role
        ))
        OR
        (_category IS DISTINCT FROM 'large' AND _category IN ('economy', 'premium', 'luxury')
          AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = dp.user_id AND ur.role = 'driver'::public.app_role
          ))
      )
      AND loc.updated_at > now() - interval '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.service_requests sr
        WHERE sr.provider_id = dp.user_id AND sr.status IN ('accepted', 'in_progress')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE b.user_id = dp.user_id AND (b.expires_at IS NULL OR b.expires_at > now())
      )
    ORDER BY dp.user_id, loc.updated_at DESC
  ) x
  WHERE x.distance_km <= LEAST(GREATEST(COALESCE(_radius_km, 5), 0.1), 55)
    AND (
      _category IS DISTINCT FROM 'large'
      OR x.distance_km <= COALESCE((
        SELECT LEAST(COALESCE(dp.service_radius_km, 25),
          CASE COALESCE(sp2.code, 'bronze')
            WHEN 'gold' THEN 55 WHEN 'silver' THEN 40 ELSE 25
          END
        )
        FROM public.driver_profiles dp
        LEFT JOIN public.user_subscriptions us2
          ON us2.user_id = dp.user_id AND us2.status = 'active'
          AND (us2.current_period_end IS NULL OR us2.current_period_end > now())
        LEFT JOIN public.subscription_plans sp2 ON sp2.id = us2.plan_id
        WHERE dp.user_id = x.user_id
      ), 25)
    )
  ORDER BY x.subscription_priority DESC, x.distance_km ASC, x.rating_avg DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(_limit, 10), 1), 1000);
$function$;

CREATE OR REPLACE FUNCTION public.retry_service_request(
  _request_id uuid,
  _price_increase integer DEFAULT 0
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_base numeric;
  v_new_price numeric;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _price_increase IS NULL OR _price_increase < 0
     OR _price_increase > 50000 OR _price_increase % 250 <> 0 THEN
    RAISE EXCEPTION 'invalid_price_increase';
  END IF;

  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND OR r.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'request_not_found_or_forbidden';
  END IF;
  IF r.status <> 'cancelled' OR r.cancellation_reason <> 'dispatch_no_provider'
     OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_not_retryable';
  END IF;

  v_base := COALESCE(r.customer_price::numeric, r.price_estimate, 0);
  v_new_price := CASE
    WHEN _price_increase > 0 AND v_base > 0 THEN v_base + _price_increase
    WHEN _price_increase > 0 THEN _price_increase
    ELSE r.customer_price
  END;

  PERFORM set_config('mamnoon.allow_dispatch_retry', 'true', true);
  UPDATE public.service_requests
  SET status = 'searching',
      cancellation_reason = NULL,
      cancelled_by = NULL,
      searching_started_at = now(),
      customer_price = v_new_price,
      pricing_mode = CASE
        WHEN _price_increase > 0 AND r.pricing_mode = 'negotiable' THEN 'fixed'
        ELSE r.pricing_mode
      END,
      customer_payable = CASE
        WHEN _price_increase > 0 AND r.coupon_id IS NOT NULL
          THEN GREATEST(v_new_price - COALESCE(r.coupon_discount, 0), 0)
        WHEN _price_increase > 0 AND r.coupon_id IS NULL
          THEN v_new_price
        ELSE r.customer_payable
      END
  WHERE id = _request_id;
  PERFORM set_config('mamnoon.allow_dispatch_retry', 'false', true);

  UPDATE public.request_offers
  SET status = 'cancelled', responded_at = now()
  WHERE request_id = _request_id AND status IN ('pending', 'expired', 'rejected');

  IF r.type = 'taxi' THEN
    -- taxi_dispatch_changed enqueues and sends the first wave from the status update.
    SELECT count(*)::integer INTO v_count
    FROM public.request_offers
    WHERE request_id = _request_id AND status = 'pending'
      AND sent_at >= now() - interval '10 seconds';
  ELSE
    INSERT INTO public.service_dispatch_queue(request_id, stage, next_at)
    VALUES (_request_id, 0, now())
    ON CONFLICT (request_id) DO UPDATE SET stage = 0, next_at = now();
    v_count := public.advance_service_dispatch(_request_id);
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.retry_service_request(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_service_request(uuid, integer) TO authenticated;

-- Keep taxi progression close to the exact 60-second offer expiry.
DO $schedule$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'mamnoon-taxi-dispatch' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_job_id, schedule := '5 seconds');
  END IF;
END;
$schedule$;
