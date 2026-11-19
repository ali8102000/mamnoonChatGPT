-- Configurable maximum duration for mandatory driver vehicle-verification videos.
alter table public.company_settings
  add column if not exists driver_video_max_duration_seconds integer not null default 10
  check (driver_video_max_duration_seconds between 1 and 60);

comment on column public.company_settings.driver_video_max_duration_seconds is
  'Maximum allowed duration, in seconds, for driver and large-driver vehicle verification videos.';

-- Onboarding clients need to read this non-sensitive public limit before accepting uploads.
grant select (driver_video_max_duration_seconds)
  on table public.company_settings to anon, authenticated;
