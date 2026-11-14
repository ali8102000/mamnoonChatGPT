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
      IF NEW.customer_price IS NOT NULL
         AND (NEW.customer_price < 250 OR NEW.customer_price > 50000 OR NEW.customer_price % 250 <> 0) THEN
        RAISE EXCEPTION 'السعر المقترح يجب أن يكون من 250 إلى 50000 دينار ومن مضاعفات 250';
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

-- Provider profiles must never become approved merely because a user inserts a row.
-- Both drivers and workers enter pending; only staff approval can activate them.
CREATE OR REPLACE FUNCTION public.guard_provider_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT COALESCE(public.has_admin_access(auth.uid()), false) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending';
      NEW.available := false;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        auth.uid() = OLD.user_id
        AND OLD.status = 'rejected'
        AND NEW.status = 'pending'
      ) THEN
        RAISE EXCEPTION 'status_readonly';
      END IF;
    END IF;

    IF TG_OP = 'UPDATE'
       AND TG_TABLE_NAME = 'driver_profiles'
       AND (
         NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category
         OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
       ) THEN
      RAISE EXCEPTION 'vehicle_change_requires_admin_approval';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.rating_avg IS DISTINCT FROM OLD.rating_avg THEN
      RAISE EXCEPTION 'rating_readonly';
    END IF;

    IF NEW.status <> 'approved' AND NEW.available THEN
      NEW.available := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_provider_status() FROM PUBLIC, anon, authenticated;

-- Large-vehicle providers must be allowed to publish their own live location.
DROP POLICY IF EXISTS "Providers insert own presence" ON public.provider_presence;
CREATE POLICY "Providers insert own presence"
  ON public.provider_presence FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'large_driver'::public.app_role)
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
      OR public.has_role(auth.uid(), 'large_driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'large_driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  );

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
      AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())
      AND (_category IS NULL OR dp.vehicle_category::text = _category)
      AND (
        (_category = 'large' AND public.has_role(dp.user_id, 'large_driver'::public.app_role))
        OR
        (_category IS DISTINCT FROM 'large'
          AND _category IN ('economy', 'premium', 'luxury')
          AND public.has_role(dp.user_id, 'driver'::public.app_role))
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
  WHERE x.distance_km <= LEAST(GREATEST(COALESCE(_radius_km, 5), 0.1), 25)
  ORDER BY x.distance_km ASC, x.rating_avg DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(_limit, 10), 1), 250);
$$;
-- CREATE OR REPLACE preserves the function's existing execution grants.

-- Keep the customer-facing nearby map aligned with the 25 km service/large-vehicle radius.
-- Coordinates remain rounded to three decimals; this RPC is for map preview, not dispatch.
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
    pp.heading::numeric
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
          AND dp.available = true
          AND dp.status = 'approved'
          AND (_category IS NULL OR dp.vehicle_category::text = _category)
          AND (
            (_category = 'large' AND public.has_role(dp.user_id, 'large_driver'))
            OR
            (_category IS DISTINCT FROM 'large' AND public.has_role(dp.user_id, 'driver'))
          )
      ))
      OR
      (_type = 'service' AND EXISTS (
        SELECT 1
        FROM public.worker_profiles wp
        WHERE wp.user_id = pp.user_id
          AND wp.available = true
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
    ))) <= LEAST(GREATEST(COALESCE(_radius_km, 5), 0.1), 25)
  ORDER BY pp.updated_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 30), 1), 30)
$$;
REVOKE ALL ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,int)
  TO authenticated, service_role;

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

  PERFORM 1 FROM public.request_offers o
  WHERE o.request_id = _request_id
    AND o.provider_id = auth.uid()
    AND o.status = 'pending'
    AND o.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_offer_expired'; END IF;

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

-- Offers are changed only through the guarded RPCs, never by direct client UPDATE.
DROP POLICY IF EXISTS "Provider updates own offer" ON public.request_offers;
REVOKE UPDATE ON public.request_offers FROM authenticated;

-- Enforce the price ceiling only when a proposed price is inserted or changed.
-- Legacy historical offers above the new ceiling remain readable and can still be expired.
CREATE OR REPLACE FUNCTION public.guard_request_offer_proposed_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.proposed_price IS NOT NULL
     AND (NEW.proposed_price < 250 OR NEW.proposed_price > 50000 OR NEW.proposed_price % 250 <> 0) THEN
    RAISE EXCEPTION 'سعر العرض يجب أن يكون من 250 إلى 50000 دينار ومن مضاعفات 250';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_request_offer_proposed_price ON public.request_offers;
CREATE TRIGGER trg_guard_request_offer_proposed_price
  BEFORE INSERT OR UPDATE OF proposed_price ON public.request_offers
  FOR EACH ROW EXECUTE FUNCTION public.guard_request_offer_proposed_price();
REVOKE EXECUTE ON FUNCTION public.guard_request_offer_proposed_price() FROM PUBLIC, anon, authenticated;

-- Validate customer_price on later edits too, not only during request creation.
CREATE OR REPLACE FUNCTION public.guard_customer_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('mamnoon.allow_large_vehicle_accept', true) = 'true'
     AND OLD.vehicle_category::text = 'large'
     AND NEW.vehicle_category::text = 'large'
     AND auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS DISTINCT FROM NEW.customer_id THEN RETURN NEW; END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN RAISE EXCEPTION 'customer_id_immutable'; END IF;
  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN RAISE EXCEPTION 'provider_id_readonly_for_customer'; END IF;
  IF NEW.type IS DISTINCT FROM OLD.type THEN RAISE EXCEPTION 'type_immutable'; END IF;
  IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN RAISE EXCEPTION 'service_id_immutable'; END IF;
  IF NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category THEN RAISE EXCEPTION 'vehicle_category_immutable'; END IF;
  IF NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type THEN RAISE EXCEPTION 'vehicle_type_immutable'; END IF;
  IF NEW.price_estimate IS DISTINCT FROM OLD.price_estimate THEN RAISE EXCEPTION 'price_readonly_for_customer'; END IF;
  IF NEW.commission IS DISTINCT FROM OLD.commission THEN RAISE EXCEPTION 'commission_readonly'; END IF;
  IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN RAISE EXCEPTION 'accepted_at_readonly'; END IF;
  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN RAISE EXCEPTION 'completed_at_readonly'; END IF;
  IF NEW.vehicle_category::text = 'large'
     AND NEW.customer_price IS NOT NULL
     AND (NEW.customer_price < 250 OR NEW.customer_price > 50000 OR NEW.customer_price % 250 <> 0) THEN
    RAISE EXCEPTION 'سعر طلب السيارة الكبيرة يجب أن يكون من 250 إلى 50000 دينار ومن مضاعفات 250';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (NEW.status = 'cancelled' AND OLD.status IN ('pending','searching','accepted','in_progress')) THEN
      RAISE EXCEPTION 'invalid_status_transition_for_customer';
    END IF;
    NEW.cancelled_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

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
  IF r.customer_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_offer_on_own_request';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = auth.uid()
      AND dp.available = true
      AND dp.status = 'approved'
      AND dp.vehicle_category::text = 'large'
      AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
  ) THEN RAISE EXCEPTION 'driver_vehicle_not_eligible'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.service_requests
    WHERE provider_id = auth.uid() AND status IN ('accepted','in_progress')
  ) THEN RAISE EXCEPTION 'provider_has_active_request'; END IF;

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

-- Customer acceptance is valid only while the selected large driver remains approved and available.
CREATE OR REPLACE FUNCTION public.accept_large_vehicle_offer(_offer_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.request_offers%ROWTYPE;
  r public.service_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO o FROM public.request_offers WHERE id = _offer_id FOR UPDATE;
  IF NOT FOUND OR o.proposed_price IS NULL OR o.status <> 'pending'
     OR o.expires_at <= now() THEN
    RAISE EXCEPTION 'offer_unavailable';
  END IF;

  SELECT * INTO r FROM public.service_requests WHERE id = o.request_id FOR UPDATE;
  IF NOT FOUND OR r.customer_id <> auth.uid()
     OR r.type <> 'taxi' OR r.vehicle_category::text <> 'large'
     OR r.status NOT IN ('pending','searching') OR r.provider_id IS NOT NULL THEN
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
       WHERE sr.provider_id = o.provider_id AND sr.status IN ('accepted','in_progress')
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
  SET status = CASE WHEN id = _offer_id THEN 'accepted' ELSE 'cancelled' END,
      responded_at = now()
  WHERE request_id = r.id AND status = 'pending';

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
