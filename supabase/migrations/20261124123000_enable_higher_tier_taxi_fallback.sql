-- Allow higher taxi classes to receive and accept lower-class requests.
-- Customer-selected category and fare remain unchanged on service_requests.

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
  WITH origin AS (
    SELECT extensions.st_setsrid(
      extensions.st_makepoint(_lng::double precision, _lat::double precision), 4326
    )::extensions.geography AS point
  ),
  candidate_users AS MATERIALIZED (
    SELECT pp.user_id
    FROM public.provider_presence pp CROSS JOIN origin o
    WHERE pp.updated_at > now() - interval '5 minutes'
      AND extensions.st_dwithin(pp.location, o.point,
        (least(greatest(coalesce(_radius_km, 5), 0.1), 55) * 1000 * 1.01) + 5)
    UNION
    SELECT ll.user_id
    FROM public.live_locations ll CROSS JOIN origin o
    WHERE ll.updated_at > now() - interval '5 minutes'
      AND extensions.st_dwithin(ll.location, o.point,
        (least(greatest(coalesce(_radius_km, 5), 0.1), 55) * 1000 * 1.01) + 5)
  ),
  locations AS (
    SELECT pp.user_id, pp.lat, pp.lng, pp.updated_at
    FROM public.provider_presence pp JOIN candidate_users c ON c.user_id = pp.user_id
    UNION ALL
    SELECT ll.user_id, ll.lat, ll.lng, ll.updated_at
    FROM public.live_locations ll JOIN candidate_users c ON c.user_id = ll.user_id
  ),
  latest AS MATERIALIZED (
    SELECT DISTINCT ON (user_id) user_id, lat, lng, updated_at
    FROM locations ORDER BY user_id, updated_at DESC
  ),
  ranked AS (
    SELECT DISTINCT ON (dp.user_id)
      dp.user_id, dp.rating_avg, 0::integer AS provider_priority,
      (6371 * acos(least(1.0, greatest(-1.0,
        cos(radians(_lat::double precision)) * cos(radians(loc.lat)) *
        cos(radians(loc.lng) - radians(_lng::double precision)) +
        sin(radians(_lat::double precision)) * sin(radians(loc.lat))
      ))))::numeric AS distance_km
    FROM public.driver_profiles dp
    JOIN latest loc ON loc.user_id = dp.user_id
    WHERE dp.available = true
      AND dp.status = 'approved'
      AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())
      AND (
        _category IS NULL
        OR (
          _category IN ('economy', 'premium', 'luxury')
          AND CASE dp.vehicle_category::text
            WHEN 'economy' THEN 1
            WHEN 'premium' THEN 2
            WHEN 'luxury' THEN 3
            ELSE 0
          END >= CASE _category
            WHEN 'economy' THEN 1
            WHEN 'premium' THEN 2
            WHEN 'luxury' THEN 3
            ELSE 99
          END
        )
        OR (_category = 'large' AND dp.vehicle_category::text = 'large')
      )
      AND (
        (_category = 'large' AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = dp.user_id AND ur.role = 'large_driver'::public.app_role
        ))
        OR (_category IS DISTINCT FROM 'large' AND _category IN ('economy', 'premium', 'luxury')
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
  )
  SELECT x.user_id, x.distance_km, x.rating_avg
  FROM ranked x
  WHERE x.distance_km <= least(greatest(coalesce(_radius_km, 5), 0.1), 55)
    AND (
      _category IS DISTINCT FROM 'large'
      OR x.distance_km <= coalesce((
        SELECT least(coalesce(dp.service_radius_km, 25), 55)
        FROM public.driver_profiles dp
        WHERE dp.user_id = x.user_id
      ), 25)
    )
  ORDER BY x.provider_priority DESC, x.distance_km ASC, x.rating_avg DESC NULLS LAST
  LIMIT least(greatest(coalesce(_limit, 10), 1), 1000);
$function$;

CREATE OR REPLACE FUNCTION public.accept_service_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_customer uuid;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.has_role(auth.uid(), 'driver') OR public.has_role(auth.uid(), 'worker')) THEN
    RAISE EXCEPTION 'provider_role_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE b.user_id = auth.uid() AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'user_blocked';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = auth.uid() AND dp.suspended_until IS NOT NULL AND dp.suspended_until > now()
  ) OR EXISTS (
    SELECT 1 FROM public.worker_profiles wp
    WHERE wp.user_id = auth.uid() AND wp.suspended_until IS NOT NULL AND wp.suspended_until > now()
  ) THEN
    RAISE EXCEPTION 'provider_temporarily_suspended';
  END IF;

  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_unavailable'; END IF;

  PERFORM 1 FROM public.request_offers o
  WHERE o.request_id = _request_id AND o.provider_id = auth.uid()
    AND o.status = 'pending' AND o.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_offer_expired'; END IF;

  PERFORM pg_advisory_xact_lock(91840060);
  IF EXISTS (
    SELECT 1 FROM public.service_requests active
    WHERE active.provider_id = auth.uid() AND active.status IN ('accepted', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'لديك طلب نشط بالفعل';
  END IF;

  PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
  UPDATE public.service_requests sr
  SET provider_id = auth.uid(), status = 'accepted', accepted_at = now()
  WHERE sr.id = _request_id
    AND sr.status IN ('pending', 'searching')
    AND sr.provider_id IS NULL
    AND (
      (
        r.type = 'taxi'
        AND r.vehicle_category::text IN ('economy', 'premium', 'luxury')
        AND public.has_role(auth.uid(), 'driver')
        AND EXISTS (
          SELECT 1 FROM public.driver_profiles dp
          WHERE dp.user_id = auth.uid()
            AND CASE dp.vehicle_category::text
              WHEN 'economy' THEN 1
              WHEN 'premium' THEN 2
              WHEN 'luxury' THEN 3
              ELSE 0
            END >= CASE r.vehicle_category::text
              WHEN 'economy' THEN 1
              WHEN 'premium' THEN 2
              WHEN 'luxury' THEN 3
              ELSE 99
            END
            AND dp.vehicle_category::text IN ('economy', 'premium', 'luxury')
            AND dp.status = 'approved'
            AND dp.available = true
            AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())
        )
      )
      OR
      (
        r.type = 'service'
        AND public.has_role(auth.uid(), 'worker')
        AND r.service_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.worker_profiles wp
          WHERE wp.user_id = auth.uid() AND wp.status = 'approved' AND wp.available = true
            AND (wp.suspended_until IS NULL OR wp.suspended_until <= now())
            AND (r.level_required IS NULL OR wp.level = r.level_required)
        )
        AND EXISTS (
          SELECT 1 FROM public.worker_services ws
          WHERE ws.worker_id = auth.uid() AND ws.service_id = r.service_id
        )
      )
    )
  RETURNING sr.customer_id INTO v_customer;
  PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'request_unavailable_or_specialty_mismatch'; END IF;

  INSERT INTO public.chats(request_id, customer_id, provider_id)
  VALUES (_request_id, v_customer, auth.uid())
  ON CONFLICT (request_id)
  DO UPDATE SET provider_id = EXCLUDED.provider_id, updated_at = now();

  UPDATE public.request_offers
  SET status = CASE WHEN provider_id = auth.uid() THEN 'accepted' ELSE 'cancelled' END,
      responded_at = now()
  WHERE request_id = _request_id AND status = 'pending';

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (v_customer, 'request_accepted', 'تم قبول طلبك',
    'مقدّم الخدمة قبل طلبك ويمكنك متابعة التفاصيل الآن.',
    '/request/' || _request_id,
    jsonb_build_object('request_id', _request_id, 'provider_id', auth.uid()));
  RETURN true;
END;
$function$;
