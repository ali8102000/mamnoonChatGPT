-- Customer-created requests must always enter the dispatch lifecycle as new requests.
-- RLS already binds customer_id and requires provider_id IS NULL, but without a
-- BEFORE INSERT guard a caller could forge terminal/accepted states and
-- server-owned timestamps/commission in the initial INSERT payload.
CREATE OR REPLACE FUNCTION public.guard_customer_request_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.customer_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'request_customer_must_match_auth_user';
    END IF;

    NEW.provider_id := NULL;
    NEW.status := 'pending';
    NEW.accepted_at := NULL;
    NEW.completed_at := NULL;
    NEW.searching_started_at := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancellation_reason := NULL;
    NEW.admin_notes := NULL;
    NEW.commission := 0;
    NEW.created_at := now();
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS guard_customer_request_before_insert
  ON public.service_requests;

-- Runs before taxi_prepare (alphabetical trigger order). The large-vehicle
-- taxi preparation trigger may then move a valid large taxi request to
-- 'searching'; ordinary service requests remain 'pending'.
CREATE TRIGGER guard_customer_request_before_insert
BEFORE INSERT ON public.service_requests
FOR EACH ROW
EXECUTE FUNCTION public.guard_customer_request_insert();

REVOKE EXECUTE ON FUNCTION public.guard_customer_request_insert()
  FROM PUBLIC, anon, authenticated;
