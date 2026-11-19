-- Allow the owner to control all category banner dwell times from 1 to 60 seconds.
alter table public.home_carousel_banners
  drop constraint if exists home_carousel_banners_scroll_speed_check;

alter table public.home_carousel_banners
  add constraint home_carousel_banners_scroll_speed_check
  check (scroll_speed between 1 and 60);

update public.home_carousel_banners
set scroll_speed = greatest(1, least(60, scroll_speed))
where scroll_speed < 1 or scroll_speed > 60;
