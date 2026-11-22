-- Multi-provider service requests with provider team-size snapshots.
-- Taxi acceptance and taxi dispatch are intentionally unchanged.

ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS team_size integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.worker_profiles'::regclass
      AND conname = 'worker_profiles_team_size_range'
  ) THEN
    ALTER TABLE public.worker_profiles
      ADD CONSTRAINT worker_profiles_team_size_range CHECK (team_size BETWEEN 1 AND 10);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.service_request_providers (
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_size integer NOT NULL CHECK (team_size BETWEEN 1 AND 10),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, provider_id)
);

CREATE INDEX IF NOT EXISTS service_request_providers_provider_active_idx
  ON public.service_request_providers(provider_id, request_id);

ALTER TABLE public.service_request_providers ENABLE ROW LEVEL SECURITY;

DO $realtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'service_request_providers'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_request_providers;
  END IF;
END
$realtime$;

CREATE OR REPLACE FUNCTION public.is_service_request_provider(_request_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.service_request_providers srp
    WHERE srp.request_id = _request_id
      AND srp.provider_id = _user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_service_request_provider(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_service_request_provider(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Service request providers see own membership" ON public.service_request_providers;
CREATE POLICY "Service request providers see own membership"
  ON public.service_request_providers FOR SELECT TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.service_requests sr
      WHERE sr.id = service_request_providers.request_id
        AND sr.customer_id = (SELECT auth.uid())
    )
    OR public.has_provider_ops_access((SELECT auth.uid()))
  );

REVOKE INSERT, UPDATE, DELETE ON public.service_request_providers FROM anon, authenticated;

DROP POLICY IF EXISTS "Accepted service providers see request" ON public.service_requests;
CREATE POLICY "Accepted service providers see request"
  ON public.service_requests FOR SELECT TO authenticated
  USING (
    type = 'service'::public.request_type
    AND public.is_service_request_provider(id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Chat participants see chat" ON public.chats;
CREATE POLICY "Chat participants see chat"
  ON public.chats FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = customer_id
    OR (
      (SELECT auth.uid()) = provider_id
      AND NOT EXISTS (
        SELECT 1 FROM public.service_requests sr
        WHERE sr.id = chats.request_id AND sr.type = 'service'::public.request_type
      )
    )
    OR (
      request_id IS NOT NULL
      AND public.is_service_request_provider(request_id, (SELECT auth.uid()))
    )
    OR public.has_chat_moderation_access((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Chat participants read messages" ON public.messages;
CREATE POLICY "Chat participants read messages"
  ON public.messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = messages.chat_id
        AND (
          (SELECT auth.uid()) = c.customer_id
          OR (
            (SELECT auth.uid()) = c.provider_id
            AND NOT EXISTS (
              SELECT 1 FROM public.service_requests sr
              WHERE sr.id = c.request_id AND sr.type = 'service'::public.request_type
            )
          )
          OR public.is_service_request_provider(c.request_id, (SELECT auth.uid()))
        )
    )
    OR public.has_chat_moderation_access((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Chat participants send messages" ON public.messages;
CREATE POLICY "Chat participants send messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = sender_id
    AND EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = messages.chat_id
        AND (
          (SELECT auth.uid()) = c.customer_id
          OR (
            (SELECT auth.uid()) = c.provider_id
            AND NOT EXISTS (
              SELECT 1 FROM public.service_requests sr
              WHERE sr.id = c.request_id AND sr.type = 'service'::public.request_type
            )
          )
          OR public.is_service_request_provider(c.request_id, (SELECT auth.uid()))
        )
    )
  );

DROP POLICY IF EXISTS "Receiver marks read" ON public.messages;
CREATE POLICY "Receiver marks read"
  ON public.messages FOR UPDATE TO authenticated
  USING (
    sender_id <> (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = messages.chat_id
        AND (
          (SELECT auth.uid()) = c.customer_id
          OR (
            (SELECT auth.uid()) = c.provider_id
            AND NOT EXISTS (
              SELECT 1 FROM public.service_requests sr
              WHERE sr.id = c.request_id AND sr.type = 'service'::public.request_type
            )
          )
          OR public.is_service_request_provider(c.request_id, (SELECT auth.uid()))
        )
    )
  )
  WITH CHECK (
    sender_id <> (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = messages.chat_id
        AND (
          (SELECT auth.uid()) = c.customer_id
          OR (
            (SELECT auth.uid()) = c.provider_id
            AND NOT EXISTS (
              SELECT 1 FROM public.service_requests sr
              WHERE sr.id = c.request_id AND sr.type = 'service'::public.request_type
            )
          )
          OR public.is_service_request_provider(c.request_id, (SELECT auth.uid()))
        )
    )
  );

-- Permit only the customer-side "accept current partial team" transition through the existing immutable-request guard.
DO $staffing_guard$
DECLARE
  v_definition text;
  v_begin integer;
  v_patch text := $guard$
  IF current_setting('mamnoon.allow_service_staffing_close', true) = 'true'
     AND auth.uid() = OLD.customer_id
     AND OLD.customer_id = NEW.customer_id
     AND OLD.type::text = 'service'
     AND OLD.status IN ('pending', 'searching')
     AND NEW.status = 'accepted'
     AND NEW.provider_id IS NOT DISTINCT FROM OLD.provider_id
     AND (to_jsonb(NEW) - ARRAY['status', 'accepted_at', 'updated_at'])
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['status', 'accepted_at', 'updated_at']) THEN
    RETURN NEW;
  END IF;

$guard$;
BEGIN
  SELECT pg_get_functiondef('public.guard_customer_request_update()'::regprocedure)
  INTO v_definition;
  v_begin := position('BEGIN' IN v_definition);
  IF v_begin = 0 THEN
    RAISE EXCEPTION 'Unable to locate customer request guard body';
  END IF;
  IF position('mamnoon.allow_service_staffing_close' IN v_definition) = 0 THEN
    v_definition := substr(v_definition, 1, v_begin + length('BEGIN') - 1)
      || chr(10) || v_patch || substr(v_definition, v_begin + length('BEGIN'));
    EXECUTE v_definition;
  END IF;
END
$staffing_guard$;

CREATE OR REPLACE FUNCTION public.accept_service_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_customer uuid;
  v_team_size integer := 1;
  v_people_before integer := 0;
  v_people_after integer := 0;
  v_target integer := 1;
  v_updated integer := 0;
  v_is_first boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF NOT (public.has_role(auth.uid(), 'driver') OR public.has_role(auth.uid(), 'worker')) THEN
    RAISE EXCEPTION 'provider_role_required';
  END IF;
  IF NOT public.mamnoon_provider_subscription_active(auth.uid()) THEN
    RAISE EXCEPTION 'subscription_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE b.user_id = auth.uid() AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN RAISE EXCEPTION 'user_blocked'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = auth.uid() AND dp.suspended_until IS NOT NULL AND dp.suspended_until > now()
  ) OR EXISTS (
    SELECT 1 FROM public.worker_profiles wp
    WHERE wp.user_id = auth.uid() AND wp.suspended_until IS NOT NULL AND wp.suspended_until > now()
  ) THEN RAISE EXCEPTION 'provider_temporarily_suspended'; END IF;

  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_unavailable'; END IF;

  PERFORM 1 FROM public.request_offers o
  WHERE o.request_id = _request_id
    AND o.provider_id = auth.uid()
    AND o.status = 'pending'
    AND o.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_offer_expired'; END IF;

  -- Keep the original one-driver taxi flow intact.
  IF r.type::text = 'taxi' THEN
    PERFORM pg_advisory_xact_lock(91840060);
    IF EXISTS (
      SELECT 1 FROM public.service_requests active
      WHERE active.provider_id = auth.uid()
        AND active.status IN ('accepted', 'in_progress')
    ) OR EXISTS (
      SELECT 1
      FROM public.service_request_providers srp
      JOIN public.service_requests active_service ON active_service.id = srp.request_id
      WHERE srp.provider_id = auth.uid()
        AND active_service.status IN ('pending', 'searching', 'accepted', 'in_progress')
    ) THEN RAISE EXCEPTION 'لديك طلب نشط بالفعل'; END IF;

    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests sr
    SET provider_id = auth.uid(), status = 'accepted', accepted_at = now()
    WHERE sr.id = _request_id
      AND sr.status IN ('pending', 'searching')
      AND sr.provider_id IS NULL
      AND r.type::text = 'taxi'
      AND r.vehicle_category::text IS DISTINCT FROM 'large'
      AND public.has_role(auth.uid(), 'driver')
      AND EXISTS (
        SELECT 1 FROM public.driver_profiles dp
        WHERE dp.user_id = auth.uid()
          AND dp.vehicle_category = r.vehicle_category
          AND dp.vehicle_category::text IN ('economy', 'premium', 'luxury')
          AND dp.status = 'approved' AND dp.available = true
          AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())
      )
    RETURNING sr.customer_id INTO v_customer;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'request_unavailable_or_specialty_mismatch'; END IF;

    INSERT INTO public.chats(request_id, customer_id, provider_id)
    VALUES (_request_id, v_customer, auth.uid())
    ON CONFLICT (request_id)
    DO UPDATE SET provider_id = EXCLUDED.provider_id, updated_at = now();

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
  END IF;

  IF r.type::text <> 'service' THEN
    RAISE EXCEPTION 'unsupported_request_type';
  END IF;
  IF r.status NOT IN ('pending', 'searching') THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 91840060));
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text, 91840061));

  IF EXISTS (
    SELECT 1
    FROM public.service_request_providers active_provider
    JOIN public.service_requests active_request ON active_request.id = active_provider.request_id
    WHERE active_provider.provider_id = auth.uid()
      AND active_request.id <> _request_id
      AND active_request.status IN ('pending', 'searching', 'accepted', 'in_progress')
  ) OR EXISTS (
    SELECT 1 FROM public.service_requests active_request
    WHERE active_request.provider_id = auth.uid()
      AND active_request.id <> _request_id
      AND active_request.type::text = 'taxi'
      AND active_request.status IN ('accepted', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'لديك طلب نشط بالفعل';
  END IF;

  SELECT COALESCE(wp.team_size, 1) INTO v_team_size
  FROM public.worker_profiles wp
  WHERE wp.user_id = auth.uid()
    AND wp.status = 'approved'
    AND wp.available = true
    AND (wp.suspended_until IS NULL OR wp.suspended_until <= now())
    AND (r.level_required IS NULL OR wp.level = r.level_required);
  IF NOT FOUND THEN RAISE EXCEPTION 'provider_unavailable_or_level_mismatch'; END IF;

  IF r.service_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.worker_services ws
    WHERE ws.worker_id = auth.uid() AND ws.service_id = r.service_id
  ) OR NOT public.has_role(auth.uid(), 'worker') THEN
    RAISE EXCEPTION 'provider_specialty_mismatch';
  END IF;

  SELECT COALESCE(sum(team_size), 0)::integer INTO v_people_before
  FROM public.service_request_providers
  WHERE request_id = _request_id;
  v_target := greatest(COALESCE(r.workers_count, 1), 1);
  IF v_people_before >= v_target THEN RAISE EXCEPTION 'request_fully_staffed'; END IF;

  -- Clamp the final provider's contribution so accepted headcount never exceeds the request.
  v_team_size := LEAST(greatest(v_team_size, 1), v_target - v_people_before);

  INSERT INTO public.service_request_providers(request_id, provider_id, team_size)
  VALUES (_request_id, auth.uid(), v_team_size)
  ON CONFLICT (request_id, provider_id) DO NOTHING;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'provider_already_accepted'; END IF;

  v_people_after := v_people_before + v_team_size;
  v_is_first := r.provider_id IS NULL;
  v_customer := r.customer_id;

  PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
  UPDATE public.service_requests
  SET provider_id = COALESCE(provider_id, auth.uid()),
      status = CASE WHEN v_people_after >= v_target THEN 'accepted'::public.request_status
                    ELSE 'searching'::public.request_status END,
      accepted_at = CASE WHEN v_people_after >= v_target THEN now() ELSE NULL END
  WHERE id = _request_id;
  PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);

  IF v_is_first THEN
    INSERT INTO public.chats(request_id, customer_id, provider_id)
    VALUES (_request_id, v_customer, auth.uid())
    ON CONFLICT (request_id) DO NOTHING;
  END IF;

  UPDATE public.request_offers
  SET status = CASE WHEN provider_id = auth.uid() THEN 'accepted' ELSE 'cancelled' END,
      responded_at = now()
  WHERE request_id = _request_id
    AND provider_id = auth.uid()
    AND status = 'pending';

  IF v_people_after >= v_target THEN
    DELETE FROM public.service_dispatch_queue WHERE request_id = _request_id;
    UPDATE public.request_offers
    SET status = 'cancelled', responded_at = now()
    WHERE request_id = _request_id AND status = 'pending';
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (v_customer, 'request_accepted', 'اكتمل عدد الفنيين',
      'اكتمل العدد المطلوب لطلبك. تگدر تتابع الفريق من تفاصيل الطلب.',
      '/request/' || _request_id,
      jsonb_build_object('request_id', _request_id, 'accepted_people_count', v_people_after,
        'workers_count', v_target, 'remaining_people_count', 0));
  ELSE
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (v_customer, 'request_provider_added', 'انضم فني إلى طلبك',
      'تم تأكيد ' || v_people_after::text || ' من ' || v_target::text ||
      ' أشخاص. المتبقي ' || (v_target - v_people_after)::text || '.',
      '/request/' || _request_id,
      jsonb_build_object('request_id', _request_id, 'accepted_people_count', v_people_after,
        'workers_count', v_target, 'remaining_people_count', v_target - v_people_after));
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_service_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_service_request(uuid) TO authenticated;

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
  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF r.customer_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.type::text <> 'service' OR r.status NOT IN ('pending', 'searching') THEN
    RAISE EXCEPTION 'request_not_searching';
  END IF;

  SELECT COALESCE(sum(team_size), 0)::integer INTO v_people
  FROM public.service_request_providers
  WHERE request_id = _request_id;
  IF v_people < 1 THEN RAISE EXCEPTION 'no_provider_accepted_yet'; END IF;

  PERFORM set_config('mamnoon.allow_service_staffing_close', 'true', true);
  UPDATE public.service_requests
  SET status = 'accepted', accepted_at = now()
  WHERE id = _request_id;
  PERFORM set_config('mamnoon.allow_service_staffing_close', 'false', true);

  DELETE FROM public.service_dispatch_queue WHERE request_id = _request_id;
  UPDATE public.request_offers
  SET status = 'cancelled', responded_at = now()
  WHERE request_id = _request_id AND status = 'pending';

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  SELECT srp.provider_id, 'request_staffing_closed', 'اكتمل العدد المطلوب',
    'الزبون اكتفى بالعدد المتوفر وأوقف استقبال فنيين إضافيين.',
    '/request/' || _request_id,
    jsonb_build_object('request_id', _request_id, 'accepted_people_count', v_people,
      'workers_count', r.workers_count)
  FROM public.service_request_providers srp
  WHERE srp.request_id = _request_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.stop_service_request_acceptance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_service_request_acceptance(uuid) TO authenticated;

-- Keep service dispatch active until the requested headcount is reached.
DO $migration$
DECLARE
  v_definition text;
  v_updated text;
  v_stage_start integer;
  v_ring_start integer;
  v_old_stop text := 'OR r.provider_id IS NOT NULL OR r.service_id IS NULL';
  v_new_stop text := 'OR r.service_id IS NULL OR COALESCE((SELECT sum(srp.team_size) FROM public.service_request_providers srp WHERE srp.request_id = r.id), 0) >= GREATEST(COALESCE(r.workers_count, 1), 1)';
BEGIN
  SELECT pg_get_functiondef('public.advance_service_dispatch(uuid)'::regprocedure)
  INTO v_definition;

  IF position(v_old_stop IN v_definition) = 0
     OR position('IF q.stage >= 6 THEN' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected advance_service_dispatch definition; refusing to patch';
  END IF;

  v_updated := replace(v_definition, v_old_stop, v_new_stop);
  v_updated := replace(v_updated, 'IF q.stage >= 6 THEN',
    'IF q.stage >= (6 * GREATEST(COALESCE(r.workers_count, 1), 1)) THEN');
  -- Do not terminate a multi-person request merely because one search cycle elapsed.
  -- Repeat the configured rings until the requested headcount is reached or the
  -- customer explicitly chooses "اكتفيت بالعدد".
  v_stage_start := position('IF q.stage >= (6 * GREATEST(COALESCE(r.workers_count, 1), 1)) THEN' IN v_updated);
  v_ring_start := position('-- Three non-overlapping rings across the existing 55 km provider radius,' IN v_updated);
  IF v_stage_start = 0 OR v_ring_start <= v_stage_start THEN
    RAISE EXCEPTION 'Unable to locate service dispatch stage guard';
  END IF;
  v_updated := substr(v_updated, 1, v_stage_start - 1)
    || 'IF q.stage >= (6 * GREATEST(COALESCE(r.workers_count, 1), 1)) THEN
    UPDATE public.service_dispatch_queue
    SET stage = 0, next_at = now() + interval ''60 seconds''
    WHERE request_id = _request_id;
    RETURN 0;
  END IF;

  '
    || substr(v_updated, v_ring_start);
  v_updated := replace(v_updated,
    '''workers_count'', r.workers_count,',
    '''workers_count'', r.workers_count, ''accepted_people_count'', COALESCE((SELECT sum(srp.team_size) FROM public.service_request_providers srp WHERE srp.request_id = r.id), 0), ''remaining_people_count'', GREATEST(r.workers_count - COALESCE((SELECT sum(srp.team_size) FROM public.service_request_providers srp WHERE srp.request_id = r.id), 0), 0),');
  v_updated := replace(v_updated,
    ''' د.ع. لديك 60 ثانية لقبول الطلب.'',',
    ''' د.ع. الفريق المؤكد '' || COALESCE((SELECT sum(srp.team_size) FROM public.service_request_providers srp WHERE srp.request_id = r.id), 0)::text || ''، والمتبقي '' || GREATEST(r.workers_count - COALESCE((SELECT sum(srp.team_size) FROM public.service_request_providers srp WHERE srp.request_id = r.id), 0), 0)::text || ''. لديك 60 ثانية لقبول الطلب.'',');
  -- Scale each provider's response window with the requested team size.
  v_updated := replace(v_updated,
    'now(), now() + interval ''60 seconds''',
    'now(), now() + make_interval(secs => 60 * GREATEST(COALESCE(r.workers_count, 1), 1))');
  v_updated := replace(v_updated,
    'expires_at = now() + interval ''60 seconds''',
    'expires_at = now() + make_interval(secs => 60 * GREATEST(COALESCE(r.workers_count, 1), 1))');
  v_updated := replace(v_updated,
    '''expires_in_seconds'', 60',
    '''expires_in_seconds'', 60 * GREATEST(COALESCE(r.workers_count, 1), 1)');
  v_updated := replace(v_updated,
    ''' لديك 60 ثانية لقبول الطلب.''',
    ''' لديك '' || (60 * GREATEST(COALESCE(r.workers_count, 1), 1))::text || '' ثانية لقبول الطلب.''');
  -- Exclude every member of an accepted service team from future dispatch rounds.
  IF position('SELECT 1 FROM public.service_request_providers srp_active' IN v_updated) = 0 THEN
    v_updated := replace(
      v_updated,
      '      AND NOT EXISTS (' || chr(10) || '        SELECT 1 FROM public.user_blocks b',
      '      AND NOT EXISTS (' || chr(10) ||
      '        SELECT 1 FROM public.service_request_providers srp_active' || chr(10) ||
      '        JOIN public.service_requests active_team_request ON active_team_request.id = srp_active.request_id' || chr(10) ||
      '        WHERE srp_active.provider_id = wp.user_id' || chr(10) ||
      '          AND active_team_request.status IN (''pending'', ''searching'', ''accepted'', ''in_progress'')' || chr(10) ||
      '      )' || chr(10) ||
      '      AND NOT EXISTS (' || chr(10) || '        SELECT 1 FROM public.user_blocks b'
    );
    IF position('SELECT 1 FROM public.service_request_providers srp_active' IN v_updated) = 0 THEN
      RAISE EXCEPTION 'Unable to add active service team provider exclusion';
    END IF;
  END IF;
  EXECUTE v_updated;
END
$migration$;


-- Any provider accepted into a service team may operate the shared service request.
CREATE OR REPLACE FUNCTION public.transition_service_request(
  _request_id uuid,
  _status public.request_status,
  _reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v public.service_requests%ROWTYPE;
  v_is_service_member boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;

  v_is_service_member := v.type::text = 'service'
    AND public.is_service_request_provider(_request_id, auth.uid());

  IF _status = 'cancelled' THEN
    PERFORM public.cancel_service_request(_request_id, _reason);
    RETURN true;
  END IF;

  IF v.provider_id IS DISTINCT FROM auth.uid() AND NOT v_is_service_member THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _status = 'in_progress' AND v.status = 'accepted' THEN
    IF (
      v.type::text = 'service'
      OR (v.type::text = 'taxi' AND coalesce(v.vehicle_category::text, '') = 'large')
    ) AND v.provider_arrived_at IS NULL THEN
      RAISE EXCEPTION 'provider_not_arrived';
    END IF;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests SET status = 'in_progress', started_at = now()
    WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    RETURN true;
  END IF;

  IF _status = 'completed' AND v.status = 'in_progress' THEN
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests SET status = 'completed', completed_at = now()
    WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    RETURN true;
  END IF;

  RAISE EXCEPTION 'invalid_status_transition';
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_service_request_arrived(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v public.service_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v.provider_id IS DISTINCT FROM auth.uid()
     AND NOT (v.type::text = 'service' AND public.is_service_request_provider(_request_id, auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v.status <> 'accepted' THEN RAISE EXCEPTION 'invalid_status_transition'; END IF;
  IF v.type::text = 'taxi' AND coalesce(v.vehicle_category::text, '') <> 'large' THEN
    RAISE EXCEPTION 'arrival_confirmation_not_required';
  END IF;
  UPDATE public.service_requests
  SET provider_arrived_at = coalesce(provider_arrived_at, now())
  WHERE id = _request_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_service_request(_request_id uuid, _reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_people integer := 0;
  v_lead uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF r.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'request_finished'; END IF;
  IF r.provider_arrived_at IS NOT NULL THEN RAISE EXCEPTION 'provider_already_arrived'; END IF;
  IF r.type::text = 'service' AND r.status = 'in_progress' THEN RAISE EXCEPTION 'service_already_started'; END IF;
  IF r.type::text = 'taxi' AND r.status = 'in_progress' THEN RAISE EXCEPTION 'taxi_trip_already_started'; END IF;

  IF r.customer_id = auth.uid() THEN
    UPDATE public.service_requests
    SET status = 'cancelled', cancelled_by = auth.uid(),
        cancellation_reason = left(_reason, 500)
    WHERE id = _request_id;
    DELETE FROM public.request_offers WHERE request_id = _request_id;
    INSERT INTO public.notifications(user_id, type, title, body, link)
    SELECT srp.provider_id, 'request_cancelled', 'أُلغي الطلب',
      coalesce(left(_reason, 200), 'ألغى الزبون الطلب'), '/request/' || _request_id
    FROM public.service_request_providers srp WHERE srp.request_id = _request_id;
    IF r.provider_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.service_request_providers srp
         WHERE srp.request_id = _request_id AND srp.provider_id = r.provider_id
       ) THEN
      INSERT INTO public.notifications(user_id, type, title, body, link)
      VALUES (r.provider_id, 'request_cancelled', 'أُلغي الطلب',
        coalesce(left(_reason, 200), 'ألغى الزبون الطلب'), '/request/' || _request_id);
    END IF;
    RETURN 'cancelled';
  END IF;

  IF r.type::text = 'service'
     AND public.is_service_request_provider(_request_id, auth.uid()) THEN
    DELETE FROM public.service_request_providers
    WHERE request_id = _request_id AND provider_id = auth.uid();
    SELECT COALESCE(sum(team_size), 0)::integer INTO v_people
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
        cancellation_reason = left(_reason, 500)
    WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);

    IF v_lead IS NOT NULL THEN
      UPDATE public.chats SET provider_id = v_lead, updated_at = now()
      WHERE request_id = _request_id;
    END IF;
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (r.customer_id, 'provider_released', 'اعتذر أحد الفنيين',
      'اعتذر أحد أفراد الفريق. نواصل البحث عن العدد المتبقي.',
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
        cancelled_by = auth.uid(), cancellation_reason = left(_reason, 500)
    WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    DELETE FROM public.request_offers WHERE request_id = _request_id AND provider_id = auth.uid();
    INSERT INTO public.notifications(user_id, type, title, body, link)
    VALUES (r.customer_id, 'provider_released', 'نبحث عن مقدّم خدمة آخر',
      coalesce(left(_reason, 200), 'اعتذر مقدم الخدمة'), '/request/' || _request_id);
    RETURN 'released';
  END IF;

  RAISE EXCEPTION 'forbidden';
END;
$function$;
