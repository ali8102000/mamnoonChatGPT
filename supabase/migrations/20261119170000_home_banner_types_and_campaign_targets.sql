-- Extend the shared home carousel with explicit destinations.
alter table public.home_carousel_banners
  add column if not exists banner_type text not null default 'category',
  add column if not exists target_campaign_id uuid references public.app_campaigns(id) on delete cascade;

alter table public.home_carousel_banners
  drop constraint if exists home_carousel_banners_banner_type_check,
  add constraint home_carousel_banners_banner_type_check
    check (banner_type in ('category','poll','contest','ad')),
  drop constraint if exists home_carousel_banners_destination_check,
  add constraint home_carousel_banners_destination_check
    check (
      (banner_type = 'category' and target_campaign_id is null)
      or (banner_type in ('poll','contest') and target_campaign_id is not null)
      or (banner_type = 'ad' and target_campaign_id is null)
    );

create index if not exists home_carousel_banners_campaign_idx
  on public.home_carousel_banners (target_campaign_id)
  where target_campaign_id is not null;

create or replace function public.validate_home_carousel_banner_campaign()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign_type text;
begin
  if new.banner_type in ('poll','contest') then
    select campaign_type into v_campaign_type
    from public.app_campaigns
    where id = new.target_campaign_id;
    if not found or v_campaign_type is distinct from new.banner_type then
      raise exception 'banner_campaign_type_mismatch';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_home_carousel_banner_campaign on public.home_carousel_banners;
create trigger validate_home_carousel_banner_campaign
before insert or update of banner_type, target_campaign_id
on public.home_carousel_banners
for each row execute function public.validate_home_carousel_banner_campaign();

comment on column public.home_carousel_banners.banner_type is
  'category opens a partner category, poll opens a poll, contest opens contest instructions and participation, ad is a non-interactive image.';
comment on column public.home_carousel_banners.target_campaign_id is
  'Published poll or contest campaign opened when the corresponding banner is tapped.';
