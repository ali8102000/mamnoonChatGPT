-- Editable headline and supporting copy for the customer home hero banner.
alter table public.home_carousel_banners
  add column if not exists banner_title text,
  add column if not exists banner_description text;

comment on column public.home_carousel_banners.banner_title is 'Optional headline shown in the customer home hero banner.';
comment on column public.home_carousel_banners.banner_description is 'Optional supporting description shown below the hero headline.';
