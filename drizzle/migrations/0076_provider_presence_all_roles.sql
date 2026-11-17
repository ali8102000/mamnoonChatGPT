-- Allow every provider category, including large drivers, to publish their own presence.
DROP POLICY IF EXISTS "Providers insert own presence" ON public.provider_presence;
CREATE POLICY "Providers insert own presence"
  ON public.provider_presence FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'large_driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "Providers update own presence" ON public.provider_presence;
CREATE POLICY "Providers update own presence"
  ON public.provider_presence FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'large_driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.has_role(auth.uid(), 'driver'::public.app_role)
      OR public.has_role(auth.uid(), 'large_driver'::public.app_role)
      OR public.has_role(auth.uid(), 'worker'::public.app_role)
    )
  );
