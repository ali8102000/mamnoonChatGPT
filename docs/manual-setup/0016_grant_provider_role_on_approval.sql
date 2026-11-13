-- Ensure approving a provider also grants the matching application role.
-- Existing users are updated only when an administrator approves their profile.
CREATE OR REPLACE FUNCTION public.admin_set_provider_status(
  p_user_id uuid,
  p_type text,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
  v_updated integer;
BEGIN
  PERFORM public.assert_staff('admin');

  IF p_status NOT IN ('approved','suspended','rejected') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF p_type = 'driver' THEN
    v_role := 'driver';
    UPDATE public.driver_profiles
    SET status = p_status,
        available = CASE WHEN p_status = 'approved' THEN available ELSE false END
    WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSIF p_type = 'worker' THEN
    v_role := 'worker';
    UPDATE public.worker_profiles
    SET status = p_status,
        available = CASE WHEN p_status = 'approved' THEN available ELSE false END
    WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'invalid_type';
  END IF;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'provider_profile_not_found';
  END IF;

  IF p_status = 'approved' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, v_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSIF p_status = 'rejected' THEN
    DELETE FROM public.user_roles
    WHERE user_id = p_user_id AND role = v_role;
  END IF;

  PERFORM public.log_admin_action(
    'set_provider_status',
    p_type,
    p_user_id::text,
    jsonb_build_object('status', p_status, 'granted_role', CASE WHEN p_status = 'approved' THEN v_role::text ELSE NULL END)
  );
END;
$$;
