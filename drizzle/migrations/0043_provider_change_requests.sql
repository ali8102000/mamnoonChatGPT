-- Mamnoon: approved providers can request specialty / vehicle changes without
-- changing their current approved profile until an administrator approves.
CREATE TABLE IF NOT EXISTS public.provider_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_type text NOT NULL CHECK (provider_type IN ('driver','large_driver','worker')),
  requested_data jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason text,
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_change_requests_payload_check CHECK (
    (provider_type = 'worker' AND jsonb_typeof(requested_data->'service_ids') = 'array')
    OR
    (provider_type = 'driver' AND requested_data->>'vehicle_category' IN ('economy','premium','luxury'))
    OR
    (provider_type = 'large_driver' AND requested_data->>'vehicle_type' IN ('kia_cargo','kia_passenger','bus'))
  )
);
CREATE INDEX IF NOT EXISTS idx_provider_change_requests_status_created
  ON public.provider_change_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_change_requests_user
  ON public.provider_change_requests(user_id, provider_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_change_requests_one_pending
  ON public.provider_change_requests(user_id, provider_type) WHERE status = 'pending';

ALTER TABLE public.provider_change_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.provider_change_requests TO authenticated;
GRANT ALL ON public.provider_change_requests TO service_role;
CREATE POLICY "Providers read own change requests"
  ON public.provider_change_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_staff_role(auth.uid()));

-- Prevent approved workers from bypassing the separate admin-approval workflow.
DROP POLICY IF EXISTS "Worker inserts own services" ON public.worker_services;
DROP POLICY IF EXISTS "Worker deletes own services" ON public.worker_services;
REVOKE INSERT, UPDATE, DELETE ON public.worker_services FROM authenticated;

-- Initial registration may save specialties once; approved workers must use change requests.
CREATE OR REPLACE FUNCTION public.save_initial_worker_services(_service_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF public.has_role(auth.uid(), 'worker'::public.app_role) THEN
    RAISE EXCEPTION 'use_provider_change_request';
  END IF;
  IF _service_ids IS NULL OR cardinality(_service_ids) = 0 THEN
    RAISE EXCEPTION 'select_at_least_one_specialty';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(_service_ids) AS requested(service_id)
    LEFT JOIN public.services s ON s.id = requested.service_id
    WHERE s.id IS NULL
  ) THEN RAISE EXCEPTION 'invalid_service_selection'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.worker_profiles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'worker_profile_required';
  END IF;
  DELETE FROM public.worker_services WHERE worker_id = auth.uid();
  INSERT INTO public.worker_services(worker_id, service_id)
  SELECT auth.uid(), requested.service_id
  FROM (SELECT DISTINCT unnest(_service_ids) AS service_id) requested
  ON CONFLICT (worker_id, service_id) DO NOTHING;
  RETURN true;
END;
$;
REVOKE ALL ON FUNCTION public.save_initial_worker_services(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_initial_worker_services(uuid[]) TO authenticated;

-- Large drivers need the same private presence permission as taxi drivers.
DROP POLICY IF EXISTS "Providers insert own presence" ON public.provider_presence;
CREATE POLICY "Providers insert own presence"
  ON public.provider_presence FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'large_driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  );
DROP POLICY IF EXISTS "Providers update own presence" ON public.provider_presence;
CREATE POLICY "Providers update own presence"
  ON public.provider_presence FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'large_driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'large_driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  );

CREATE OR REPLACE FUNCTION public.submit_provider_change_request(
  _provider_type text,
  _requested_data jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_service_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _provider_type IS NULL OR _provider_type NOT IN ('driver','large_driver','worker') THEN
    RAISE EXCEPTION 'invalid_provider_type';
  END IF;
  IF _requested_data IS NULL OR jsonb_typeof(_requested_data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_requested_data';
  END IF;
  IF NOT public.has_role(auth.uid(), _provider_type::public.app_role) THEN
    RAISE EXCEPTION 'approved_provider_role_required';
  END IF;

  IF _provider_type = 'worker' THEN
    IF jsonb_typeof(_requested_data->'service_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(_requested_data->'service_ids') = 0 THEN
      RAISE EXCEPTION 'select_at_least_one_specialty';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(_requested_data->'service_ids') AS item(value)
      LEFT JOIN public.services s ON s.id = item.value::uuid
      WHERE s.id IS NULL
    ) THEN RAISE EXCEPTION 'invalid_service_selection'; END IF;
  ELSIF _provider_type = 'driver' THEN
    IF _requested_data->>'vehicle_category' IS NULL
       OR _requested_data->>'vehicle_category' NOT IN ('economy','premium','luxury') THEN
      RAISE EXCEPTION 'invalid_taxi_vehicle_category';
    END IF;
  ELSIF _provider_type = 'large_driver' THEN
    IF _requested_data->>'vehicle_type' IS NULL
       OR _requested_data->>'vehicle_type' NOT IN ('kia_cargo','kia_passenger','bus') THEN
      RAISE EXCEPTION 'invalid_large_vehicle_type';
    END IF;
  END IF;

  INSERT INTO public.provider_change_requests(user_id, provider_type, requested_data)
  VALUES (auth.uid(), _provider_type, COALESCE(_requested_data, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_provider_change_request(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_provider_change_request(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_provider_change_request(
  _request_id uuid,
  _status text,
  _reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.provider_change_requests%ROWTYPE;
  v_service_id uuid;
BEGIN
  PERFORM public.assert_staff('admin');
  IF _status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid_review_status'; END IF;
  IF _status = 'rejected' AND NULLIF(trim(COALESCE(_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'rejection_reason_required';
  END IF;

  SELECT * INTO r FROM public.provider_change_requests
  WHERE id = _request_id AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'change_request_unavailable'; END IF;

  IF _status = 'approved' THEN
    IF r.provider_type = 'worker' THEN
      DELETE FROM public.worker_services WHERE worker_id = r.user_id;
      INSERT INTO public.worker_services(worker_id, service_id)
      SELECT r.user_id, item.value::uuid
      FROM jsonb_array_elements_text(r.requested_data->'service_ids') AS item(value)
      ON CONFLICT (worker_id, service_id) DO NOTHING;
    ELSIF r.provider_type = 'driver' THEN
      UPDATE public.driver_profiles
      SET vehicle_category = (r.requested_data->>'vehicle_category')::public.vehicle_category,
          vehicle_type = NULL
      WHERE user_id = r.user_id AND vehicle_category::text <> 'large'
        AND status = 'approved';
      IF NOT FOUND THEN RAISE EXCEPTION 'approved_taxi_profile_not_found'; END IF;
    ELSIF r.provider_type = 'large_driver' THEN
      UPDATE public.driver_profiles
      SET vehicle_type = r.requested_data->>'vehicle_type',
          vehicle_model = CASE r.requested_data->>'vehicle_type'
            WHEN 'kia_cargo' THEN 'كيا حمل'
            WHEN 'kia_passenger' THEN 'كيا ركاب'
            ELSE 'باص' END
      WHERE user_id = r.user_id AND vehicle_category::text = 'large'
        AND status = 'approved';
      IF NOT FOUND THEN RAISE EXCEPTION 'approved_large_driver_profile_not_found'; END IF;
    END IF;
  END IF;

  UPDATE public.provider_change_requests
  SET status = _status,
      rejection_reason = CASE WHEN _status = 'rejected' THEN left(trim(_reason), 500) ELSE NULL END,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = _request_id;

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    r.user_id,
    CASE WHEN _status = 'approved' THEN 'provider_change_approved' ELSE 'provider_change_rejected' END,
    CASE WHEN _status = 'approved' THEN 'تمت الموافقة على تحديث بياناتك' ELSE 'طلب تحديث البيانات يحتاج إلى تعديل' END,
    CASE WHEN _status = 'approved'
      THEN 'وافقت الإدارة على طلب تحديث الاختصاصات أو فئة المركبة. تم تفعيل التحديث.'
      ELSE 'سبب الرفض: ' || left(trim(_reason), 500) END,
    '/account-settings',
    jsonb_build_object('request_id', r.id, 'provider_type', r.provider_type, 'status', _status)
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_provider_change_request(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_provider_change_request(uuid,text,text) TO authenticated;
