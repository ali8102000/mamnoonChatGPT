-- Break the RLS cycle between service_requests and provider profile visibility.
-- The helper reads service_requests as its owner, without re-entering caller RLS.
CREATE OR REPLACE FUNCTION public.mamnoon_customer_has_assigned_provider(_provider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND _provider_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.service_requests sr
       WHERE sr.customer_id = auth.uid()
         AND sr.provider_id = _provider_id
     );
$function$;

REVOKE ALL ON FUNCTION public.mamnoon_customer_has_assigned_provider(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mamnoon_customer_has_assigned_provider(uuid) TO authenticated;

DROP POLICY IF EXISTS "Worker profile visible" ON public.worker_profiles;
CREATE POLICY "Worker profile visible"
ON public.worker_profiles
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.has_staff_role((SELECT auth.uid()))
  OR public.mamnoon_customer_has_assigned_provider(user_id)
);

-- Preserve existing self/admin policies and add assigned-provider visibility
-- through the same non-recursive helper.
DROP POLICY IF EXISTS "Driver profile visible" ON public.driver_profiles;
CREATE POLICY "Driver profile visible"
ON public.driver_profiles
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.has_staff_role((SELECT auth.uid()))
  OR public.mamnoon_customer_has_assigned_provider(user_id)
);
