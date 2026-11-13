-- Timed provider suspensions and admin status filtering support.
BEGIN;

ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS suspended_until timestamptz;
ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS suspended_until timestamptz;

DROP FUNCTION IF EXISTS public.admin_set_provider_status(uuid, text, text);

CREATE OR REPLACE FUNCTION public.admin_set_provider_status(
  p_user_id uuid,
  p_type text,
  p_status text,
  p_suspended_until timestamptz DEFAULT NULL
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

  IF p_status NOT IN ('approved','suspended','rejected','pending') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  IF p_status = 'suspended' AND p_suspended_until IS NOT NULL AND p_suspended_until <= now() THEN
    RAISE EXCEPTION 'invalid_suspension_expiry';
  END IF;

  IF p_type = 'driver' THEN
    v_role := 'driver';
    UPDATE public.driver_profiles
    SET status = p_status,
        suspended_until = CASE WHEN p_status = 'suspended' THEN p_suspended_until ELSE NULL END,
        available = CASE WHEN p_status = 'approved' THEN available ELSE false END
    WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSIF p_type = 'worker' THEN
    v_role := 'worker';
    UPDATE public.worker_profiles
    SET status = p_status,
        suspended_until = CASE WHEN p_status = 'suspended' THEN p_suspended_until ELSE NULL END,
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
  ELSIF p_status IN ('rejected','pending') THEN
    DELETE FROM public.user_roles
    WHERE user_id = p_user_id AND role = v_role;
  END IF;

  PERFORM public.log_admin_action(
    'set_provider_status',
    p_type,
    p_user_id::text,
    jsonb_build_object(
      'status', p_status,
      'suspended_until', p_suspended_until,
      'granted_role', CASE WHEN p_status = 'approved' THEN v_role::text ELSE NULL END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_provider_status(uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_status(uuid, text, text, timestamptz) TO authenticated;

-- The scheduled task restores providers automatically when their suspension expires.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE OR REPLACE FUNCTION public.expire_provider_suspensions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_rows integer := 0;
BEGIN
  UPDATE public.driver_profiles
  SET status = 'approved', suspended_until = NULL, available = false
  WHERE status = 'suspended'
    AND suspended_until IS NOT NULL
    AND suspended_until <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  UPDATE public.worker_profiles
  SET status = 'approved', suspended_until = NULL, available = false
  WHERE status = 'suspended'
    AND suspended_until IS NOT NULL
    AND suspended_until <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_provider_suspensions() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'mamnoon-expire-provider-suspensions';

  PERFORM cron.schedule(
    'mamnoon-expire-provider-suspensions',
    '* * * * *',
    'SELECT public.expire_provider_suspensions();'
  );
END;
$$;

COMMIT;
