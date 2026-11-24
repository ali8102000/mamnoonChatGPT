ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS home_visual_url text,
  ADD COLUMN IF NOT EXISTS home_visual_animated boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS home_visual_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS home_visual_size_px integer NOT NULL DEFAULT 180;

ALTER TABLE public.company_settings
  ADD CONSTRAINT company_home_visual_size_px_range CHECK (home_visual_size_px BETWEEN 80 AND 320);

COMMENT ON COLUMN public.company_settings.home_visual_url IS 'Independent optional visual/GIF displayed below the top banner on the customer home screen.';
COMMENT ON COLUMN public.company_settings.home_visual_animated IS 'Whether animated home visual playback is enabled.';
COMMENT ON COLUMN public.company_settings.home_visual_enabled IS 'Whether the independent home visual is displayed.';
COMMENT ON COLUMN public.company_settings.home_visual_size_px IS 'Square display size in pixels for the independent home visual.';

GRANT SELECT (home_visual_url, home_visual_animated, home_visual_enabled, home_visual_size_px)
  ON TABLE public.company_settings TO anon, authenticated;
GRANT UPDATE (home_visual_url, home_visual_animated, home_visual_enabled, home_visual_size_px)
  ON TABLE public.company_settings TO authenticated;
