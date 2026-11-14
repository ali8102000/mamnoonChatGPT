-- Mamnoon: final safety and consistency fixes for the separated large-driver workflow.
-- Apply after migrations 0040 through 0043. The enum addition in 0040 must be committed first.
BEGIN;

-- Large-vehicle requests require a pickup only. A destination is optional context.
CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_multiplier numeric;
  v_rate numeric;
  v_base_fare numeric;
  v_economy_fare numeric;
  v_vehicle_multiplier numeric := 1;
BEGIN
  IF NEW.type = 'taxi' THEN
    IF NEW.vehicle_category::text = 'large' THEN
      NEW.vehicle_type := COALESCE(
        NEW.vehicle_type,
        CASE WHEN COALESCE(NEW.notes, '') ILIKE '%كيا ركاب%' THEN 'kia_passenger'
             ELSE 'kia_cargo' END
      );
      IF NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL THEN
        RAISE EXCEPTION 'موقع الانطلاق مطلوب';
      END IF;
      NEW.distance_km := NULL;
      NEW.duration_min := NULL;
      NEW.price_estimate := NULL;
      NEW.commission := 0;
      NEW.status := 'searching';
      NEW.searching_started_at := now();
      NEW.pricing_mode := CASE
        WHEN NEW.customer_price IS NOT NULL THEN 'fixed'
        ELSE 'negotiable'
      END;
      RETURN NEW;
    ELSE
      NEW.vehicle_type := NULL;
    END IF;

    IF NEW.distance_km IS NULL OR NEW.distance_km < 0
       OR NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL
       OR NEW.dest_lat IS NULL OR NEW.dest_lng IS NULL THEN
      RAISE EXCEPTION 'مسافة الطريق ونقطتا الانطلاق والوجهة مطلوبة';
    END IF;

    v_rate := CASE WHEN COALESCE(NEW.is_intercity, false) THEN 187.5 ELSE 400 END;
    v_base_fare := NEW.distance_km * v_rate;
    v_multiplier := public.get_taxi_demand_multiplier(
      NEW.pickup_lat, NEW.pickup_lng, NEW.vehicle_category::text
    );
    v_multiplier := LEAST(1.50, GREATEST(0.80, v_multiplier));
    v_economy_fare := v_base_fare * v_multiplier;
    IF COALESCE(NEW.is_intercity, false) OR v_economy_fare >= 10000 THEN
      v_multiplier := LEAST(1.10, GREATEST(0.95, v_multiplier));
      v_economy_fare := v_base_fare * v_multiplier;
    END IF;
    IF NEW.vehicle_category::text = 'premium' THEN
      v_vehicle_multiplier := CASE
        WHEN COALESCE(NEW.is_intercity, false) OR v_economy_fare >= 5000 THEN 1.05
        ELSE 1.10 END;
    ELSIF NEW.vehicle_category::text = 'luxury' THEN
      v_vehicle_multiplier := CASE
        WHEN COALESCE(NEW.is_intercity, false) OR v_economy_fare >= 5000 THEN 1.10
        ELSE 1.25 END;
    END IF;
    NEW.price_estimate := round((v_economy_fare * v_vehicle_multiplier) / 250) * 250;
    NEW.commission := 0;
    NEW.status := 'searching';
    NEW.searching_started_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- A provider can only grant their own role after the corresponding profile is approved.
CREATE OR REPLACE FUNCTION public.grant_provider_role_safe(_role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _role IS NULL OR _role NOT IN ('driver','large_driver','worker') THEN
    RAISE EXCEPTION 'invalid_provider_role';
  END IF;

  IF _role = 'driver' AND NOT EXISTS (
    SELECT 1 FROM public.driver_profiles
    WHERE user_id = auth.uid()
      AND vehicle_category::text IN ('economy','premium','luxury')
      AND status = 'approved'
  ) THEN RAISE EXCEPTION 'approved_taxi_profile_required'; END IF;

  IF _role = 'large_driver' AND NOT EXISTS (
    SELECT 1 FROM public.driver_profiles
    WHERE user_id = auth.uid()
      AND vehicle_category::text = 'large'
      AND status = 'approved'
  ) THEN RAISE EXCEPTION 'large_driver_profile_required'; END IF;

  IF _role = 'worker' AND NOT EXISTS (
    SELECT 1 FROM public.worker_profiles
    WHERE user_id = auth.uid() AND status = 'approved'
  ) THEN RAISE EXCEPTION 'approved_worker_profile_required'; END IF;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (auth.uid(), _role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_provider_role_safe(public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_provider_role_safe(public.app_role) TO authenticated;

-- Keep nearby discovery aligned with the separated taxi and large-driver roles.
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
SET search_path = public
AS $$
  SELECT x.user_id, x.distance_km, x.rating_avg
  FROM (
    SELECT DISTINCT ON (dp.user_id)
      dp.user_id,
      dp.rating_avg,
      (6371 * acos(LEAST(1.0, GREATEST(-1.0,
        cos(radians(_lat)) * cos(radians(loc.lat))
        * cos(radians(loc.lng) - radians(_lng))
        + sin(radians(_lat)) * sin(radians(loc.lat))
      ))))::numeric AS distance_km
    FROM public.driver_profiles dp
    JOIN (
      SELECT pp.user_id, pp.lat, pp.lng, pp.updated_at
      FROM public.provider_presence pp
      UNION ALL
      SELECT ll.user_id, ll.lat, ll.lng, ll.updated_at
      FROM public.live_locations ll
    ) loc ON loc.user_id = dp.user_id
    WHERE dp.available = true
      AND dp.status = 'approved'
      AND (_category IS NULL OR dp.vehicle_category::text = _category)
      AND (
        (_category = 'large' AND public.has_role(dp.user_id, 'large_driver'))
        OR
        (_category IS DISTINCT FROM 'large' AND public.has_role(dp.user_id, 'driver'))
      )
      AND loc.updated_at > now() - interval '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.service_requests sr
        WHERE sr.provider_id = dp.user_id AND sr.status IN ('accepted','in_progress')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE b.user_id = dp.user_id
          AND (b.expires_at IS NULL OR b.expires_at > now())
      )
    ORDER BY dp.user_id, loc.updated_at DESC
  ) x
  WHERE x.distance_km <= _radius_km
  ORDER BY x.distance_km ASC, x.rating_avg DESC NULLS LAST
  LIMIT _limit;
$$;
REVOKE ALL ON FUNCTION public.find_nearby_drivers(numeric,numeric,text,numeric,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_nearby_drivers(numeric,numeric,text,numeric,integer) TO authenticated, service_role;

-- Large drivers submit offers; they do not directly accept standard taxi/service requests.
CREATE OR REPLACE FUNCTION public.accept_service_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer uuid;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (
    public.has_role(auth.uid(), 'driver')
    OR public.has_role(auth.uid(), 'worker')
  ) THEN RAISE EXCEPTION 'provider_role_required'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE b.user_id = auth.uid()
      AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN RAISE EXCEPTION 'user_blocked'; END IF;

  PERFORM pg_advisory_xact_lock(91840060);

  IF EXISTS (
    SELECT 1 FROM public.service_requests
    WHERE provider_id = auth.uid() AND status IN ('accepted','in_progress')
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
    AND status IN ('pending','searching')
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
            AND dp.vehicle_category::text IN ('economy','premium','luxury')
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

-- Enforce the previously requested 50,000 IQD ceiling at the database boundary.
-- NOT VALID avoids blocking deployment if an old historical row is outside the new limit;
-- new inserts and updates are still checked.
ALTER TABLE public.request_offers
  DROP CONSTRAINT IF EXISTS request_offers_proposed_price_max_check;
ALTER TABLE public.request_offers
  ADD CONSTRAINT request_offers_proposed_price_max_check
  CHECK (proposed_price IS NULL OR proposed_price BETWEEN 250 AND 50000) NOT VALID;

CREATE OR REPLACE FUNCTION public.submit_large_vehicle_offer(
  _request_id uuid,
  _price integer,
  _message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.service_requests%ROWTYPE;
  v_offer uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'large_driver') THEN
    RAISE EXCEPTION 'large_driver_role_required';
  END IF;
  IF _price IS NULL OR _price < 250 OR _price > 50000 OR _price % 250 <> 0 THEN
    RAISE EXCEPTION 'السعر يجب أن يكون من 250 إلى 50000 دينار ومن مضاعفات 250';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE b.user_id = auth.uid()
      AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN RAISE EXCEPTION 'user_blocked'; END IF;

  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND OR r.type <> 'taxi' OR r.vehicle_category::text <> 'large'
     OR r.status NOT IN ('pending','searching') OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = auth.uid()
      AND dp.available = true
      AND dp.status = 'approved'
      AND dp.vehicle_category::text = 'large'
      AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
  ) THEN RAISE EXCEPTION 'driver_vehicle_not_eligible'; END IF;

  UPDATE public.request_offers
  SET proposed_price = _price,
      offer_message = NULLIF(left(trim(COALESCE(_message, '')), 500), ''),
      status = 'pending',
      sent_at = now(),
      expires_at = now() + interval '24 hours',
      responded_at = NULL
  WHERE request_id = _request_id
    AND provider_id = auth.uid()
    AND status IN ('pending', 'rejected')
    AND expires_at > now()
  RETURNING id INTO v_offer;

  IF v_offer IS NULL THEN RAISE EXCEPTION 'request_offer_expired'; END IF;

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    r.customer_id,
    'large_vehicle_price_offer',
    'عرض سعر لسيارتك الكبيرة',
    'أرسل صاحب سيارة عرضاً بقيمة ' || _price::text || ' دينار.',
    '/request/' || r.id,
    jsonb_build_object('request_id', r.id, 'offer_id', v_offer, 'price_iqd', _price)
  );
  RETURN v_offer;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_large_vehicle_offer(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_large_vehicle_offer(uuid, integer, text) TO authenticated;

COMMIT;
