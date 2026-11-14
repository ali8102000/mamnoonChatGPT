-- Negotiated pricing and customer-selected driver offers for large Kia requests.
-- Large vehicles remain taxi-role providers, but do not use distance-based fares or auto-accept.

ALTER TABLE public.request_offers
  ADD COLUMN IF NOT EXISTS proposed_price integer,
  ADD COLUMN IF NOT EXISTS offer_message text;

ALTER TABLE public.request_offers
  DROP CONSTRAINT IF EXISTS request_offers_proposed_price_check;
ALTER TABLE public.request_offers
  ADD CONSTRAINT request_offers_proposed_price_check
  CHECK (proposed_price IS NULL OR proposed_price >= 250);

-- Large vehicle requests require pickup/destination coordinates, but never require a route distance.
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
      IF NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL
         OR NEW.dest_lat IS NULL OR NEW.dest_lng IS NULL THEN
        RAISE EXCEPTION 'نقطتا الانطلاق والوجهة مطلوبة';
      END IF;
      NEW.distance_km := NULL;
      NEW.duration_min := NULL;
      NEW.price_estimate := NULL;
      NEW.commission := 0;
      NEW.status := 'searching';
      NEW.searching_started_at := now();
      IF NEW.customer_price IS NOT NULL THEN
        NEW.pricing_mode := 'fixed';
      ELSE
        NEW.pricing_mode := 'negotiable';
      END IF;
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
REVOKE ALL ON FUNCTION public.prepare_taxi_request() FROM PUBLIC, anon, authenticated;

-- Reuse the existing nearby-driver dispatch queue, but keep large-vehicle requests open
-- and give drivers 24 hours to submit a price instead of accepting a fixed fare.
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

  IF r.vehicle_category::text = 'large' THEN
    v_radius := (ARRAY[2,5,10]::numeric[])[LEAST(q.stage, 2) + 1];
    WITH inserted AS (
      INSERT INTO public.request_offers
        (request_id, provider_id, distance_km, status, sent_at, expires_at)
      SELECT
        r.id, d.user_id, d.distance_km, 'pending', now(), now() + interval '24 hours'
      FROM public.find_nearby_drivers(
        r.pickup_lat, r.pickup_lng, 'large', v_radius, 100
      ) d
      JOIN public.driver_profiles dp ON dp.user_id = d.user_id
      WHERE d.user_id <> r.customer_id
        AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
        AND NOT EXISTS (
          SELECT 1 FROM public.request_offers o
          WHERE o.request_id = r.id AND o.provider_id = d.user_id
            AND o.status NOT IN ('expired')
        )
      ORDER BY d.distance_km
      LIMIT 20
      ON CONFLICT (request_id, provider_id) DO UPDATE
        SET status = 'pending', sent_at = now(), expires_at = now() + interval '24 hours',
            responded_at = NULL, proposed_price = NULL, offer_message = NULL
        WHERE public.request_offers.status = 'expired'
      RETURNING provider_id
    )
    INSERT INTO public.notifications (user_id, type, title, body, link, data)
    SELECT
      i.provider_id,
      'ride_offer',
      'طلب سيارة كبيرة جديد',
      'وصل طلب كيا حمل/ركاب. افتح التفاصيل وأرسل سعرك للزبون.',
      '/request/' || r.id,
      jsonb_build_object('request_id', r.id, 'vehicle_type', r.vehicle_type,
                         'pickup_text', r.pickup_text, 'dest_text', r.dest_text,
                         'customer_price', r.customer_price)
    FROM inserted i;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.taxi_dispatch_queue
    SET stage = LEAST(q.stage + 1, 2),
        next_at = now() + CASE WHEN q.stage >= 2 THEN interval '5 minutes' ELSE interval '60 seconds' END
    WHERE request_id = _request_id;
    RETURN v_count;
  END IF;

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
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'driver') THEN
    RAISE EXCEPTION 'driver_role_required';
  END IF;
  IF _price IS NULL OR _price < 250 THEN
    RAISE EXCEPTION 'اكتب سعراً صحيحاً لا يقل عن 250 ديناراً';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE b.user_id = auth.uid() AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN RAISE EXCEPTION 'user_blocked'; END IF;

  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR r.type <> 'taxi' OR r.vehicle_category::text <> 'large'
     OR r.status NOT IN ('pending','searching') OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = auth.uid() AND dp.available = true AND dp.status = 'approved'
      AND dp.vehicle_category::text = 'large'
      AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
  ) THEN RAISE EXCEPTION 'driver_vehicle_not_eligible'; END IF;

  UPDATE public.request_offers
  SET proposed_price = _price,
      offer_message = NULLIF(left(trim(COALESCE(_message, '')), 500), '')
  WHERE request_id = _request_id AND provider_id = auth.uid()
    AND status = 'pending' AND expires_at > now()
  RETURNING id INTO v_offer;
  IF v_offer IS NULL THEN RAISE EXCEPTION 'request_offer_expired'; END IF;

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    r.customer_id, 'large_vehicle_price_offer', 'عرض سعر لسيارتك الكبيرة',
    'أرسل صاحب سيارة عرضاً بقيمة ' || _price::text || ' دينار.',
    '/request/' || r.id,
    jsonb_build_object('request_id', r.id, 'offer_id', v_offer, 'price_iqd', _price)
  );
  RETURN v_offer;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_large_vehicle_offer(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_large_vehicle_offer(uuid, integer, text) TO authenticated;

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
     OR o.expires_at <= now() THEN RAISE EXCEPTION 'offer_unavailable'; END IF;
  SELECT * INTO r FROM public.service_requests WHERE id = o.request_id FOR UPDATE;
  IF NOT FOUND OR r.customer_id <> auth.uid()
     OR r.type <> 'taxi' OR r.vehicle_category::text <> 'large'
     OR r.status NOT IN ('pending','searching') OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_unavailable';
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
    o.provider_id, 'large_vehicle_offer_accepted', 'تم قبول عرض سعرك',
    'وافق الزبون على عرضك. افتح الطلب للتواصل والبدء.',
    '/request/' || r.id,
    jsonb_build_object('request_id', r.id, 'offer_id', _offer_id)
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_large_vehicle_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_large_vehicle_offer(uuid) TO authenticated;

-- Allow only the trusted acceptance RPC to assign a selected large-vehicle provider.
CREATE OR REPLACE FUNCTION public.guard_customer_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $
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
$;

-- Customers may view the public profile card of drivers who have bid on their large request.
DROP POLICY IF EXISTS "Customer views large vehicle bidders" ON public.profiles;
CREATE POLICY "Customer views large vehicle bidders"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.request_offers o
      JOIN public.service_requests r ON r.id = o.request_id
      WHERE o.provider_id = profiles.id
        AND r.customer_id = auth.uid()
        AND r.vehicle_category::text = 'large'
        AND o.proposed_price IS NOT NULL
    )
  );
