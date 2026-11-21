-- Add a separate square promotional tile without changing the main hero advertisement.
alter table public.home_carousel_banners
  drop constraint if exists home_carousel_banners_banner_type_check,
  add constraint home_carousel_banners_banner_type_check
    check (banner_type in ('category','poll','contest','ad','top_square'));

alter table public.home_carousel_banners
  drop constraint if exists home_carousel_banners_destination_check,
  add constraint home_carousel_banners_destination_check
    check (
      (banner_type = 'category' and target_campaign_id is null)
      or (banner_type in ('poll','contest') and target_campaign_id is not null)
      or (banner_type in ('ad','top_square') and target_campaign_id is null)
    );

create index if not exists home_carousel_banners_top_square_order_idx
  on public.home_carousel_banners (display_order, created_at)
  where banner_type = 'top_square' and is_active = true;
