-- Partner promotion coverage: multi-governorate reach for stores/restaurants,
-- and a configurable local radius for grocery businesses.
alter table public.partner_business_profiles
  add column if not exists promotion_governorates text[] not null default '{}',
  add column if not exists promotion_radius_km numeric(5,2) not null default 5,
  add column if not exists promotion_latitude double precision,
  add column if not exists promotion_longitude double precision;

update public.partner_business_profiles
set promotion_governorates = array[governorate_key]
where coalesce(array_length(promotion_governorates, 1), 0) = 0
  and governorate_key is not null;

alter table public.partner_business_profiles
  drop constraint if exists partner_business_profiles_promotion_radius_check,
  add constraint partner_business_profiles_promotion_radius_check
    check (promotion_radius_km between 1 and 100),
  drop constraint if exists partner_business_profiles_promotion_latitude_check,
  add constraint partner_business_profiles_promotion_latitude_check
    check (promotion_latitude is null or promotion_latitude between -90 and 90),
  drop constraint if exists partner_business_profiles_promotion_longitude_check,
  add constraint partner_business_profiles_promotion_longitude_check
    check (promotion_longitude is null or promotion_longitude between -180 and 180),
  drop constraint if exists partner_business_profiles_promotion_governorates_check,
  add constraint partner_business_profiles_promotion_governorates_check
    check (
      promotion_governorates <@ array[
        'baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
        'najaf','karbala','babil','anbar','diyala','saladin','wasit',
        'dhiqar','maysan','muthanna','qadisiyah'
      ]::text[]
    );

grant update (promotion_governorates, promotion_radius_km, promotion_latitude, promotion_longitude)
  on public.partner_business_profiles to authenticated;

create index if not exists idx_partner_business_profiles_promotion_governorates
  on public.partner_business_profiles using gin (promotion_governorates)
  where is_published = true;

create index if not exists idx_partner_business_profiles_grocery_location
  on public.partner_business_profiles (promotion_latitude, promotion_longitude)
  where is_published = true and business_vertical = 'grocery';
