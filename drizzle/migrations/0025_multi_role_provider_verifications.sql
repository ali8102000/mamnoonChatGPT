-- Allow one account to register independently as both a technician and a taxi driver.
-- Each provider role keeps its own verification documents and review status.
BEGIN;

ALTER TABLE public.provider_verifications
  DROP CONSTRAINT IF EXISTS provider_verifications_pkey;

ALTER TABLE public.provider_verifications
  ADD CONSTRAINT provider_verifications_pkey PRIMARY KEY (user_id, provider_type);

COMMIT;
