CREATE OR REPLACE FUNCTION public.accept_service_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  IF NOT public.mamnoon_provider_subscription_active(auth.uid()) THEN RAISE EXCEPTION 'subscription_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.user_id = auth.uid() AND (b.expires_at IS NULL OR b.expires_at > now())) THEN
    RAISE EXCEPTION 'user_blocked';
  END IF;
  IF EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = auth.uid() AND dp.suspended_until IS NOT NULL AND dp.suspended_until > now())
     OR EXISTS (SELECT 1 FROM public.worker_profiles wp WHERE wp.user_id = auth.uid() AND wp.suspended_until IS NOT NULL AND wp.suspended_until > now()) THEN
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
  IF EXISTS (SELECT 1 FROM public.service_requests active WHERE active.provider_id = auth.uid() AND active.status IN ('accepted', 'in_progress')) THEN
    RAISE EXCEPTION 'لديك طلب نشط بالفعل';
  END IF;

  UPDATE public.service_requests sr
  SET provider_id = auth.uid(), status = 'accepted', accepted_at = now()
  WHERE sr.id = _request_id AND sr.status IN ('pending', 'searching') AND sr.provider_id IS NULL
    AND (
      (r.type = 'taxi' AND r.vehicle_category::text IS DISTINCT FROM 'large'
       AND public.has_role(auth.uid(), 'driver')
       AND EXISTS (
         SELECT 1 FROM public.driver_profiles dp
         WHERE dp.user_id = auth.uid() AND dp.vehicle_category = r.vehicle_category
           AND dp.vehicle_category::text IN ('economy', 'premium', 'luxury')
           AND dp.status = 'approved' AND dp.available = true
           AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())
       ))
      OR
      (r.type = 'service' AND public.has_role(auth.uid(), 'worker') AND r.service_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.worker_profiles wp
         WHERE wp.user_id = auth.uid() AND wp.status = 'approved' AND wp.available = true
           AND (wp.suspended_until IS NULL OR wp.suspended_until <= now())
           AND (r.level_required IS NULL OR wp.level = r.level_required)
       )
       AND EXISTS (
         SELECT 1 FROM public.worker_services ws
         WHERE ws.worker_id = auth.uid() AND ws.service_id = r.service_id
       ))
    )
  RETURNING sr.customer_id INTO v_customer;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'request_unavailable_or_specialty_mismatch'; END IF;

  INSERT INTO public.chats(request_id, customer_id, provider_id)
  VALUES (_request_id, v_customer, auth.uid())
  ON CONFLICT (request_id) DO UPDATE
  SET provider_id = EXCLUDED.provider_id, updated_at = now();

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

DROP POLICY IF EXISTS "Workers see offered service requests" ON public.service_requests;
CREATE POLICY "Workers see offered service requests"
ON public.service_requests
FOR SELECT
TO authenticated
USING (
  type = 'service'::public.request_type
  AND status IN ('pending'::public.request_status, 'searching'::public.request_status)
  AND public.has_role((SELECT auth.uid()), 'worker'::public.app_role)
  AND service_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.worker_profiles wp
    JOIN public.worker_services ws ON ws.worker_id = wp.user_id
    WHERE wp.user_id = (SELECT auth.uid())
      AND ws.service_id = service_requests.service_id
      AND wp.status = 'approved'
      AND wp.available = true
      AND (wp.suspended_until IS NULL OR wp.suspended_until <= now())
      AND (service_requests.level_required IS NULL OR wp.level = service_requests.level_required)
  )
  AND public.has_offer(id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "Provider sees own offers" ON public.request_offers;
CREATE POLICY "Provider sees own offers"
ON public.request_offers
FOR SELECT
TO authenticated
USING (
  (provider_id = (SELECT auth.uid()))
  OR public.has_staff_role((SELECT auth.uid()))
);
