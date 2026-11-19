alter table public.company_settings
  add column if not exists service_icon_image_size_px integer not null default 40
  check (service_icon_image_size_px between 24 and 64);

comment on column public.company_settings.service_icon_image_size_px is
  'Image width and height in pixels for each technician service icon in the home panorama.';

grant select (service_icon_image_size_px)
  on table public.company_settings to anon, authenticated;
