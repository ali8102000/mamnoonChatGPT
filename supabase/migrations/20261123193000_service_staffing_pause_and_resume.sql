-- Pause multi-person service staffing after a full dispatch window.
-- Keep accepted providers attached; the customer chooses to confirm the partial team or resume search.
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS staffing_search_paused_at timestamptz;

CREATE OR REPLACE FUNCTION public.resume_service_request_staffing(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_people integer := 0;
  v_target integer := 1;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF r.customer_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.type::text <> 'service' OR r.status NOT IN ('pending', 'searching') THEN
    RAISE EXCEPTION 'request_not_searching';
  END IF;
  IF r.staffing_search_paused_at IS NULL THEN
    RAISE EXCEPTION 'staffing_search_not_paused';
  END IF;

  SELECT COALESCE(sum(team_size), 0)::integer INTO v_people
  FROM public.service_request_providers
  WHERE request_id = _request_id;
  v_target := GREATEST(COALESCE(r.workers_count, 1), 1);
  IF v_people >= v_target THEN RAISE EXCEPTION 'request_fully_staffed'; END IF;

  UPDATE public.service_requests
  SET status = 'searching',
      searching_started_at = now(),
      staffing_search_paused_at = NULL
  WHERE id = _request_id;

  INSERT INTO public.service_dispatch_queue(request_id, stage, next_at)
  VALUES (_request_id, 0, now())
  ON CONFLICT (request_id)
  DO UPDATE SET stage = 0, next_at = now();

  PERFORM public.dispatch_service_request(_request_id);

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    r.customer_id, 'request_staffing_resumed', 'استؤنف البحث عن بقية الفنيين',
    'رجعنا نبحث عن ' || (v_target - v_people)::text || ' أشخاص إضافيين، مع الاحتفاظ بالفنيين المثبّتين.',
    '/request/' || _request_id,
    jsonb_build_object('request_id', _request_id, 'accepted_people_count', v_people,
      'workers_count', v_target, 'remaining_people_count', v_target - v_people)
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.resume_service_request_staffing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resume_service_request_staffing(uuid) TO authenticated;

-- Keep the existing customer-update guard compatible with the explicit staffing-close RPC.
-- Only the pause marker may additionally change during the already-authorized close transition.
DO $staffing_close_guard$
DECLARE
  v_definition text;
  v_old text := 'ARRAY[''status'', ''accepted_at'', ''updated_at'']';
  v_new text := 'ARRAY[''status'', ''accepted_at'', ''updated_at'', ''staffing_search_paused_at'']';
BEGIN
  SELECT pg_get_functiondef('public.guard_customer_request_update()'::regprocedure)
  INTO v_definition;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected customer request guard; refusing staffing-close patch';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END
$staffing_close_guard$;

-- Mark an explicit customer confirmation as a final staffing decision.
CREATE OR REPLACE FUNCTION public.stop_service_request_acceptance(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_people integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF r.customer_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.type::text <> 'service' OR r.status NOT IN ('pending', 'searching') THEN
    RAISE EXCEPTION 'request_not_searching';
  END IF;

  SELECT COALESCE(sum(team_size), 0)::integer INTO v_people
  FROM public.service_request_providers WHERE request_id = _request_id;
  IF v_people < 1 THEN RAISE EXCEPTION 'no_provider_accepted_yet'; END IF;

  PERFORM set_config('mamnoon.allow_service_staffing_close', 'true', true);
  UPDATE public.service_requests
  SET status = 'accepted', accepted_at = now(), staffing_search_paused_at = NULL
  WHERE id = _request_id;
  PERFORM set_config('mamnoon.allow_service_staffing_close', 'false', true);

  DELETE FROM public.service_dispatch_queue WHERE request_id = _request_id;
  UPDATE public.request_offers SET status = 'cancelled', responded_at = now()
  WHERE request_id = _request_id AND status = 'pending';

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  SELECT srp.provider_id, 'request_staffing_closed', 'اكتفى الزبون بالفريق المتوفر',
    'اختار الزبون تثبيت الفريق الحالي وأوقف استقبال فنيين إضافيين.',
    '/request/' || _request_id,
    jsonb_build_object('request_id', _request_id, 'accepted_people_count', v_people,
      'workers_count', r.workers_count)
  FROM public.service_request_providers srp
  WHERE srp.request_id = _request_id;

  RETURN true;
END;
$function$;

-- Replace only the multi-person end-of-cycle branch; single-person cancellation remains unchanged.
DO $migration$
DECLARE
  v_definition text;
  v_start integer;
  v_end integer;
  v_old_marker text := 'IF q.stage >= (6 * GREATEST(COALESCE(r.workers_count, 1), 1)) THEN';
  v_ring_marker text := '-- Three non-overlapping rings across the existing 55 km provider radius,';
  v_replacement text := $replacement$
IF q.stage >= (6 * GREATEST(COALESCE(r.workers_count, 1), 1)) THEN
    IF GREATEST(COALESCE(r.workers_count, 1), 1) > 1 THEN
      DELETE FROM public.service_dispatch_queue WHERE request_id = _request_id;
      UPDATE public.service_requests
      SET staffing_search_paused_at = now()
      WHERE id = _request_id AND status IN ('pending', 'searching');
      UPDATE public.request_offers
      SET status = 'expired', responded_at = now()
      WHERE request_id = _request_id AND status = 'pending';
      INSERT INTO public.notifications(user_id, type, title, body, link, data)
      VALUES (
        r.customer_id, 'request_staffing_search_paused', 'انتهت جولة البحث عن الفنيين',
        'ثبتنا الفنيين الموافقين. تگدر تثبت العدد الحالي أو تكمل البحث عن الأشخاص الناقصين.',
        '/request/' || r.id,
        jsonb_build_object(
          'request_id', r.id,
          'accepted_people_count', COALESCE((SELECT sum(srp.team_size) FROM public.service_request_providers srp WHERE srp.request_id = r.id), 0),
          'workers_count', GREATEST(COALESCE(r.workers_count, 1), 1),
          'remaining_people_count', GREATEST(GREATEST(COALESCE(r.workers_count, 1), 1) - COALESCE((SELECT sum(srp.team_size) FROM public.service_request_providers srp WHERE srp.request_id = r.id), 0), 0)
        )
      );
      RETURN 0;
    ELSE
      DELETE FROM public.service_dispatch_queue WHERE request_id = _request_id;
      UPDATE public.service_requests
      SET status = 'cancelled',
          cancellation_reason = 'dispatch_no_provider',
          cancelled_by = NULL
      WHERE id = _request_id;
      UPDATE public.request_offers
      SET status = 'cancelled', responded_at = now()
      WHERE request_id = _request_id AND status = 'pending';
      INSERT INTO public.notifications(user_id, type, title, body, link, data)
      VALUES (
        r.customer_id, 'request_cancelled', 'عذراً، لم نعثر على فني متاح',
        'بحثنا لدى الفنيين القريبين، لكن لم يقبل أحد الطلب. تگدر تعيد المحاولة بنفس التفاصيل أو ترفع الأجر المقترح.',
        '/request/' || r.id,
        jsonb_build_object('request_id', r.id, 'service_id', r.service_id, 'reason', 'dispatch_no_provider', 'max_radius_km', 55)
      );
      RETURN 0;
    END IF;
  END IF;

  $replacement$;
BEGIN
  SELECT pg_get_functiondef('public.advance_service_dispatch(uuid)'::regprocedure)
  INTO v_definition;
  v_start := position(v_old_marker IN v_definition);
  v_end := position(v_ring_marker IN v_definition);
  IF v_start = 0 OR v_end <= v_start THEN
    RAISE EXCEPTION 'Unexpected advance_service_dispatch definition; refusing to patch';
  END IF;
  v_definition := substr(v_definition, 1, v_start - 1)
    || v_replacement || chr(10)
    || substr(v_definition, v_end);
  EXECUTE v_definition;
END
$migration$;
