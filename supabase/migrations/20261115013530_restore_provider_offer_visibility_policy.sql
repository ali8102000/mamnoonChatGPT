DROP POLICY IF EXISTS "Provider sees own offers" ON public.request_offers;
CREATE POLICY "Provider sees own offers"
ON public.request_offers
FOR SELECT
TO authenticated
USING (
  (provider_id = (SELECT auth.uid()))
  OR public.has_staff_role((SELECT auth.uid()))
);
