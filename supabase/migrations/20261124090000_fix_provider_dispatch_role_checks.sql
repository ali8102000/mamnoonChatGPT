-- Fix system-side provider role checks.
-- public.has_role() intentionally only answers for auth.uid(); it must not be
-- used to test a different provider from a trigger, dispatcher, map query, or
-- customer-side offer acceptance RPC.

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_count integer;
BEGIN
  -- Home-service dispatch: match the actual worker role in the candidate set.
  v_old := 'public.has_role(wp.user_id, ''worker'')';
  v_new := 'EXISTS (SELECT 1 FROM public.user_roles role_check_worker WHERE role_check_worker.user_id = wp.user_id AND role_check_worker.role = ''worker''::public.app_role)';
  SELECT pg_get_functiondef('public.advance_service_dispatch(uuid)'::regprocedure)
    INTO v_definition;
  v_count := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Unexpected worker role check count in advance_service_dispatch: %', v_count;
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);

  -- Nearby provider map pins: the viewer is not the provider being inspected.
  SELECT pg_get_functiondef('public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,integer)'::regprocedure)
    INTO v_definition;

  v_old := 'public.has_role(dp.user_id, ''large_driver''::public.app_role)';
  v_new := 'EXISTS (SELECT 1 FROM public.user_roles role_check_large WHERE role_check_large.user_id = dp.user_id AND role_check_large.role = ''large_driver''::public.app_role)';
  v_count := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Unexpected large-driver map role check count: %', v_count;
  END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'public.has_role(dp.user_id, ''driver''::public.app_role)';
  v_new := 'EXISTS (SELECT 1 FROM public.user_roles role_check_driver WHERE role_check_driver.user_id = dp.user_id AND role_check_driver.role = ''driver''::public.app_role)';
  v_count := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Unexpected driver map role check count: %', v_count;
  END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'public.has_role(pp.user_id, ''worker''::public.app_role)';
  v_new := 'EXISTS (SELECT 1 FROM public.user_roles role_check_map_worker WHERE role_check_map_worker.user_id = pp.user_id AND role_check_map_worker.role = ''worker''::public.app_role)';
  v_count := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Unexpected worker map role check count: %', v_count;
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  -- Large-vehicle offer acceptance runs as the customer, so verify the
  -- offered driver's role directly rather than through caller-scoped has_role.
  v_old := 'NOT public.has_role(o.provider_id, ''large_driver'')';
  v_new := 'NOT EXISTS (SELECT 1 FROM public.user_roles role_check_offer_provider WHERE role_check_offer_provider.user_id = o.provider_id AND role_check_offer_provider.role = ''large_driver''::public.app_role)';
  SELECT pg_get_functiondef('public.accept_large_vehicle_offer(uuid)'::regprocedure)
    INTO v_definition;
  v_count := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Unexpected large-vehicle acceptance role check count: %', v_count;
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END
$migration$;

COMMENT ON FUNCTION public.advance_service_dispatch(uuid) IS
  'Dispatches home-service requests to approved, available, online workers with the exact requested specialty and level.';
COMMENT ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,integer) IS
  'Returns nearby provider pins after checking the target providers roles directly, not via caller-scoped has_role.';
COMMENT ON FUNCTION public.accept_large_vehicle_offer(uuid) IS
  'Customer-side acceptance of a large-vehicle offer with direct role verification for the offered driver.';
