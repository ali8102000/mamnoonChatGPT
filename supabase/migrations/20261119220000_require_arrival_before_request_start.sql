-- Require an explicit arrival confirmation before a technician or large-vehicle
-- driver can move an accepted request into execution. Normal taxi rides keep
-- their passenger-boarded confirmation flow.
CREATE OR REPLACE FUNCTION public.transition_service_request(
  _request_id uuid,
  _status public.request_status,
  _reason text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v public.service_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT *
  INTO v
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF _status = 'cancelled' THEN
    PERFORM public.cancel_service_request(_request_id, _reason);
    RETURN true;
  END IF;

  IF v.provider_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _status = 'in_progress' AND v.status = 'accepted' THEN
    IF (
      v.type::text = 'service'
      OR (
        v.type::text = 'taxi'
        AND coalesce(v.vehicle_category::text, '') = 'large'
      )
    ) AND v.provider_arrived_at IS NULL THEN
      RAISE EXCEPTION 'provider_not_arrived';
    END IF;

    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests
    SET status = 'in_progress',
        started_at = now()
    WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    RETURN true;
  END IF;

  IF _status = 'completed' AND v.status = 'in_progress' THEN
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests
    SET status = 'completed',
        completed_at = now()
    WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    RETURN true;
  END IF;

  RAISE EXCEPTION 'invalid_status_transition';
END;
$function$;
