-- Production hardening adapted to the mamnoonChatGPT schema.
-- This is intentionally not a copy of the old project's Supabase migrations.

-- 1) Provider verification: a role alone must never make a provider eligible.
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id);

ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id);

ALTER TABLE public.driver_profiles DROP CONSTRAINT IF EXISTS driver_profiles_verification_status_check;
ALTER TABLE public.driver_profiles ADD CONSTRAINT driver_profiles_verification_status_check
  CHECK (verification_status IN ('pending', 'approved', 'suspended', 'rejected'));
ALTER TABLE public.worker_profiles DROP CONSTRAINT IF EXISTS worker_profiles_verification_status_check;
ALTER TABLE public.worker_profiles ADD CONSTRAINT worker_profiles_verification_status_check
  CHECK (verification_status IN ('pending', 'approved', 'suspended', 'rejected'));

ALTER TABLE public.driver_profiles ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.worker_profiles ALTER COLUMN status SET DEFAULT 'pending';
UPDATE public.driver_profiles SET status = 'pending', available = false WHERE NOT is_verified;
UPDATE public.worker_profiles SET status = 'pending', available = false WHERE NOT is_verified;

DROP TRIGGER IF EXISTS trg_guard_driver_status ON public.driver_profiles;
DROP TRIGGER IF EXISTS trg_guard_worker_status ON public.worker_profiles;

CREATE OR REPLACE FUNCTION public.guard_provider_verification_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_admin_access(auth.uid()) THEN
    IF TG_OP = 'INSERT' AND (
      NEW.is_verified OR NEW.verification_status <> 'pending'
      OR NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL
      OR NEW.status <> 'pending'
    ) THEN
      RAISE EXCEPTION 'verification_admin_only';
    END IF;
    IF TG_OP = 'UPDATE' AND (
      NEW.is_verified IS DISTINCT FROM OLD.is_verified
      OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
      OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
      OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
      OR NEW.status IS DISTINCT FROM OLD.status
    ) THEN
      RAISE EXCEPTION 'verification_admin_only';
    END IF;
  END IF;
  IF NEW.available AND (NOT NEW.is_verified OR NEW.verification_status <> 'approved' OR NEW.status <> 'approved') THEN
    RAISE EXCEPTION 'provider_not_verified';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_provider_verification_fields() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_driver_verification_fields ON public.driver_profiles;
CREATE TRIGGER guard_driver_verification_fields BEFORE INSERT OR UPDATE ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_provider_verification_fields();
DROP TRIGGER IF EXISTS guard_worker_verification_fields ON public.worker_profiles;
CREATE TRIGGER guard_worker_verification_fields BEFORE INSERT OR UPDATE ON public.worker_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_provider_verification_fields();

CREATE OR REPLACE FUNCTION public.admin_set_provider_status(p_user_id uuid, p_type text, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_access(auth.uid()) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_status NOT IN ('approved', 'suspended', 'rejected') THEN RAISE EXCEPTION 'invalid_provider_status'; END IF;
  IF p_type = 'driver' THEN
    UPDATE public.driver_profiles
    SET status = p_status, verification_status = p_status, is_verified = (p_status = 'approved'),
        verified_at = CASE WHEN p_status = 'approved' THEN now() ELSE NULL END,
        verified_by = CASE WHEN p_status = 'approved' THEN auth.uid() ELSE NULL END,
        available = false
    WHERE user_id = p_user_id;
  ELSIF p_type = 'worker' THEN
    UPDATE public.worker_profiles
    SET status = p_status, verification_status = p_status, is_verified = (p_status = 'approved'),
        verified_at = CASE WHEN p_status = 'approved' THEN now() ELSE NULL END,
        verified_by = CASE WHEN p_status = 'approved' THEN auth.uid() ELSE NULL END,
        available = false
    WHERE user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'invalid_provider_type';
  END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'provider_profile_not_found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_provider_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_status(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_provider_verification(_provider_id uuid, _provider_type text, _verified boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_set_provider_status(
    _provider_id, _provider_type, CASE WHEN _verified THEN 'approved' ELSE 'rejected' END
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_set_provider_verification(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_verification(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_driver_profile_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND pg_trigger_depth() = 1 AND NOT public.has_admin_access(auth.uid()) THEN
    IF NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
      OR NEW.ratings_count IS DISTINCT FROM OLD.ratings_count
      OR NEW.completed_rides IS DISTINCT FROM OLD.completed_rides THEN
      RAISE EXCEPTION 'driver_stats_admin_only';
    END IF;
    IF OLD.is_verified AND (
      NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category
      OR NEW.vehicle_make IS DISTINCT FROM OLD.vehicle_make
      OR NEW.vehicle_model IS DISTINCT FROM OLD.vehicle_model
      OR NEW.vehicle_plate IS DISTINCT FROM OLD.vehicle_plate
      OR NEW.vehicle_year IS DISTINCT FROM OLD.vehicle_year
      OR NEW.vehicle_color IS DISTINCT FROM OLD.vehicle_color
    ) THEN RAISE EXCEPTION 'verified_vehicle_change_requires_admin'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_worker_profile_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND pg_trigger_depth() = 1 AND NOT public.has_admin_access(auth.uid()) THEN
    IF NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
      OR NEW.ratings_count IS DISTINCT FROM OLD.ratings_count
      OR NEW.completed_jobs IS DISTINCT FROM OLD.completed_jobs THEN
      RAISE EXCEPTION 'worker_stats_admin_only';
    END IF;
    IF OLD.is_verified AND NEW.level IS DISTINCT FROM OLD.level THEN
      RAISE EXCEPTION 'verified_worker_level_change_requires_admin';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_driver_profile_fields ON public.driver_profiles;
CREATE TRIGGER guard_driver_profile_fields BEFORE UPDATE ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_driver_profile_fields();
DROP TRIGGER IF EXISTS guard_worker_profile_fields ON public.worker_profiles;
CREATE TRIGGER guard_worker_profile_fields BEFORE UPDATE ON public.worker_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_worker_profile_fields();

-- 2) Provider presence: only verified, available drivers/workers can publish fresh coordinates.
CREATE OR REPLACE FUNCTION public.guard_provider_presence_speed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev record; dist_km numeric; dt_sec numeric; v_allowed boolean := false;
BEGIN
  IF NEW.lat IS NULL OR NEW.lng IS NULL OR NEW.lat NOT BETWEEN -90 AND 90 OR NEW.lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'invalid_provider_coordinates';
  END IF;
  IF NEW.heading IS NOT NULL AND NEW.heading NOT BETWEEN 0 AND 360 THEN RAISE EXCEPTION 'invalid_heading'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = NEW.user_id AND dp.available AND dp.is_verified
      AND dp.verification_status = 'approved' AND dp.status = 'approved'
      AND public.has_role(NEW.user_id, 'driver'::public.app_role)
    UNION ALL
    SELECT 1 FROM public.worker_profiles wp
    WHERE wp.user_id = NEW.user_id AND wp.available AND wp.is_verified
      AND wp.verification_status = 'approved' AND wp.status = 'approved'
      AND public.has_role(NEW.user_id, 'worker'::public.app_role)
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'provider_not_verified_or_available'; END IF;

  SELECT lat, lng, updated_at INTO prev FROM public.provider_presence WHERE user_id = NEW.user_id;
  IF FOUND THEN
    dt_sec := GREATEST(1, EXTRACT(EPOCH FROM (now() - prev.updated_at)));
    dist_km := 6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(prev.lat)) * cos(radians(NEW.lat))
      * cos(radians(NEW.lng) - radians(prev.lng))
      + sin(radians(prev.lat)) * sin(radians(NEW.lat))
    )));
    IF (dist_km / dt_sec) * 3600 > 250 AND dist_km > 1 THEN RAISE EXCEPTION 'implausible_provider_speed'; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_provider_presence_speed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS provider_presence_touch ON public.provider_presence;
DROP TRIGGER IF EXISTS guard_provider_presence_speed ON public.provider_presence;
CREATE TRIGGER guard_provider_presence_speed BEFORE INSERT OR UPDATE ON public.provider_presence
  FOR EACH ROW EXECUTE FUNCTION public.guard_provider_presence_speed();

DROP POLICY IF EXISTS "Own presence insert" ON public.provider_presence;
DROP POLICY IF EXISTS "Own presence update" ON public.provider_presence;
DROP POLICY IF EXISTS "Own presence delete" ON public.provider_presence;
CREATE POLICY "Verified providers publish own presence" ON public.provider_presence
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id AND (
      EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = auth.uid()
        AND dp.available AND dp.is_verified AND dp.verification_status = 'approved' AND dp.status = 'approved'
        AND public.has_role(auth.uid(), 'driver'::public.app_role))
      OR EXISTS (SELECT 1 FROM public.worker_profiles wp WHERE wp.user_id = auth.uid()
        AND wp.available AND wp.is_verified AND wp.verification_status = 'approved' AND wp.status = 'approved'
        AND public.has_role(auth.uid(), 'worker'::public.app_role))
    )
  );
CREATE POLICY "Verified providers update own presence" ON public.provider_presence
  FOR UPDATE TO authenticated USING (
    auth.uid() = user_id AND (
      EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = auth.uid()
        AND dp.available AND dp.is_verified AND dp.verification_status = 'approved' AND dp.status = 'approved')
      OR EXISTS (SELECT 1 FROM public.worker_profiles wp WHERE wp.user_id = auth.uid()
        AND wp.available AND wp.is_verified AND wp.verification_status = 'approved' AND wp.status = 'approved')
    )
  ) WITH CHECK (
    auth.uid() = user_id AND (
      EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = auth.uid()
        AND dp.available AND dp.is_verified AND dp.verification_status = 'approved' AND dp.status = 'approved')
      OR EXISTS (SELECT 1 FROM public.worker_profiles wp WHERE wp.user_id = auth.uid()
        AND wp.available AND wp.is_verified AND wp.verification_status = 'approved' AND wp.status = 'approved')
    )
  );
CREATE POLICY "Own presence delete" ON public.provider_presence FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 3) Only verified and recently present drivers may be dispatched or shown as nearby.
CREATE OR REPLACE FUNCTION public.find_nearby_drivers(
  _lat numeric, _lng numeric, _category text, _radius_km numeric DEFAULT 5, _limit int DEFAULT 10
)
RETURNS TABLE(user_id uuid, distance_km numeric, rating_avg numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT x.user_id, x.distance_km, x.rating_avg FROM (
    SELECT dp.user_id, dp.rating_avg,
      (6371 * acos(LEAST(1.0, GREATEST(-1.0,
        cos(radians(_lat)) * cos(radians(pp.lat)) * cos(radians(pp.lng) - radians(_lng))
        + sin(radians(_lat)) * sin(radians(pp.lat))
      ))))::numeric AS distance_km
    FROM public.driver_profiles dp
    JOIN public.provider_presence pp ON pp.user_id = dp.user_id
    WHERE dp.available AND dp.status = 'approved' AND dp.is_verified
      AND dp.verification_status = 'approved'
      AND public.has_role(dp.user_id, 'driver'::public.app_role)
      AND (_category IS NULL OR dp.vehicle_category::text = _category)
      AND pp.updated_at > now() - interval '90 seconds'
      AND NOT EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.provider_id = dp.user_id
        AND sr.status IN ('accepted'::public.request_status, 'in_progress'::public.request_status))
      AND NOT EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.user_id = dp.user_id
        AND (b.expires_at IS NULL OR b.expires_at > now()))
  ) x
  WHERE x.distance_km <= _radius_km
  ORDER BY x.distance_km ASC, x.rating_avg DESC NULLS LAST
  LIMIT LEAST(GREATEST(_limit, 1), 50)
$$;
REVOKE ALL ON FUNCTION public.find_nearby_drivers(numeric,numeric,text,numeric,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_nearby_drivers(numeric,numeric,text,numeric,int) TO service_role;

CREATE OR REPLACE FUNCTION public.find_nearby_provider_pins(
  _lat numeric, _lng numeric, _type text, _category text DEFAULT NULL,
  _service_id uuid DEFAULT NULL, _radius_km numeric DEFAULT 5, _limit int DEFAULT 30
)
RETURNS TABLE(pin_id text, lat numeric, lng numeric, heading numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(pp.user_id::text), pp.lat::numeric, pp.lng::numeric, pp.heading::numeric
  FROM public.provider_presence pp
  WHERE pp.updated_at > now() - interval '90 seconds'
    AND (
      (_type = 'taxi' AND EXISTS (SELECT 1 FROM public.driver_profiles dp
        WHERE dp.user_id = pp.user_id AND dp.available AND dp.status = 'approved'
          AND dp.is_verified AND dp.verification_status = 'approved'
          AND public.has_role(dp.user_id, 'driver'::public.app_role)
          AND (_category IS NULL OR dp.vehicle_category::text = _category)))
      OR
      (_type = 'service' AND EXISTS (SELECT 1 FROM public.worker_profiles wp
        WHERE wp.user_id = pp.user_id AND wp.available AND wp.status = 'approved'
          AND wp.is_verified AND wp.verification_status = 'approved'
          AND public.has_role(wp.user_id, 'worker'::public.app_role)
          AND (_service_id IS NULL OR EXISTS (SELECT 1 FROM public.worker_services ws
            WHERE ws.worker_id = wp.user_id AND ws.service_id = _service_id))))
    )
    AND NOT EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.provider_id = pp.user_id
      AND sr.status IN ('accepted'::public.request_status, 'in_progress'::public.request_status))
    AND NOT EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.user_id = pp.user_id
      AND (b.expires_at IS NULL OR b.expires_at > now()))
    AND 6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(_lat)) * cos(radians(pp.lat)) * cos(radians(pp.lng) - radians(_lng))
      + sin(radians(_lat)) * sin(radians(pp.lat))
    ))) <= _radius_km
  ORDER BY 6371 * acos(LEAST(1.0, GREATEST(-1.0,
    cos(radians(_lat)) * cos(radians(pp.lat)) * cos(radians(pp.lng) - radians(_lng))
    + sin(radians(_lat)) * sin(radians(pp.lat))
  ))) ASC
  LIMIT LEAST(GREATEST(_limit, 1), 100)
$$;
REVOKE ALL ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,int) TO authenticated, service_role;

-- 4) Restrict service requests to workers who are verified, available, fresh and nearby.
CREATE OR REPLACE FUNCTION public.worker_is_near_service_request(_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.service_requests sr
    JOIN public.worker_profiles wp ON wp.user_id = auth.uid()
    JOIN public.provider_presence pp ON pp.user_id = auth.uid()
    WHERE sr.id = _request_id AND sr.type = 'service'
      AND sr.status IN ('pending'::public.request_status, 'searching'::public.request_status)
      AND sr.provider_id IS NULL
      AND public.has_role(auth.uid(), 'worker'::public.app_role)
      AND wp.available AND wp.status = 'approved' AND wp.is_verified
      AND wp.verification_status = 'approved'
      AND pp.updated_at > now() - interval '90 seconds'
      AND (sr.service_id IS NULL OR EXISTS (SELECT 1 FROM public.worker_services ws
        WHERE ws.worker_id = auth.uid() AND ws.service_id = sr.service_id))
      AND sr.pickup_lat IS NOT NULL AND sr.pickup_lng IS NOT NULL
      AND 6371 * acos(LEAST(1.0, GREATEST(-1.0,
        cos(radians(sr.pickup_lat::double precision)) * cos(radians(pp.lat))
        * cos(radians(pp.lng) - radians(sr.pickup_lng::double precision))
        + sin(radians(sr.pickup_lat::double precision)) * sin(radians(pp.lat))
      ))) <= 10
      AND NOT EXISTS (SELECT 1 FROM public.service_requests active_request
        WHERE active_request.provider_id = auth.uid()
          AND active_request.status IN ('accepted'::public.request_status, 'in_progress'::public.request_status))
      AND NOT EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.user_id = auth.uid()
        AND (b.expires_at IS NULL OR b.expires_at > now()))
  )
$$;
REVOKE ALL ON FUNCTION public.worker_is_near_service_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worker_is_near_service_request(uuid) TO authenticated;

DROP POLICY IF EXISTS "Workers see available service requests" ON public.service_requests;
CREATE POLICY "Workers see nearby verified service requests" ON public.service_requests
  FOR SELECT TO authenticated USING (
    type = 'service' AND public.worker_is_near_service_request(id)
  );

-- 5) Prevent direct status/provider mutation and restrict customer inserts to home services.
DROP POLICY IF EXISTS "Customer updates own request" ON public.service_requests;
DROP POLICY IF EXISTS "Provider updates assigned request" ON public.service_requests;
DROP POLICY IF EXISTS "Customer creates own requests" ON public.service_requests;
CREATE POLICY "Customers create own home service requests" ON public.service_requests
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = customer_id
    AND type = 'service'::public.request_type
    AND status = 'pending'::public.request_status
    AND provider_id IS NULL
    AND service_id IS NOT NULL
    AND accepted_at IS NULL AND completed_at IS NULL AND cancelled_by IS NULL
    AND price_estimate IS NULL AND commission IS NULL AND vehicle_category IS NULL
    AND distance_km IS NULL AND duration_min IS NULL AND fare_breakdown IS NULL
    AND pickup_lat BETWEEN -90 AND 90 AND pickup_lng BETWEEN -180 AND 180
    AND workers_count BETWEEN 1 AND 20
    AND pricing_mode IN ('negotiable', 'fixed', 'hourly')
    AND (customer_price IS NULL OR (customer_price >= 0 AND customer_price <= 100000000 AND customer_price % 250 = 0))
    AND (work_hours IS NULL OR work_hours BETWEEN 0.5 AND 24)
    AND length(COALESCE(notes, '')) <= 1000
    AND length(COALESCE(work_description, '')) <= 1000
  );

-- 6) Live location history is visible only to participants during an active request.
DROP POLICY IF EXISTS "Parties read live location" ON public.live_locations;
DROP POLICY IF EXISTS "Owner writes own live location" ON public.live_locations;
DROP POLICY IF EXISTS "Owner updates own live location" ON public.live_locations;
DROP POLICY IF EXISTS "Owner deletes own live location" ON public.live_locations;
CREATE POLICY "Participants read active request locations" ON public.live_locations
  FOR SELECT TO authenticated USING (
    (public.is_request_party(request_id, auth.uid()) OR public.has_staff_role(auth.uid()))
    AND EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.id = request_id
      AND sr.status IN ('accepted'::public.request_status, 'in_progress'::public.request_status))
  );
CREATE POLICY "Participants insert own active location" ON public.live_locations
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id AND EXISTS (
      SELECT 1 FROM public.service_requests sr WHERE sr.id = request_id
        AND sr.status IN ('accepted'::public.request_status, 'in_progress'::public.request_status)
        AND ((sr.customer_id = auth.uid() AND role = 'customer')
          OR (sr.provider_id = auth.uid() AND role = 'provider'))
    )
  );
CREATE POLICY "Participants update own active location" ON public.live_locations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (
    auth.uid() = user_id AND EXISTS (
      SELECT 1 FROM public.service_requests sr WHERE sr.id = request_id
        AND sr.status IN ('accepted'::public.request_status, 'in_progress'::public.request_status)
        AND ((sr.customer_id = auth.uid() AND role = 'customer')
          OR (sr.provider_id = auth.uid() AND role = 'provider'))
    )
  );
CREATE POLICY "Owner deletes own location" ON public.live_locations FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 7) Ratings may only be submitted by a participant after the request is completed.
DROP POLICY IF EXISTS "Participant rates counterparty" ON public.ratings;
CREATE POLICY "Participant rates completed request counterpart" ON public.ratings
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = rater_id
    AND ratee_id <> rater_id
    AND EXISTS (SELECT 1 FROM public.service_requests sr
      WHERE sr.id = request_id AND sr.status = 'completed'::public.request_status
        AND ((sr.customer_id = auth.uid() AND sr.provider_id = ratee_id)
          OR (sr.provider_id = auth.uid() AND sr.customer_id = ratee_id)))
  );

-- 8) Accepting a job is atomic and requires an approved, available, recently-present provider.
CREATE OR REPLACE FUNCTION public.accept_service_request(_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_customer uuid; v_updated integer; r public.service_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.has_role(auth.uid(), 'driver'::public.app_role)
       OR public.has_role(auth.uid(), 'worker'::public.app_role)) THEN
    RAISE EXCEPTION 'provider_role_required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.user_id = auth.uid()
      AND (b.expires_at IS NULL OR b.expires_at > now())) THEN RAISE EXCEPTION 'user_blocked'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':provider-active-request', 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text, 0));
  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('pending'::public.request_status, 'searching'::public.request_status)
     OR r.provider_id IS NOT NULL THEN RAISE EXCEPTION 'request_unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.service_requests active_request WHERE active_request.provider_id = auth.uid()
      AND active_request.status IN ('accepted'::public.request_status, 'in_progress'::public.request_status)) THEN
    RAISE EXCEPTION 'provider_has_active_request';
  END IF;

  IF r.type = 'taxi'::public.request_type THEN
    IF NOT EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = auth.uid()
        AND dp.available AND dp.status = 'approved' AND dp.is_verified AND dp.verification_status = 'approved'
        AND public.has_role(auth.uid(), 'driver'::public.app_role))
      OR NOT EXISTS (SELECT 1 FROM public.provider_presence pp WHERE pp.user_id = auth.uid()
        AND pp.updated_at > now() - interval '90 seconds')
      OR NOT EXISTS (SELECT 1 FROM public.request_offers o WHERE o.request_id = _request_id
        AND o.provider_id = auth.uid() AND o.status = 'pending' AND o.expires_at > now()) THEN
      RAISE EXCEPTION 'request_unavailable';
    END IF;
  ELSE
    IF NOT public.worker_is_near_service_request(_request_id) THEN RAISE EXCEPTION 'request_unavailable'; END IF;
  END IF;

  UPDATE public.service_requests SET provider_id = auth.uid(), status = 'accepted', accepted_at = now()
  WHERE id = _request_id AND provider_id IS NULL
  RETURNING customer_id INTO v_customer;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'request_unavailable'; END IF;

  INSERT INTO public.chats(request_id, customer_id, provider_id)
  VALUES (_request_id, v_customer, auth.uid()) ON CONFLICT (request_id) DO NOTHING;
  UPDATE public.request_offers SET status = 'accepted', responded_at = now()
    WHERE request_id = _request_id AND provider_id = auth.uid() AND status = 'pending';
  UPDATE public.request_offers SET status = 'cancelled', responded_at = now()
    WHERE request_id = _request_id AND provider_id <> auth.uid() AND status = 'pending';
  INSERT INTO public.notifications(user_id, type, title, body, link)
    VALUES (v_customer, 'request_accepted', 'تم قبول طلبك', 'مقدّم الخدمة في الطريق إليك', '/request/' || _request_id);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.accept_service_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_service_request(uuid) TO authenticated;

-- 9) Correct NULL-safe cancellation authorization and remove outstanding offers.
CREATE OR REPLACE FUNCTION public.transition_service_request(
  _request_id uuid, _status public.request_status, _reason text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.service_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v_request FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;

  IF _status = 'cancelled'::public.request_status THEN
    IF auth.uid() IS DISTINCT FROM v_request.customer_id
       AND auth.uid() IS DISTINCT FROM v_request.provider_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF v_request.status IN ('completed'::public.request_status, 'cancelled'::public.request_status) THEN
      RAISE EXCEPTION 'request_finished';
    END IF;
    UPDATE public.service_requests SET status = 'cancelled',
      cancellation_reason = NULLIF(trim(_reason), ''), cancelled_by = auth.uid()
    WHERE id = _request_id;
    DELETE FROM public.request_offers WHERE request_id = _request_id;
    RETURN true;
  END IF;

  IF v_request.provider_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _status = 'in_progress'::public.request_status AND v_request.status = 'accepted'::public.request_status THEN
    UPDATE public.service_requests SET status = 'in_progress', started_at = now() WHERE id = _request_id;
    RETURN true;
  END IF;
  IF _status = 'completed'::public.request_status AND v_request.status = 'in_progress'::public.request_status THEN
    UPDATE public.service_requests SET status = 'completed', completed_at = now() WHERE id = _request_id;
    RETURN true;
  END IF;
  RAISE EXCEPTION 'invalid_status_transition';
END $$;
REVOKE ALL ON FUNCTION public.transition_service_request(uuid, public.request_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_service_request(uuid, public.request_status, text) TO authenticated;

-- 10) Request history index used by rate limits and customer dashboards.
CREATE INDEX IF NOT EXISTS idx_service_requests_customer_type_created
  ON public.service_requests(customer_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_presence_updated_at
  ON public.provider_presence(updated_at DESC);
