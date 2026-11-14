-- Trigger guards evaluate NEW.provider_id, not auth.uid() (the customer during dispatch).
-- Keep the public helper caller-scoped and use the internal variant only in these
-- SECURITY DEFINER trigger guards.
DO $migration$
DECLARE v_signature text; v_oid regprocedure; v_definition text; v_occurrences integer;
BEGIN
 FOREACH v_signature IN ARRAY ARRAY['public.mamnoon_guard_provider_offer()','public.mamnoon_guard_provider_assignment()'] LOOP
  v_oid:=to_regprocedure(v_signature);
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required provider guard is missing: %',v_signature; END IF;
  SELECT pg_get_functiondef(v_oid::oid) INTO v_definition;
  SELECT count(*) INTO v_occurrences FROM regexp_matches(v_definition,'public\.mamnoon_provider_subscription_active\(','g');
  IF v_occurrences<>1 THEN RAISE EXCEPTION 'Unexpected subscription helper references in %: %',v_signature,v_occurrences; END IF;
  v_definition:=regexp_replace(v_definition,'public\.mamnoon_provider_subscription_active\(','public.mamnoon_provider_subscription_active_internal(','g');
  EXECUTE v_definition;
 END LOOP;
END
$migration$;