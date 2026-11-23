-- Global company welcome media for the web and Android app.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS welcome_media_url text,
  ADD COLUMN IF NOT EXISTS welcome_media_type text NOT NULL DEFAULT 'image'
    CHECK (welcome_media_type IN ('image','gif'));

COMMENT ON COLUMN public.company_settings.welcome_media_url IS
  'Public image or animated GIF shown on app launch, welcome, login and fare panels.';
COMMENT ON COLUMN public.company_settings.welcome_media_type IS
  'Controls whether welcome media is rendered as a static image or animated GIF.';
