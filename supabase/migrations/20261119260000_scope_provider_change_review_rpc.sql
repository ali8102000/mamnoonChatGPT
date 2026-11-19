-- Let delegated provider-verification staff review profile changes only
-- within their assigned governorate (or globally when explicitly granted).

CREATE OR REPLACE FUNCTION public.admin_review_provider_change_request(
  _request_id uuid,
  _status text,
  _reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.provider_change_requests%ROWTYPE;
  v_governorate text;
BEGIN
  IF _request_id IS NULL OR _status IS NULL OR _status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid_review_status';
  END IF;
  IF _status='rejected' AND NULLIF(trim(coalesce(_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'rejection_reason_required';
  END IF;

  SELECT * INTO r FROM public.provider_change_requests
  WHERE id=_request_id AND status='pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'change_request_unavailable'; END IF;

  SELECT governorate_key INTO v_governorate
  FROM public.profiles WHERE id=r.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider_user_not_found'; END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission(
      'providers.verify',
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    )
  ) THEN
    RAISE EXCEPTION 'permission_required:providers.verify';
  END IF;

  IF _status='approved' THEN
    IF r.provider_type='worker' THEN
      DELETE FROM public.worker_services WHERE worker_id=r.user_id;
      INSERT INTO public.worker_services(worker_id,service_id)
      SELECT r.user_id,item.value::uuid
      FROM jsonb_array_elements_text(r.requested_data->'service_ids') AS item(value)
      ON CONFLICT(worker_id,service_id) DO NOTHING;
    ELSIF r.provider_type='driver' THEN
      UPDATE public.driver_profiles
      SET vehicle_category=(r.requested_data->>'vehicle_category')::public.vehicle_category,
          vehicle_type=NULL
      WHERE user_id=r.user_id AND vehicle_category::text<>'large' AND status='approved';
      IF NOT FOUND THEN RAISE EXCEPTION 'approved_taxi_profile_not_found'; END IF;
    ELSIF r.provider_type='large_driver' THEN
      UPDATE public.driver_profiles
      SET vehicle_type=r.requested_data->>'vehicle_type',
          vehicle_model=CASE r.requested_data->>'vehicle_type'
            WHEN 'kia_cargo' THEN 'كيا حمل'
            WHEN 'kia_passenger' THEN 'كيا ركاب'
            ELSE 'باص' END
      WHERE user_id=r.user_id AND vehicle_category::text='large' AND status='approved';
      IF NOT FOUND THEN RAISE EXCEPTION 'approved_large_driver_profile_not_found'; END IF;
    ELSE
      RAISE EXCEPTION 'invalid_provider_type';
    END IF;
  END IF;

  UPDATE public.provider_change_requests
  SET status=_status,
      rejection_reason=CASE WHEN _status='rejected' THEN left(trim(_reason),500) ELSE NULL END,
      reviewed_by=auth.uid(),reviewed_at=now()
  WHERE id=_request_id;

  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  VALUES(
    r.user_id,
    CASE WHEN _status='approved' THEN 'provider_change_approved' ELSE 'provider_change_rejected' END,
    CASE WHEN _status='approved' THEN 'تمت الموافقة على تحديث بياناتك' ELSE 'طلب تحديث البيانات يحتاج إلى تعديل' END,
    CASE WHEN _status='approved'
      THEN 'وافقت الإدارة على طلب تحديث الاختصاصات أو فئة المركبة. تم تفعيل التحديث.'
      ELSE 'سبب الرفض: '||left(trim(_reason),500) END,
    '/account-settings',
    jsonb_build_object('request_id',r.id,'provider_type',r.provider_type,'status',_status)
  );
  RETURN true;
END;
$function$;
