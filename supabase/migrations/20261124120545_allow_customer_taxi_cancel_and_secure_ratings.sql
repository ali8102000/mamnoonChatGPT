-- Permit customers to cancel an accepted taxi request before the driver arrives.
-- Keep the guard in place for direct table updates and provider-side attempts.
CREATE OR REPLACE FUNCTION public.guard_no_cancel_after_taxi_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.type::text = 'taxi'
     AND OLD.status::text IN ('accepted','in_progress')
     AND NEW.status::text = 'cancelled'
     AND auth.uid() IS NOT NULL
     AND NOT public.has_admin_access(auth.uid()) THEN
    IF current_setting('mamnoon.allow_customer_taxi_cancel', true) = 'true'
       AND auth.uid() = OLD.customer_id
       AND OLD.status::text = 'accepted' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'taxi_cancellation_disabled_after_acceptance';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_service_request(_request_id uuid, _reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.service_requests%rowtype;
  v_people integer := 0;
  v_lead uuid;
  v_reason text := nullif(left(btrim(coalesce(_reason, '')), 500), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 2 THEN
    RAISE EXCEPTION 'cancellation_reason_required';
  END IF;

  SELECT * INTO r FROM public.service_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF r.customer_id <> auth.uid()
     AND r.provider_id IS DISTINCT FROM auth.uid()
     AND NOT (r.type::text = 'service' AND public.is_service_request_provider(_request_id, auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM 1
  FROM public.payment_transactions
  WHERE request_id = _request_id
    AND purpose = 'service_request'
    AND provider = 'zaincash'
    AND status IN ('pending','paid')
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF r.customer_id <> auth.uid()
     AND r.provider_id IS DISTINCT FROM auth.uid()
     AND NOT (r.type::text = 'service' AND public.is_service_request_provider(_request_id, auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF r.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'request_finished'; END IF;
  IF r.provider_arrived_at IS NOT NULL THEN RAISE EXCEPTION 'provider_already_arrived'; END IF;
  IF r.type::text = 'service' AND r.status = 'in_progress' THEN RAISE EXCEPTION 'service_already_started'; END IF;
  IF r.type::text = 'taxi' AND r.status = 'in_progress' THEN RAISE EXCEPTION 'taxi_trip_already_started'; END IF;

  IF r.customer_id = auth.uid() THEN
    IF r.type::text = 'taxi' AND r.status = 'accepted' THEN
      PERFORM set_config('mamnoon.allow_customer_taxi_cancel', 'true', true);
    END IF;

    UPDATE public.service_requests
    SET status = 'cancelled', cancelled_by = auth.uid(), cancellation_reason = v_reason
    WHERE id = _request_id;

    PERFORM set_config('mamnoon.allow_customer_taxi_cancel', 'false', true);

    DELETE FROM public.request_offers WHERE request_id = _request_id;
    INSERT INTO public.notifications(user_id, type, title, body, link)
    SELECT srp.provider_id, 'request_cancelled', 'أُلغي الطلب',
      left(v_reason, 200), '/request/' || _request_id
    FROM public.service_request_providers srp WHERE srp.request_id = _request_id;

    IF r.provider_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.service_request_providers srp
         WHERE srp.request_id = _request_id AND srp.provider_id = r.provider_id
       ) THEN
      INSERT INTO public.notifications(user_id, type, title, body, link)
      VALUES (r.provider_id, 'request_cancelled', 'أُلغي الطلب',
        left(v_reason, 200), '/request/' || _request_id);
    END IF;
    RETURN 'cancelled';
  END IF;

  IF r.type::text = 'service'
     AND public.is_service_request_provider(_request_id, auth.uid()) THEN
    DELETE FROM public.service_request_providers
    WHERE request_id = _request_id AND provider_id = auth.uid();
    DELETE FROM public.request_offers
    WHERE request_id = _request_id AND provider_id = auth.uid();

    SELECT coalesce(sum(team_size), 0)::integer INTO v_people
    FROM public.service_request_providers WHERE request_id = _request_id;
    SELECT provider_id INTO v_lead
    FROM public.service_request_providers
    WHERE request_id = _request_id
    ORDER BY accepted_at, provider_id LIMIT 1;

    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests
    SET provider_id = v_lead,
        status = CASE WHEN v_people >= greatest(workers_count, 1)
                      THEN 'accepted'::public.request_status
                      ELSE 'searching'::public.request_status END,
        accepted_at = CASE WHEN v_people >= greatest(workers_count, 1)
                           THEN accepted_at ELSE NULL END,
        cancelled_by = auth.uid(),
        cancellation_reason = v_reason
    WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);

    IF v_lead IS NOT NULL THEN
      UPDATE public.chats SET provider_id = v_lead, updated_at = now()
      WHERE request_id = _request_id;
    END IF;

    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (r.customer_id, 'provider_released', 'تغيّر عدد أفراد الفريق',
      CASE WHEN v_people >= greatest(r.workers_count, 1)
        THEN 'اعتذر أحد الفنيين، لكن العدد المطلوب ما زال متوفراً.'
        ELSE 'اعتذر أحد أفراد الفريق. نواصل البحث عن العدد المتبقي.' END,
      '/request/' || _request_id,
      jsonb_build_object('request_id', _request_id, 'accepted_people_count', v_people,
        'workers_count', r.workers_count,
        'remaining_people_count', greatest(r.workers_count - v_people, 0)));

    IF v_people < greatest(r.workers_count, 1) THEN
      INSERT INTO public.service_dispatch_queue(request_id, stage, next_at)
      VALUES (_request_id, 0, now())
      ON CONFLICT (request_id) DO UPDATE SET next_at = now();
      PERFORM public.dispatch_service_request(_request_id);
    END IF;
    RETURN 'released';
  END IF;

  IF r.provider_id = auth.uid() AND r.type::text = 'taxi' THEN
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests
    SET status = 'searching', provider_id = NULL, accepted_at = NULL,
        cancelled_by = auth.uid(), cancellation_reason = v_reason
    WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    DELETE FROM public.request_offers WHERE request_id = _request_id AND provider_id = auth.uid();
    INSERT INTO public.notifications(user_id, type, title, body, link)
    VALUES (r.customer_id, 'provider_released', 'نبحث عن مقدّم خدمة آخر',
      left(v_reason, 200), '/request/' || _request_id);
    RETURN 'released';
  END IF;

  RAISE EXCEPTION 'forbidden';
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_service_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_service_request(uuid, text) TO authenticated;

-- Only the two actual participants (or a member of the assigned service team)
-- can rate one another, and only after the request has been completed.
DROP POLICY IF EXISTS "Participant rates counterparty" ON public.ratings;
DROP POLICY IF EXISTS "Participant rates completed counterparty" ON public.ratings;

CREATE POLICY "Participant rates completed counterparty"
ON public.ratings
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = rater_id
  AND EXISTS (
    SELECT 1
    FROM public.service_requests r
    WHERE r.id = ratings.request_id
      AND r.status = 'completed'
      AND (
        (
          r.customer_id = auth.uid()
          AND (
            r.provider_id = ratings.ratee_id
            OR EXISTS (
              SELECT 1 FROM public.service_request_providers srp
              WHERE srp.request_id = r.id AND srp.provider_id = ratings.ratee_id
            )
          )
        )
        OR
        (
          r.customer_id = ratings.ratee_id
          AND (
            r.provider_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.service_request_providers srp
              WHERE srp.request_id = r.id AND srp.provider_id = auth.uid()
            )
          )
        )
      )
  )
);
