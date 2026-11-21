-- Separate top panorama banners from independently published restaurant content.
begin;

alter table public.home_carousel_banners
  add column if not exists display_location text not null default 'top_panorama';

alter table public.home_carousel_banners
  drop constraint if exists home_carousel_banners_display_location_check;

alter table public.home_carousel_banners
  add constraint home_carousel_banners_display_location_check
  check (display_location in ('top_panorama', 'restaurant_section'));

create index if not exists home_carousel_banners_location_active_order_idx
  on public.home_carousel_banners(display_location, target_category, is_active, display_order, created_at);

comment on column public.home_carousel_banners.display_location is
  'Controls the independent surface where the banner is rendered: top panorama or restaurant discovery section.';

commit;
