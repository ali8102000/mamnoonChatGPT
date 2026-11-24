-- The production project currently uses the established dispatch_zone_settings
-- table and get_dispatch_ring() function. Restore that dependency if a prior
-- deployment temporarily pointed the dispatcher at the not-yet-installed
-- regional ring system. On a fresh migration replay this is an intentional no-op.
DO $migration$
DECLARE
  v_def text;
  v_updated text;
  v_regional text := 'FROM public.get_regional_dispatch_ring(''large_driver'', q.stage, r.governorate_key, ''all'')';
  v_existing text := 'FROM public.get_dispatch_ring(''large_driver'', q.stage)';
BEGIN
  SELECT pg_get_functiondef('public.advance_taxi_dispatch(uuid)'::regprocedure) INTO v_def;
  IF position(v_regional in v_def) > 0 THEN
    v_updated := replace(v_def, v_regional, v_existing);
    EXECUTE v_updated;
  ELSIF position(v_existing in v_def) = 0 THEN
    RAISE EXCEPTION 'large vehicle dispatch ring dependency is unknown; refusing unsafe replacement';
  END IF;
END
$migration$;
