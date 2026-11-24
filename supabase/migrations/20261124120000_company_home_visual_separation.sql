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

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS home_visual_width_px integer NOT NULL DEFAULT 320
    CHECK (home_visual_width_px BETWEEN 80 AND 600),
  ADD COLUMN IF NOT EXISTS home_visual_height_px integer NOT NULL DEFAULT 180
    CHECK (home_visual_height_px BETWEEN 80 AND 600),
  ADD COLUMN IF NOT EXISTS home_visual_position text NOT NULL DEFAULT 'below_banner'
    CHECK (home_visual_position IN ('above_banner', 'below_banner', 'below_custom_content')),
  ADD COLUMN IF NOT EXISTS home_visual_link_url text;

COMMENT ON COLUMN public.company_settings.home_visual_width_px IS 'Configured width in pixels for the home visual.';
COMMENT ON COLUMN public.company_settings.home_visual_height_px IS 'Configured height in pixels for the home visual.';
COMMENT ON COLUMN public.company_settings.home_visual_position IS 'Selected home screen placement: above_banner, below_banner, or below_custom_content.';
COMMENT ON COLUMN public.company_settings.home_visual_link_url IS 'Optional HTTPS/HTTP destination opened when the home visual is tapped.';

GRANT SELECT (home_visual_width_px, home_visual_height_px, home_visual_position, home_visual_link_url)
  ON TABLE public.company_settings TO anon, authenticated;
GRANT UPDATE (home_visual_width_px, home_visual_height_px, home_visual_position, home_visual_link_url)
  ON TABLE public.company_settings TO authenticated;
