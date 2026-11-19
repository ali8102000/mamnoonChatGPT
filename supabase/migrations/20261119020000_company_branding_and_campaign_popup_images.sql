-- Brand controls and image-backed survey popups, shared by web and native clients.
alter table public.company_settings
  add column if not exists company_logo_url text,
  add column if not exists welcome_message text not null default 'مشوارك وخدمات بيتك، بمكان واحد.';

alter table public.app_campaigns
  add column if not exists image_url text,
  add column if not exists popup_display_seconds integer not null default 5
    check (popup_display_seconds between 1 and 60);

comment on column public.company_settings.company_logo_url is 'Public logo image URL controlled by the Mamnoon super admin.';
comment on column public.company_settings.welcome_message is 'Welcome message shown in the customer app.';
comment on column public.app_campaigns.image_url is 'Optional image shown in the campaign popup and survey card.';
comment on column public.app_campaigns.popup_display_seconds is 'How long the campaign image popup remains visible, from 1 to 60 seconds.';
