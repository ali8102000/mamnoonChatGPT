-- Keep the caller-scoped public entitlement helper intact; system dispatch needs an internal variant.
CREATE OR REPLACE FUNCTION public.mamnoon_provider_subscription_active_internal(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_enabled boolean;
BEGIN
 SELECT subscription_enabled INTO v_enabled FROM public.subscription_settings WHERE id=1;
 IF NOT COALESCE(v_enabled,false) THEN RETURN true; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=p_user_id AND ur.role::text IN ('worker','driver','large_driver')) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.user_subscriptions us WHERE us.user_id=p_user_id AND us.status='paused' AND (us.current_period_end IS NULL OR us.current_period_end>now())) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.user_subscriptions us WHERE us.user_id=p_user_id AND us.status='active' AND ((us.is_trial AND us.trial_ends_at>now()) OR (us.current_period_end IS NOT NULL AND us.current_period_end>now()) OR (us.current_period_end IS NULL AND us.grant_type='admin'))) THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM public.subscription_plans sp WHERE sp.code='free' AND sp.is_active=true);
END;
$function$;
REVOKE ALL ON FUNCTION public.mamnoon_provider_subscription_active_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mamnoon_provider_subscription_active_internal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mamnoon_provider_subscription_active_internal(uuid) FROM authenticated;
COMMENT ON FUNCTION public.mamnoon_provider_subscription_active_internal(uuid) IS 'Internal entitlement check for owner-executed dispatch and provider discovery functions. Not executable by client roles.';
DO $migration$
DECLARE v_signature text; v_oid regprocedure; v_definition text; v_occurrences integer;
BEGIN
 FOREACH v_signature IN ARRAY ARRAY['public.advance_service_dispatch(uuid)','public.find_nearby_drivers(numeric,numeric,text,numeric,integer)','public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,integer)'] LOOP
  v_oid:=to_regprocedure(v_signature);
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required dispatch function is missing: %',v_signature; END IF;
  SELECT pg_get_functiondef(v_oid::oid) INTO v_definition;
  SELECT count(*) INTO v_occurrences FROM regexp_matches(v_definition,'public\.mamnoon_provider_subscription_active\(','g');
  IF v_occurrences<>1 THEN RAISE EXCEPTION 'Unexpected subscription helper references in %: %',v_signature,v_occurrences; END IF;
  v_definition:=regexp_replace(v_definition,'public\.mamnoon_provider_subscription_active\(','public.mamnoon_provider_subscription_active_internal(','g');
  EXECUTE v_definition;
 END LOOP;
END
$migration$;