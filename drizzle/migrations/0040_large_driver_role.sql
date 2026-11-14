-- Mamnoon: introduce a dedicated role for large Kia / bus drivers.
-- Add the enum value in its own migration so PostgreSQL commits it before later
-- migrations/functions reference it.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'large_driver';

-- Keep verification records separated by provider type, including large drivers.
ALTER TABLE public.provider_verifications
  DROP CONSTRAINT IF EXISTS provider_verifications_provider_type_check;

ALTER TABLE public.provider_verifications
  ADD CONSTRAINT provider_verifications_provider_type_check
  CHECK (provider_type IN ('driver', 'large_driver', 'worker'));
