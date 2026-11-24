ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS company_welcome_visual_url text;

COMMENT ON COLUMN public.company_settings.company_welcome_visual_url IS
  'Optional company welcome/splash visual shown on app startup and branding surfaces.';
