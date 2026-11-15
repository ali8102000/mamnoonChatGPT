-- Staff approval/rejection uses audited admin RPCs and server-side service role only.
-- Direct table writes are limited to the provider's own pending verification submission.
DROP POLICY IF EXISTS "Providers update own verification" ON public.provider_verifications;
CREATE POLICY "Providers update own verification"
ON public.provider_verifications
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id AND status = 'pending');
