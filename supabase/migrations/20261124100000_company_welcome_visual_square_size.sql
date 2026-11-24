ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS company_welcome_visual_size_px integer NOT NULL DEFAULT 180;

ALTER TABLE public.company_settings
  ADD CONSTRAINT company_welcome_visual_size_px_range
  CHECK (company_welcome_visual_size_px BETWEEN 80 AND 320);

COMMENT ON COLUMN public.company_settings.company_welcome_visual_size_px IS
  'Square display size in pixels for the optional company welcome visual on web and native startup screens.';

GRANT SELECT (
  company_name,
  company_logo_url,
  welcome_message,
  company_welcome_visual_url,
  company_welcome_visual_animated,
  company_welcome_visual_size_px
) ON TABLE public.company_settings TO anon, authenticated;

-- Authenticated writes remain subject to the existing super-admin RLS policy.
GRANT UPDATE (company_welcome_visual_size_px) ON TABLE public.company_settings TO authenticated;
