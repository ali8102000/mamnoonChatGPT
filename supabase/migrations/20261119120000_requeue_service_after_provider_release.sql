-- When a technician releases an accepted service request before arrival,
-- immediately restart the service dispatch cycle for other eligible technicians.
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

  SELECT id, customer_id, provider_id, status, type, provider_arrived_at
  INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF r.customer_id <> auth.uid() AND r.provider_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF r.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'request_finished'; END IF;
  IF r.provider_arrived_at IS NOT NULL THEN RAISE EXCEPTION 'provider_already_arrived'; END IF;
  IF r.type::text = 'taxi' AND r.status = 'in_progress' THEN
    RAISE EXCEPTION 'taxi_trip_already_started';
  END IF;

  IF r.customer_id = auth.uid() THEN
    UPDATE public.service_requests
    SET status = 'cancelled',
        cancelled_by = auth.uid(),
        cancellation_reason = left(_reason, 500)
    WHERE id = _request_id;

    DELETE FROM public.request_offers WHERE request_id = _request_id;

    IF r.provider_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        r.provider_id,
        'request_cancelled',
        'أُلغي الطلب',
        coalesce(left(_reason, 200), 'ألغى الزبون الطلب'),
        '/request/' || _request_id
      );
    END IF;

    RETURN 'cancelled';
  ELSIF r.provider_id = auth.uid() THEN
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);

    UPDATE public.service_requests
    SET status = 'searching',
        provider_id = NULL,
        accepted_at = NULL,
        cancelled_by = auth.uid(),
        cancellation_reason = left(_reason, 500)
    WHERE id = _request_id;

    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);

    DELETE FROM public.request_offers
    WHERE request_id = _request_id AND provider_id = auth.uid();

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      r.customer_id,
      'provider_released',
      'نبحث عن مقدّم خدمة آخر',
      coalesce(left(_reason, 200), 'اعتذر مقدّم الخدمة'),
      '/request/' || _request_id
    );

    IF r.type::text = 'service' THEN
      INSERT INTO public.service_dispatch_queue (request_id, stage, next_at)
      VALUES (_request_id, 0, now())
      ON CONFLICT (request_id)
      DO UPDATE SET stage = 0, next_at = now();

      PERFORM public.dispatch_service_request(_request_id);
    END IF;

    RETURN 'released';
  END IF;

  RAISE EXCEPTION 'forbidden';
END;
$function$;
