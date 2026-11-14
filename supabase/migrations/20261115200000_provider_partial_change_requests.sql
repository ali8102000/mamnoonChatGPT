-- Preserve previous verification records and allow approved drivers to submit
-- partial vehicle/document changes for administrator review.
BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_verification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_type text NOT NULL,
  snapshot jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_verification_history_user
  ON public.provider_verification_history(user_id, provider_type, changed_at DESC);
ALTER TABLE public.provider_verification_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_verification_history FROM anon, authenticated;
GRANT ALL ON public.provider_verification_history TO service_role;

CREATE OR REPLACE FUNCTION public.archive_provider_verification_before_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    INSERT INTO public.provider_verification_history(user_id, provider_type, snapshot, changed_by)
    VALUES (OLD.user_id, OLD.provider_type, to_jsonb(OLD), auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS provider_verification_archive_before_update ON public.provider_verifications;
CREATE TRIGGER provider_verification_archive_before_update
BEFORE UPDATE ON public.provider_verifications
FOR EACH ROW EXECUTE FUNCTION public.archive_provider_verification_before_update();

ALTER TABLE public.provider_change_requests
  DROP CONSTRAINT IF EXISTS provider_change_requests_payload_check;
ALTER TABLE public.provider_change_requests
  ADD CONSTRAINT provider_change_requests_payload_check CHECK (
    (provider_type = 'worker' AND jsonb_typeof(requested_data->'service_ids') = 'array')
    OR (provider_type = 'driver' AND (
      requested_data->>'vehicle_category' IN ('economy','premium','luxury')
      OR jsonb_typeof(requested_data->'vehicle_update') = 'object'
      OR jsonb_typeof(requested_data->'documents') = 'object'
    ))
    OR (provider_type = 'large_driver' AND (
      requested_data->>'vehicle_type' IN ('kia_cargo','kia_passenger','bus')
      OR jsonb_typeof(requested_data->'vehicle_update') = 'object'
      OR jsonb_typeof(requested_data->'documents') = 'object'
    ))
  );

CREATE OR REPLACE FUNCTION public.submit_provider_change_request(_provider_type text, _requested_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_vehicle jsonb;
  v_documents jsonb;
  v_has_vehicle boolean;
  v_has_documents boolean;
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
      SELECT 1 FROM jsonb_array_elements_text(_requested_data->'service_ids') AS item(value)
      LEFT JOIN public.services s ON s.id = item.value::uuid WHERE s.id IS NULL
    ) THEN RAISE EXCEPTION 'invalid_service_selection'; END IF;
  ELSE
    v_vehicle := _requested_data->'vehicle_update';
    v_documents := _requested_data->'documents';
    v_has_vehicle := jsonb_typeof(v_vehicle) = 'object' AND v_vehicle <> '{}'::jsonb;
    v_has_documents := jsonb_typeof(v_documents) = 'object' AND v_documents <> '{}'::jsonb;
    IF NOT v_has_vehicle AND NOT v_has_documents
       AND NOT (_provider_type = 'driver' AND _requested_data->>'vehicle_category' IN ('economy','premium','luxury'))
       AND NOT (_provider_type = 'large_driver' AND _requested_data->>'vehicle_type' IN ('kia_cargo','kia_passenger','bus')) THEN
      RAISE EXCEPTION 'empty_vehicle_change_request';
    END IF;
    IF v_has_vehicle THEN
      IF (v_vehicle ? 'vehicle_plate' AND length(trim(COALESCE(v_vehicle->>'vehicle_plate',''))) < 2)
         OR (v_vehicle ? 'vehicle_year' AND (v_vehicle->>'vehicle_year') !~ '^[0-9]{4}$')
         OR (v_vehicle ? 'vehicle_category' AND v_vehicle->>'vehicle_category' NOT IN ('economy','premium','luxury'))
         OR (v_vehicle ? 'vehicle_type' AND v_vehicle->>'vehicle_type' NOT IN ('kia_cargo','kia_passenger','bus')) THEN
        RAISE EXCEPTION 'invalid_vehicle_update';
      END IF;
    END IF;
    IF v_has_documents AND EXISTS (
      SELECT 1 FROM jsonb_each_text(v_documents) AS item(kind, path)
      WHERE item.kind NOT IN ('vehicle_document','face_photo','id_card','id_card_back')
         OR item.path IS NULL
         OR item.path NOT LIKE auth.uid()::text || '/' || _provider_type || '/%'
         OR NOT EXISTS (
           SELECT 1 FROM storage.objects o
           WHERE o.bucket_id = 'provider-verification' AND o.name = item.path
             AND (storage.foldername(o.name))[1] = auth.uid()::text
         )
    ) THEN RAISE EXCEPTION 'invalid_verification_document_path'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.driver_profiles
      WHERE user_id = auth.uid() AND status = 'approved'
        AND ((_provider_type = 'driver' AND vehicle_category::text <> 'large')
          OR (_provider_type = 'large_driver' AND vehicle_category::text = 'large'))
    ) THEN RAISE EXCEPTION 'approved_driver_profile_required'; END IF;
  END IF;

  INSERT INTO public.provider_change_requests(user_id, provider_type, requested_data)
  VALUES (auth.uid(), _provider_type, _requested_data) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_provider_change_request(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_provider_change_request(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_provider_change_request(
  _request_id uuid, _status text, _reason text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.provider_change_requests%ROWTYPE;
  v_vehicle jsonb;
  v_documents jsonb;
  v_updated integer;
BEGIN
  PERFORM public.assert_staff('admin');
  IF _status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid_review_status'; END IF;
  IF _status = 'rejected' AND NULLIF(trim(COALESCE(_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'rejection_reason_required';
  END IF;
  SELECT * INTO r FROM public.provider_change_requests
  WHERE id = _request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'change_request_unavailable'; END IF;

  IF _status = 'approved' THEN
    IF r.provider_type = 'worker' THEN
      DELETE FROM public.worker_services WHERE worker_id = r.user_id;
      INSERT INTO public.worker_services(worker_id, service_id)
      SELECT r.user_id, item.value::uuid
      FROM jsonb_array_elements_text(r.requested_data->'service_ids') AS item(value)
      ON CONFLICT (worker_id, service_id) DO NOTHING;
    ELSE
      v_vehicle := COALESCE(r.requested_data->'vehicle_update', '{}'::jsonb);
      IF r.provider_type = 'driver' AND r.requested_data ? 'vehicle_category' THEN
        v_vehicle := v_vehicle || jsonb_build_object('vehicle_category', r.requested_data->>'vehicle_category');
      ELSIF r.provider_type = 'large_driver' AND r.requested_data ? 'vehicle_type' THEN
        v_vehicle := v_vehicle || jsonb_build_object(
          'vehicle_type', r.requested_data->>'vehicle_type',
          'vehicle_model', CASE r.requested_data->>'vehicle_type'
            WHEN 'kia_cargo' THEN 'كيا حمل' WHEN 'kia_passenger' THEN 'كيا ركاب' ELSE 'باص' END
        );
      END IF;
      v_documents := COALESCE(r.requested_data->'documents', '{}'::jsonb);

      UPDATE public.driver_profiles
      SET vehicle_make = CASE WHEN v_vehicle ? 'vehicle_make' THEN v_vehicle->>'vehicle_make' ELSE vehicle_make END,
          vehicle_model = CASE WHEN v_vehicle ? 'vehicle_model' THEN v_vehicle->>'vehicle_model' ELSE vehicle_model END,
          vehicle_year = CASE WHEN v_vehicle ? 'vehicle_year' THEN (v_vehicle->>'vehicle_year')::integer ELSE vehicle_year END,
          vehicle_plate = CASE WHEN v_vehicle ? 'vehicle_plate' THEN v_vehicle->>'vehicle_plate' ELSE vehicle_plate END,
          vehicle_color = CASE WHEN v_vehicle ? 'vehicle_color' THEN v_vehicle->>'vehicle_color' ELSE vehicle_color END,
          vehicle_category = CASE WHEN v_vehicle ? 'vehicle_category' THEN (v_vehicle->>'vehicle_category')::public.vehicle_category ELSE vehicle_category END,
          vehicle_type = CASE WHEN v_vehicle ? 'vehicle_type' THEN v_vehicle->>'vehicle_type' ELSE vehicle_type END
      WHERE user_id = r.user_id AND status = 'approved'
        AND ((r.provider_type = 'driver' AND vehicle_category::text <> 'large')
          OR (r.provider_type = 'large_driver' AND vehicle_category::text = 'large'));
      IF NOT FOUND THEN RAISE EXCEPTION 'approved_driver_profile_not_found'; END IF;

      UPDATE public.provider_verifications
      SET face_photo_path = CASE WHEN v_documents ? 'face_photo' THEN v_documents->>'face_photo' ELSE face_photo_path END,
          id_card_photo_path = CASE WHEN v_documents ? 'id_card' THEN v_documents->>'id_card' ELSE id_card_photo_path END,
          id_card_back_photo_path = CASE WHEN v_documents ? 'id_card_back' THEN v_documents->>'id_card_back' ELSE id_card_back_photo_path END,
          vehicle_document_path = CASE WHEN v_documents ? 'vehicle_document' THEN v_documents->>'vehicle_document' ELSE vehicle_document_path END,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'vehicleMake', v_vehicle->'vehicle_make',
            'vehicleModel', v_vehicle->'vehicle_model',
            'vehicleYear', v_vehicle->'vehicle_year',
            'vehiclePlate', v_vehicle->'vehicle_plate',
            'vehicleColor', v_vehicle->'vehicle_color',
            'vehicleCategory', v_vehicle->'vehicle_category',
            'vehicleType', v_vehicle->'vehicle_type'
          )),
          updated_at = now()
      WHERE user_id = r.user_id AND provider_type = r.provider_type;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_documents <> '{}'::jsonb AND v_updated = 0 THEN
        RAISE EXCEPTION 'provider_verification_record_not_found';
      END IF;
    END IF;
  END IF;

  UPDATE public.provider_change_requests
  SET status = _status,
      rejection_reason = CASE WHEN _status = 'rejected' THEN left(trim(_reason), 500) ELSE NULL END,
      reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = _request_id;

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    r.user_id,
    CASE WHEN _status = 'approved' THEN 'provider_change_approved' ELSE 'provider_change_rejected' END,
    CASE WHEN _status = 'approved' THEN 'تمت الموافقة على تحديث بياناتك' ELSE 'طلب تحديث البيانات يحتاج إلى تعديل' END,
    CASE WHEN _status = 'approved'
      THEN 'وافقت الإدارة على طلب تحديث بيانات المركبة أو المستندات أو الاختصاصات. تم تفعيل التحديث.'
      ELSE 'سبب الرفض: ' || left(trim(_reason), 500) END,
    '/account-settings',
    jsonb_build_object('request_id', r.id, 'provider_type', r.provider_type, 'status', _status)
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_provider_change_request(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_provider_change_request(uuid,text,text) TO authenticated;

COMMIT;
