create or replace function public.default_partner_promotion_governorate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(array_length(new.promotion_governorates, 1), 0) = 0
     and new.business_vertical <> 'grocery'
     and new.governorate_key is not null then
    new.promotion_governorates := array[new.governorate_key];
  end if;
  return new;
end;
$$;

revoke all on function public.default_partner_promotion_governorate() from public, anon, authenticated;
drop trigger if exists trg_default_partner_promotion_governorate on public.partner_business_profiles;
create trigger trg_default_partner_promotion_governorate
before insert or update of governorate_key, business_vertical on public.partner_business_profiles
for each row execute function public.default_partner_promotion_governorate();
