-- Bind each live GPS row to its real request party and hide stale coordinates after a trip ends.
CREATE OR REPLACE FUNCTION public.guard_live_location_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_request record;
  v_expected_role text;
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'live_location_owner_required';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.role IS DISTINCT FROM OLD.role
  ) THEN
    RAISE EXCEPTION 'live_location_identity_immutable';
  END IF;

  SELECT customer_id, provider_id, status
  INTO v_request
  FROM public.service_requests
  WHERE id = NEW.request_id;

  IF NOT FOUND OR v_request.status NOT IN ('accepted', 'in_progress') THEN
    RAISE EXCEPTION 'live_tracking_request_not_active';
  END IF;

  IF v_request.customer_id = auth.uid() THEN
    v_expected_role := 'customer';
  ELSIF v_request.provider_id = auth.uid() THEN
    v_expected_role := 'provider';
  ELSE
    RAISE EXCEPTION 'live_location_not_request_party';
  END IF;

  IF NEW.role IS DISTINCT FROM v_expected_role THEN
    RAISE EXCEPTION 'live_location_role_mismatch';
  END IF;

  RETURN NEW;
END;
$function$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_guard_live_location_ownership ON public.live_locations;
CREATE TRIGGER trg_guard_live_location_ownership
BEFORE INSERT OR UPDATE ON public.live_locations
FOR EACH ROW EXECUTE FUNCTION public.guard_live_location_ownership();
--> statement-breakpoint
DROP POLICY IF EXISTS "Owner updates own live location" ON public.live_locations;
CREATE POLICY "Owner updates own live location"
ON public.live_locations
FOR UPDATE TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND is_request_party(request_id, (SELECT auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.service_requests r
    WHERE r.id = live_locations.request_id
      AND r.status IN ('accepted', 'in_progress')
      AND (r.customer_id = (SELECT auth.uid()) OR r.provider_id = (SELECT auth.uid()))
  )
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND is_request_party(request_id, (SELECT auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.service_requests r
    WHERE r.id = live_locations.request_id
      AND r.status IN ('accepted', 'in_progress')
      AND (
        (r.customer_id = (SELECT auth.uid()) AND live_locations.role = 'customer')
        OR (r.provider_id = (SELECT auth.uid()) AND live_locations.role = 'provider')
      )
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Parties read live location" ON public.live_locations;
CREATE POLICY "Parties read live location"
ON public.live_locations
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.service_requests r
    WHERE r.id = live_locations.request_id
      AND r.status IN ('accepted', 'in_progress')
      AND (r.customer_id = (SELECT auth.uid()) OR r.provider_id = (SELECT auth.uid()))
      AND (live_locations.user_id = r.customer_id OR live_locations.user_id = r.provider_id)
  )
  OR (
    has_staff_role((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.service_requests r
      WHERE r.id = live_locations.request_id
        AND r.status IN ('accepted', 'in_progress')
        AND (live_locations.user_id = r.customer_id OR live_locations.user_id = r.provider_id)
    )
  )
);
