-- Prioritize urgent service and large-vehicle requests without changing the existing offer/accept rules.
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS service_urgency_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS large_vehicle_urgency_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_service_requests_service_urgent_dispatch
  ON public.service_requests (service_urgency_enabled DESC, created_at ASC)
  WHERE type = 'service' AND status IN ('pending', 'searching');

CREATE INDEX IF NOT EXISTS idx_service_requests_large_urgent_dispatch
  ON public.service_requests (large_vehicle_urgency_enabled DESC, created_at ASC)
  WHERE type = 'taxi' AND status IN ('pending', 'searching');

CREATE OR REPLACE FUNCTION public.process_service_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(91840061);
  FOR v_id IN
    SELECT q.request_id
    FROM public.service_dispatch_queue q
    JOIN public.service_requests r ON r.id = q.request_id
    WHERE q.next_at <= now()
    ORDER BY COALESCE(r.urgency_multiplier, 1) DESC, r.service_urgency_enabled DESC, q.next_at, q.request_id
    LIMIT 100
  LOOP
    PERFORM public.advance_service_dispatch(v_id);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.service_dispatch_queue) THEN
    PERFORM cron.unschedule('mamnoon-service-dispatch');
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_service_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_service_dispatch() TO service_role;

CREATE OR REPLACE FUNCTION public.process_taxi_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- Permanent worker: urgent large-vehicle requests are advanced before ordinary requests.
  FOR v_id IN
    SELECT q.request_id
    FROM public.taxi_dispatch_queue q
    JOIN public.service_requests r ON r.id = q.request_id
    WHERE q.next_at <= now()
    ORDER BY
      COALESCE(r.urgency_multiplier, 1) DESC,
      r.large_vehicle_urgency_enabled DESC,
      r.taxi_urgency_enabled DESC,
      q.next_at,
      q.request_id
    LIMIT 100
  LOOP
    BEGIN
      PERFORM public.advance_taxi_dispatch(v_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Taxi dispatch failed for request %: %', v_id, SQLERRM;
      UPDATE public.taxi_dispatch_queue
      SET next_at = now() + interval '30 seconds'
      WHERE request_id = v_id;
    END;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_taxi_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_taxi_dispatch() TO service_role;


-- Permit only the dedicated, authenticated price-raise RPC to change an active customer's offer.
CREATE OR REPLACE FUNCTION public.guard_customer_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Preserve the taxi urgency write path already deployed by the preceding main migration.
  IF current_setting('mamnoon.allow_request_urgency', true) = 'true'
     AND auth.uid() = OLD.customer_id
     AND OLD.customer_id = NEW.customer_id
     AND OLD.provider_id IS NULL AND NEW.provider_id IS NULL
     AND OLD.status IN ('pending','searching')
     AND NEW.status = OLD.status THEN
    IF NEW.type IS DISTINCT FROM OLD.type
       OR NEW.service_id IS DISTINCT FROM OLD.service_id
       OR NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category
       OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
       OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat
       OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng
       OR NEW.dest_lat IS DISTINCT FROM OLD.dest_lat
       OR NEW.dest_lng IS DISTINCT FROM OLD.dest_lng
       OR NEW.commission IS DISTINCT FROM OLD.commission
       OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'request_urgency_immutable_fields_changed';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('mamnoon.allow_request_price_raise', true) = 'true'
     AND auth.uid() = OLD.customer_id
     AND OLD.status IN ('pending', 'searching')
     AND OLD.provider_id IS NULL
     AND NEW.status = OLD.status THEN
    IF (to_jsonb(NEW) - ARRAY['customer_price', 'pricing_mode', 'price_estimate', 'customer_payable', 'taxi_urgency_enabled', 'taxi_urgency_percent', 'updated_at'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['customer_price', 'pricing_mode', 'price_estimate', 'customer_payable', 'taxi_urgency_enabled', 'taxi_urgency_percent', 'updated_at']) THEN
      RAISE EXCEPTION 'request_price_raise_changed_immutable_fields';
    END IF;
    RETURN NEW;
  END IF;

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
    -- Keep the production taxi safeguard from the already-merged wallet/dispatch migration.
    IF NEW.status = 'cancelled'
       AND OLD.type::text = 'taxi'
       AND OLD.status = 'in_progress' THEN
      RAISE EXCEPTION 'taxi_trip_already_started';
    END IF;
    IF NOT (NEW.status = 'cancelled' AND OLD.status IN ('pending','searching','accepted','in_progress')) THEN
      RAISE EXCEPTION 'invalid_status_transition_for_customer';
    END IF;
    NEW.cancelled_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.raise_request_price(_request_id uuid, _price_increase integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_base numeric;
  v_new_price numeric;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _price_increase IS NULL OR _price_increase <= 0
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
  IF r.status NOT IN ('pending', 'searching') OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_no_longer_searching';
  END IF;

  v_base := COALESCE(r.customer_price::numeric, r.price_estimate, 0);
  v_new_price := CASE WHEN v_base > 0 THEN v_base + _price_increase ELSE _price_increase END;

  IF r.type = 'taxi' AND r.vehicle_category::text = 'large' AND v_new_price > 50000 THEN
    RAISE EXCEPTION 'large_vehicle_price_limit';
  END IF;

  UPDATE public.request_offers
  SET status = 'cancelled', responded_at = now()
  WHERE request_id = _request_id AND status = 'pending';

  PERFORM set_config('mamnoon.allow_request_price_raise', 'true', true);
  PERFORM set_config('mamnoon.allow_dispatch_retry', 'true', true);
  UPDATE public.service_requests
  SET customer_price = round(v_new_price)::integer,
      pricing_mode = CASE WHEN r.pricing_mode = 'negotiable' THEN 'fixed' ELSE r.pricing_mode END,
      price_estimate = CASE
        WHEN r.type = 'taxi' AND r.vehicle_category::text <> 'large' THEN v_new_price
        ELSE r.price_estimate
      END,
      customer_payable = CASE
        WHEN r.coupon_id IS NOT NULL THEN GREATEST(v_new_price - COALESCE(r.coupon_discount, 0), 0)
        ELSE v_new_price
      END,
      updated_at = now()
  WHERE id = _request_id;
  PERFORM set_config('mamnoon.allow_request_price_raise', 'false', true);
  PERFORM set_config('mamnoon.allow_dispatch_retry', 'false', true);

  IF r.type = 'taxi' THEN
    INSERT INTO public.taxi_dispatch_queue(request_id, stage, next_at)
    VALUES (_request_id, 0, now())
    ON CONFLICT (request_id) DO UPDATE SET next_at = now();
    v_count := public.advance_taxi_dispatch(_request_id);
  ELSE
    INSERT INTO public.service_dispatch_queue(request_id, stage, next_at)
    VALUES (_request_id, 0, now())
    ON CONFLICT (request_id) DO UPDATE SET next_at = now();
    v_count := public.advance_service_dispatch(_request_id);
  END IF;

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    r.customer_id,
    'request_price_raised',
    'تم رفع سعر طلبك',
    'تم تحديث السعر وإعادة إرسال الطلب للمزودين القريبين.',
    '/request/' || _request_id,
    jsonb_build_object('request_id', _request_id, 'new_price', v_new_price, 'offers_sent', v_count)
  );

  RETURN COALESCE(v_count, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.raise_request_price(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.raise_request_price(uuid, integer) TO authenticated;


-- Taxi urgency is enabled only after the request enters the nearby-driver search screen.
CREATE OR REPLACE FUNCTION public.enable_taxi_request_urgency(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_enabled boolean := false;
  v_percent numeric := 0;
  v_new_price numeric;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND OR r.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'request_not_found_or_forbidden';
  END IF;
  IF r.type <> 'taxi' OR r.vehicle_category::text = 'large'
     OR r.status NOT IN ('pending', 'searching') OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'taxi_request_no_longer_searching';
  END IF;
  IF COALESCE(r.taxi_urgency_enabled, false) THEN
    RETURN 0;
  END IF;

  SELECT urgency_enabled, urgency_max_percent
  INTO v_enabled, v_percent
  FROM public.taxi_pricing_controls
  WHERE governorate_key = 'all';

  IF NOT COALESCE(v_enabled, false) OR COALESCE(v_percent, 0) <= 0 THEN
    RAISE EXCEPTION 'taxi_urgency_not_available';
  END IF;

  v_percent := greatest(0, least(100, v_percent));
  v_new_price := round(COALESCE(r.price_estimate, 0) * (1 + v_percent / 100.0) / 250) * 250;
  IF v_new_price <= COALESCE(r.price_estimate, 0) THEN
    RAISE EXCEPTION 'taxi_urgency_no_price_change';
  END IF;

  UPDATE public.request_offers
  SET status = 'cancelled', responded_at = now()
  WHERE request_id = _request_id AND status = 'pending';

  PERFORM set_config('mamnoon.allow_request_price_raise', 'true', true);
  PERFORM set_config('mamnoon.allow_dispatch_retry', 'true', true);
  UPDATE public.service_requests
  SET taxi_urgency_enabled = true,
      taxi_urgency_percent = v_percent,
      customer_price = round(v_new_price)::integer,
      price_estimate = v_new_price,
      customer_payable = CASE
        WHEN r.coupon_id IS NOT NULL THEN GREATEST(v_new_price - COALESCE(r.coupon_discount, 0), 0)
        ELSE v_new_price
      END,
      updated_at = now()
  WHERE id = _request_id;
  PERFORM set_config('mamnoon.allow_request_price_raise', 'false', true);
  PERFORM set_config('mamnoon.allow_dispatch_retry', 'false', true);

  INSERT INTO public.taxi_dispatch_queue(request_id, stage, next_at)
  VALUES (_request_id, 0, now())
  ON CONFLICT (request_id) DO UPDATE SET next_at = now();
  v_count := public.advance_taxi_dispatch(_request_id);

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    r.customer_id,
    'taxi_urgency_enabled',
    'تم تفعيل الاستعجال',
    'تم تحديث أجرة الرحلة وإعادة إرسال طلبك للسائقين القريبين.',
    '/request/' || _request_id,
    jsonb_build_object('request_id', _request_id, 'urgency_percent', v_percent, 'new_price', v_new_price)
  );

  RETURN COALESCE(v_count, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.enable_taxi_request_urgency(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enable_taxi_request_urgency(uuid) TO authenticated;
