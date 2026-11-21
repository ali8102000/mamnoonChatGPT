-- Configurable movement for the shared home banner carousel.
alter table public.home_carousel_banners
  add column if not exists motion_axis text not null default 'horizontal',
  add column if not exists motion_direction text not null default 'left',
  add column if not exists motion_style text not null default 'slide';

alter table public.home_carousel_banners
  drop constraint if exists home_carousel_banners_motion_axis_check,
  add constraint home_carousel_banners_motion_axis_check
    check (motion_axis in ('horizontal','vertical')),
  drop constraint if exists home_carousel_banners_motion_direction_check,
  add constraint home_carousel_banners_motion_direction_check
    check (motion_direction in ('left','right','up','down')),
  drop constraint if exists home_carousel_banners_motion_style_check,
  add constraint home_carousel_banners_motion_style_check
    check (motion_style in ('slide','fade','drop'));

comment on column public.home_carousel_banners.motion_axis is 'Movement axis for the home banner carousel.';
comment on column public.home_carousel_banners.motion_direction is 'Requested banner movement direction: left, right, up, or down.';
comment on column public.home_carousel_banners.motion_style is 'Banner transition style: slide, fade, or drop.';
