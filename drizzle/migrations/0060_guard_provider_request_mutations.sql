-- Protect provider-owned request rows from direct client-side mutation.
-- The only permitted provider writes are the validated acceptance/transition/release RPCs.
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
--> statement-breakpoint
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
  IF NOT (public.has_role(auth.uid(), 'driver') OR public.has_role(auth.uid(), 'worker')) THEN RAISE EXCEPTION 'provider_role_required'; END IF;
  IF NOT public.mamnoon_provider_subscription_active(auth.uid()) THEN RAISE EXCEPTION 'subscription_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.user_id = auth.uid() AND (b.expires_at IS NULL OR b.expires_at > now())) THEN RAISE EXCEPTION 'user_blocked'; END IF;
  IF EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = auth.uid() AND dp.suspended_until IS NOT NULL AND dp.suspended_until > now())
     OR EXISTS (SELECT 1 FROM public.worker_profiles wp WHERE wp.user_id = auth.uid() AND wp.suspended_until IS NOT NULL AND wp.suspended_until > now()) THEN
    RAISE EXCEPTION 'provider_temporarily_suspended';
  END IF;

  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_unavailable'; END IF;

  PERFORM 1 FROM public.request_offers o
  WHERE o.request_id = _request_id AND o.provider_id = auth.uid() AND o.status = 'pending' AND o.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_offer_expired'; END IF;

  PERFORM pg_advisory_xact_lock(91840060);
  IF EXISTS (SELECT 1 FROM public.service_requests active WHERE active.provider_id = auth.uid() AND active.status IN ('accepted', 'in_progress')) THEN
    RAISE EXCEPTION 'لديك طلب نشط بالفعل';
  END IF;

  PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
  UPDATE public.service_requests sr
  SET provider_id = auth.uid(), status = 'accepted', accepted_at = now()
  WHERE sr.id = _request_id AND sr.status IN ('pending', 'searching') AND sr.provider_id IS NULL
    AND (
      (r.type = 'taxi' AND r.vehicle_category::text IS DISTINCT FROM 'large'
        AND public.has_role(auth.uid(), 'driver')
        AND EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = auth.uid()
          AND dp.vehicle_category = r.vehicle_category AND dp.vehicle_category::text IN ('economy', 'premium', 'luxury')
          AND dp.status = 'approved' AND dp.available = true AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())))
      OR
      (r.type = 'service' AND public.has_role(auth.uid(), 'worker') AND r.service_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.worker_profiles wp WHERE wp.user_id = auth.uid()
          AND wp.status = 'approved' AND wp.available = true AND (wp.suspended_until IS NULL OR wp.suspended_until <= now())
          AND (r.level_required IS NULL OR wp.level = r.level_required))
        AND EXISTS (SELECT 1 FROM public.worker_services ws WHERE ws.worker_id = auth.uid() AND ws.service_id = r.service_id))
    )
  RETURNING sr.customer_id INTO v_customer;
  PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'request_unavailable_or_specialty_mismatch'; END IF;

  INSERT INTO public.chats(request_id, customer_id, provider_id)
  VALUES (_request_id, v_customer, auth.uid())
  ON CONFLICT (request_id) DO UPDATE SET provider_id = EXCLUDED.provider_id, updated_at = now();

  UPDATE public.request_offers
  SET status = CASE WHEN provider_id = auth.uid() THEN 'accepted' ELSE 'cancelled' END, responded_at = now()
  WHERE request_id = _request_id AND status = 'pending';

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (v_customer, 'request_accepted', 'تم قبول طلبك', 'مقدّم الخدمة قبل طلبك ويمكنك متابعة التفاصيل الآن.',
    '/request/' || _request_id, jsonb_build_object('request_id', _request_id, 'provider_id', auth.uid()));
  RETURN true;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.cancel_service_request(_request_id uuid, _reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT id, customer_id, provider_id, status INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF r.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'request_finished'; END IF;

  IF r.customer_id = auth.uid() THEN
    UPDATE public.service_requests SET status = 'cancelled', cancelled_by = auth.uid(), cancellation_reason = left(_reason, 500) WHERE id = _request_id;
    DELETE FROM public.request_offers WHERE request_id = _request_id;
    IF r.provider_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (r.provider_id, 'request_cancelled', 'أُلغي الطلب', COALESCE(left(_reason, 200), 'ألغى الزبون الطلب'), '/request/' || _request_id);
    END IF;
    RETURN 'cancelled';
  ELSIF r.provider_id = auth.uid() THEN
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests SET status = 'searching', provider_id = NULL, accepted_at = NULL,
      cancelled_by = auth.uid(), cancellation_reason = left(_reason, 500) WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    DELETE FROM public.request_offers WHERE request_id = _request_id AND provider_id = auth.uid();
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (r.customer_id, 'provider_released', 'نبحث عن مقدّم خدمة آخر', COALESCE(left(_reason, 200), 'اعتذر مقدّم الخدمة'), '/request/' || _request_id);
    RETURN 'released';
  END IF;
  RAISE EXCEPTION 'forbidden';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.transition_service_request(
  _request_id uuid, _status request_status, _reason text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v public.service_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF _status = 'cancelled' THEN PERFORM public.cancel_service_request(_request_id, _reason); RETURN true; END IF;
  IF v.provider_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF _status = 'in_progress' AND v.status = 'accepted' THEN
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests SET status = 'in_progress', started_at = now() WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    RETURN true;
  END IF;

  IF _status = 'completed' AND v.status = 'in_progress' THEN
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests SET status = 'completed', completed_at = now() WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    RETURN true;
  END IF;
  RAISE EXCEPTION 'invalid_status_transition';
END;
$function$;
