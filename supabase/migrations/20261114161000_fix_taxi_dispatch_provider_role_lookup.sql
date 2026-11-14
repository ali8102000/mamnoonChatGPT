-- Keep system-side taxi dispatch independent from the caller-scoped has_role()
-- helper. has_role() intentionally answers only for auth.uid(), while dispatch
-- runs from SECURITY DEFINER triggers / pg_cron with no end-user JWT.
DO $migration$
DECLARE
  v_definition text;
  v_updated text;
  v_large integer;
  v_driver integer;
BEGIN
  SELECT pg_get_functiondef('public.find_nearby_drivers(numeric,numeric,text,numeric,integer)'::regprocedure)
  INTO v_definition;

  v_large := (SELECT count(*) FROM regexp_matches(v_definition, 'public\\.has_role\\(\\s*dp\\.user_id,\\s*''large_driver''::public\\.app_role\\s*\\)', 'g'));
  v_driver := (SELECT count(*) FROM regexp_matches(v_definition, 'public\\.has_role\\(\\s*dp\\.user_id,\\s*''driver''::public\\.app_role\\s*\\)', 'g'));

  IF v_large <> 1 OR v_driver <> 1 THEN
    RAISE EXCEPTION 'Unexpected find_nearby_drivers definition; refusing migration (large %, driver %)', v_large, v_driver;
  END IF;

  v_updated := regexp_replace(
    v_definition,
    'public\\.has_role\\(\\s*dp\\.user_id,\\s*''large_driver''::public\\.app_role\\s*\\)',
    'EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = dp.user_id AND ur.role = ''large_driver''::public.app_role)',
    'g'
  );
  v_updated := regexp_replace(
    v_updated,
    'public\\.has_role\\(\\s*dp\\.user_id,\\s*''driver''::public\\.app_role\\s*\\)',
    'EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = dp.user_id AND ur.role = ''driver''::public.app_role)',
    'g'
  );

  EXECUTE v_updated;
END
$migration$;
