-- Repair large-vehicle provider acceptance and allow re-sending an offer after its short dispatch window expires.
-- The request must still be open and the provider must remain eligible.

CREATE OR REPLACE FUNCTION public.accept_large_vehicle_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_customer uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'large_driver') THEN
    RAISE EXCEPTION 'large_driver_role_required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE b.user_id = auth.uid() AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'user_blocked';
  END IF;

  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR r.type::text <> 'taxi' OR r.vehicle_category::text <> 'large'
     OR r.status::text NOT IN ('pending', 'searching') OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;
  IF r.customer_id = auth.uid() THEN RAISE EXCEPTION 'cannot_accept_own_request'; END IF;
  IF COALESCE(r.customer_price, r.customer_payable, r.price_estimate, 0) <= 0 THEN
    RAISE EXCEPTION 'customer_price_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.request_offers o
    WHERE o.request_id = _request_id AND o.provider_id = auth.uid()
      AND o.status IN ('pending', 'rejected')
  ) THEN RAISE EXCEPTION 'request_offer_unavailable'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = auth.uid() AND dp.vehicle_category::text = 'large'
      AND dp.status = 'approved' AND dp.available = true
      AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())
      AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
  ) THEN RAISE EXCEPTION 'large_driver_no_longer_eligible'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.service_requests sr
    WHERE sr.provider_id = auth.uid() AND sr.status IN ('accepted', 'in_progress')
  ) THEN RAISE EXCEPTION 'provider_has_active_request'; END IF;

  PERFORM pg_advisory_xact_lock(91840060);
  PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
  UPDATE public.service_requests sr
  SET provider_id = auth.uid(), status = 'accepted', accepted_at = now(), updated_at = now()
  WHERE sr.id = _request_id AND sr.status IN ('pending', 'searching') AND sr.provider_id IS NULL
  RETURNING sr.customer_id INTO v_customer;
  PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
  IF v_customer IS NULL THEN RAISE EXCEPTION 'request_unavailable'; END IF;

  INSERT INTO public.chats(request_id, customer_id, provider_id)
  VALUES (_request_id, v_customer, auth.uid())
  ON CONFLICT (request_id) DO UPDATE
  SET provider_id = EXCLUDED.provider_id, updated_at = now();

  UPDATE public.request_offers
  SET status = CASE WHEN provider_id = auth.uid() THEN 'accepted' ELSE 'cancelled' END,
      responded_at = now()
  WHERE request_id = _request_id AND status IN ('pending', 'rejected');

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    v_customer, 'request_accepted', 'تم قبول طلب السيارة الكبيرة',
    'قبل صاحب السيارة أجرتك المحددة، ويمكنك متابعة تفاصيل الرحلة الآن.',
    '/request/' || _request_id::text,
    jsonb_build_object('request_id', _request_id, 'provider_id', auth.uid(),
      'accepted_customer_price', COALESCE(r.customer_price, r.customer_payable, r.price_estimate))
  );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_large_vehicle_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_large_vehicle_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_large_vehicle_offer(
  _request_id uuid, _price integer, _message text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_offer uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'large_driver') THEN
    RAISE EXCEPTION 'large_driver_role_required';
  END IF;
  IF _price IS NULL OR _price < 250 OR _price > 50000 OR _price % 250 <> 0 THEN
    RAISE EXCEPTION 'invalid_offer_price';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE b.user_id = auth.uid() AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN RAISE EXCEPTION 'user_blocked'; END IF;

  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR r.type::text <> 'taxi' OR r.vehicle_category::text <> 'large'
     OR r.status::text NOT IN ('pending', 'searching') OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;
  IF r.customer_id = auth.uid() THEN RAISE EXCEPTION 'cannot_offer_on_own_request'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = auth.uid() AND dp.available = true AND dp.status = 'approved'
      AND dp.vehicle_category::text = 'large'
      AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)
      AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())
  ) THEN RAISE EXCEPTION 'driver_vehicle_not_eligible'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_requests sr
    WHERE sr.provider_id = auth.uid() AND sr.status IN ('accepted', 'in_progress')
  ) THEN RAISE EXCEPTION 'provider_has_active_request'; END IF;

  UPDATE public.request_offers
  SET proposed_price = _price,
      offer_message = NULLIF(LEFT(TRIM(COALESCE(_message, '')), 500), ''),
      status = 'pending', sent_at = now(), expires_at = now() + interval '24 hours',
      responded_at = NULL
  WHERE request_id = _request_id AND provider_id = auth.uid()
    AND status IN ('pending', 'rejected')
  RETURNING id INTO v_offer;

  IF v_offer IS NULL THEN RAISE EXCEPTION 'request_offer_expired'; END IF;

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    r.customer_id, 'large_vehicle_price_offer', 'عرض سعر لسيارتك الكبيرة',
    'أرسل صاحب سيارة عرضاً بقيمة ' || _price::text || ' دينار.',
    '/request/' || r.id::text,
    jsonb_build_object('request_id', r.id, 'offer_id', v_offer, 'price_iqd', _price)
  );
  RETURN v_offer;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_large_vehicle_offer(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_large_vehicle_offer(uuid, integer, text) TO authenticated;