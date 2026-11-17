-- Configurable floating regional notices shared by web and Android.
alter table public.regional_service_controls
  add column if not exists message_float_enabled boolean not null default true,
  add column if not exists message_width_percent integer not null default 92,
  add column if not exists message_height_percent integer not null default 34,
  add column if not exists message_position text not null default 'top-center',
  add column if not exists message_top_offset integer not null default 12,
  add column if not exists message_font_size integer not null default 14;

alter table public.regional_service_controls
  drop constraint if exists regional_service_controls_message_width_percent_check,
  add constraint regional_service_controls_message_width_percent_check
    check (message_width_percent between 60 and 100),
  drop constraint if exists regional_service_controls_message_height_percent_check,
  add constraint regional_service_controls_message_height_percent_check
    check (message_height_percent between 12 and 60),
  drop constraint if exists regional_service_controls_message_position_check,
  add constraint regional_service_controls_message_position_check
    check (message_position in ('top-center', 'top-right', 'top-left')),
  drop constraint if exists regional_service_controls_message_top_offset_check,
  add constraint regional_service_controls_message_top_offset_check
    check (message_top_offset between 0 and 160),
  drop constraint if exists regional_service_controls_message_font_size_check,
  add constraint regional_service_controls_message_font_size_check
    check (message_font_size between 11 and 22);

comment on column public.regional_service_controls.message_float_enabled is
  'Whether the regional notice is rendered as a floating overlay instead of in page flow.';
