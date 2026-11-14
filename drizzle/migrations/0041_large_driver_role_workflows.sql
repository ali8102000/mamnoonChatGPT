-- Mamnoon: separate large-vehicle providers without moving legacy trip/profile data.
ALTER TABLE public.driver_profiles DROP CONSTRAINT IF EXISTS driver_profiles_vehicle_type_check;
ALTER TABLE public.driver_profiles ADD CONSTRAINT driver_profiles_vehicle_type_check
  CHECK (vehicle_type IS NULL OR vehicle_type IN ('kia_cargo','kia_passenger','bus'));
ALTER TABLE public.service_requests DROP CONSTRAINT IF EXISTS service_requests_vehicle_type_check;
ALTER TABLE public.service_requests ADD CONSTRAINT service_requests_vehicle_type_check
  CHECK (vehicle_type IS NULL OR vehicle_type IN ('kia_cargo','kia_passenger','bus'));

-- Migrate approved existing large-vehicle drivers to the dedicated role.
INSERT INTO public.user_roles(user_id, role)
SELECT user_id, 'large_driver'::public.app_role FROM public.driver_profiles
WHERE vehicle_category::text = 'large' AND status = 'approved'
ON CONFLICT (user_id, role) DO NOTHING;
DELETE FROM public.user_roles ur USING public.driver_profiles dp
WHERE ur.user_id = dp.user_id AND dp.vehicle_category::text = 'large'
  AND ur.role = 'driver'::public.app_role;

CREATE OR REPLACE FUNCTION public.grant_provider_role_safe(_role public.app_role)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _role NOT IN ('driver','large_driver','worker') THEN RAISE EXCEPTION 'invalid_provider_role'; END IF;
  IF _role = 'driver' AND NOT EXISTS (SELECT 1 FROM public.driver_profiles
    WHERE user_id = auth.uid() AND vehicle_category::text <> 'large') THEN RAISE EXCEPTION 'driver_profile_required'; END IF;
  IF _role = 'large_driver' AND NOT EXISTS (SELECT 1 FROM public.driver_profiles
    WHERE user_id = auth.uid() AND vehicle_category::text = 'large' AND status = 'approved') THEN RAISE EXCEPTION 'large_driver_profile_required'; END IF;
  IF _role = 'worker' AND NOT EXISTS (SELECT 1 FROM public.worker_profiles WHERE user_id = auth.uid()) THEN RAISE EXCEPTION 'worker_profile_required'; END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (auth.uid(), _role) ON CONFLICT (user_id, role) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_provider_role_safe(public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_provider_role_safe(public.app_role) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_set_provider_status(uuid,text,text,timestamptz);
CREATE OR REPLACE FUNCTION public.admin_set_provider_status(
  p_user_id uuid, p_type text, p_status text, p_suspended_until timestamptz DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role public.app_role; v_updated integer;
BEGIN
  PERFORM public.assert_staff('admin');
  IF p_status NOT IN ('approved','suspended','rejected','pending') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF p_status = 'suspended' AND p_suspended_until IS NOT NULL AND p_suspended_until <= now() THEN RAISE EXCEPTION 'invalid_suspension_expiry'; END IF;
  IF p_type = 'driver' THEN
    v_role := 'driver';
    UPDATE public.driver_profiles SET status=p_status,
      suspended_until=CASE WHEN p_status='suspended' THEN p_suspended_until ELSE NULL END,
      available=CASE WHEN p_status='approved' THEN available ELSE false END
    WHERE user_id=p_user_id AND vehicle_category::text <> 'large';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSIF p_type = 'large_driver' THEN
    v_role := 'large_driver';
    UPDATE public.driver_profiles SET status=p_status,
      suspended_until=CASE WHEN p_status='suspended' THEN p_suspended_until ELSE NULL END,
      available=CASE WHEN p_status='approved' THEN available ELSE false END
    WHERE user_id=p_user_id AND vehicle_category::text = 'large';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSIF p_type = 'worker' THEN
    v_role := 'worker';
    UPDATE public.worker_profiles SET status=p_status,
      suspended_until=CASE WHEN p_status='suspended' THEN p_suspended_until ELSE NULL END,
      available=CASE WHEN p_status='approved' THEN available ELSE false END
    WHERE user_id=p_user_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSE RAISE EXCEPTION 'invalid_type';
  END IF;
  IF v_updated=0 THEN RAISE EXCEPTION 'provider_profile_not_found'; END IF;
  IF p_status='approved' THEN
    INSERT INTO public.user_roles(user_id,role) VALUES(p_user_id,v_role) ON CONFLICT(user_id,role) DO NOTHING;
  ELSIF p_status IN ('rejected','pending') THEN
    DELETE FROM public.user_roles WHERE user_id=p_user_id AND role=v_role;
  END IF;
  PERFORM public.log_admin_action('set_provider_status',p_type,p_user_id::text,
    jsonb_build_object('status',p_status,'suspended_until',p_suspended_until,
      'granted_role',CASE WHEN p_status='approved' THEN v_role::text ELSE NULL END));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_provider_status(uuid,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_status(uuid,text,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_service_request(_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_customer uuid; v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.has_role(auth.uid(),'driver') OR public.has_role(auth.uid(),'large_driver') OR public.has_role(auth.uid(),'worker'))
    THEN RAISE EXCEPTION 'provider_role_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.user_id=auth.uid() AND (b.expires_at IS NULL OR b.expires_at>now()))
    THEN RAISE EXCEPTION 'user_blocked'; END IF;
  UPDATE public.service_requests
  SET provider_id=auth.uid(),status='accepted',accepted_at=now()
  WHERE id=_request_id AND status IN ('pending','searching') AND provider_id IS NULL
    AND (
      (type='taxi' AND vehicle_category::text='large' AND public.has_role(auth.uid(),'large_driver')
        AND EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id=auth.uid()
          AND dp.vehicle_category::text='large' AND (service_requests.vehicle_type IS NULL OR dp.vehicle_type=service_requests.vehicle_type))
        AND EXISTS (SELECT 1 FROM public.request_offers o WHERE o.request_id=_request_id AND o.provider_id=auth.uid()))
      OR
      (type='taxi' AND vehicle_category::text<>'large' AND public.has_role(auth.uid(),'driver')
        AND EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id=auth.uid()
          AND dp.vehicle_category::text<>'large' AND dp.vehicle_category=service_requests.vehicle_category)
        AND EXISTS (SELECT 1 FROM public.request_offers o WHERE o.request_id=_request_id AND o.provider_id=auth.uid()))
      OR
      (type='service' AND public.has_role(auth.uid(),'worker')
        AND (service_id IS NULL OR EXISTS (SELECT 1 FROM public.worker_services ws
          WHERE ws.worker_id=auth.uid() AND ws.service_id=service_requests.service_id)))
    )
  RETURNING customer_id INTO v_customer;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated=0 THEN RAISE EXCEPTION 'request_unavailable'; END IF;
  INSERT INTO public.chats(request_id,customer_id,provider_id) VALUES(_request_id,v_customer,auth.uid())
    ON CONFLICT(request_id) DO UPDATE SET provider_id=EXCLUDED.provider_id,updated_at=now();
  UPDATE public.request_offers SET status='accepted',responded_at=now() WHERE request_id=_request_id AND provider_id=auth.uid();
  DELETE FROM public.request_offers WHERE request_id=_request_id AND provider_id<>auth.uid();
  INSERT INTO public.notifications(user_id,type,title,body,link)
    VALUES(v_customer,'request_accepted','تم قبول طلبك','مقدّم الخدمة في الطريق إليك','/request/'||_request_id);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_service_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_service_request(uuid) TO authenticated;
