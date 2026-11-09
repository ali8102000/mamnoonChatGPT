-- Restrict first-admin bootstrap to the trusted server-side service role.
-- The server function validates the configured allowlisted email and one-time secret.
CREATE OR REPLACE FUNCTION public.bootstrap_first_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bootstrap_first_super_admin'));

  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE role = 'super_admin'
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, 'super_admin')
  ON CONFLICT DO NOTHING;

  PERFORM public.log_admin_action(
    'bootstrap_first_super_admin',
    'user',
    p_user_id::text
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_first_super_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_super_admin(uuid) TO service_role;
