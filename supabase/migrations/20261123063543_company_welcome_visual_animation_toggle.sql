ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS company_welcome_visual_animated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_settings.company_welcome_visual_animated IS
  'When enabled, the company welcome visual receives a subtle animated presentation on app startup.';
