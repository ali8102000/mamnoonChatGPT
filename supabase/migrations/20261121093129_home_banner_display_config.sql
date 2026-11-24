-- Per-banner presentation settings for the main hero carousel.
alter table public.home_carousel_banners
  add column if not exists display_config jsonb not null default '{}'::jsonb;

comment on column public.home_carousel_banners.display_config is
  'Admin-controlled presentation settings for hero banners (height, spacing, typography, colors and CTA).';
