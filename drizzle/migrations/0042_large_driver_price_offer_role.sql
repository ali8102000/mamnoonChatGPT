-- Mamnoon: large-vehicle price offers belong to the dedicated large_driver role.
-- Keep the eligibility checks tied to the approved large vehicle profile.
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
      offer_message = NULLIF(left(trim(COALESCE(_message, '')), 500), ''),
      status = 'pending',
      sent_at = now(),
      expires_at = now() + interval '24 hours',
      responded_at = NULL
  WHERE request_id = _request_id AND provider_id = auth.uid()
    AND status IN ('pending', 'rejected') AND expires_at > now()
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
