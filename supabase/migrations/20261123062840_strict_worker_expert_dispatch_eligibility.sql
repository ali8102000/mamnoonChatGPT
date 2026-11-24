-- Enforce exact technician/expert level matching and exclude ineligible providers from offers.
-- NOT VALID preserves historic rows while checking all new and updated service requests.
ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_service_level_required;
ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_service_level_required
  CHECK (
    type::text <> 'service'
    OR level_required IS NOT NULL AND level_required::text IN ('fani', 'khabir')
  ) NOT VALID;

-- Tighten service dispatch: a worker must be an actual worker-role account,
-- approved, available, not suspended, subscribed to the exact service,
-- and at the exact requested level.
DO $migration$
DECLARE
  v_def text;
  v_updated text;
  v_old text := $old$      AND wp.status = 'approved'
      AND (r.level_required IS NULL OR wp.level = r.level_required)
      AND r.pickup_lat IS NOT NULL AND r.pickup_lng IS NOT NULL$old$;
  v_new text := $new$      AND wp.status = 'approved'
      AND public.has_role(wp.user_id, 'worker')
      AND (wp.suspended_until IS NULL OR wp.suspended_until <= now())
      AND wp.level = r.level_required
      AND r.pickup_lat IS NOT NULL AND r.pickup_lng IS NOT NULL$new$;
BEGIN
  SELECT pg_get_functiondef('public.advance_service_dispatch(uuid)'::regprocedure)
    INTO v_def;
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'advance_service_dispatch eligibility anchor missing; refusing unsafe replacement';
  END IF;
  v_updated := replace(v_def, v_old, v_new);
  EXECUTE v_updated;
END
$migration$;

COMMENT ON CONSTRAINT service_requests_service_level_required ON public.service_requests
  IS 'Every new home-service request must explicitly require fani or khabir; dispatch matches that level exactly.';
