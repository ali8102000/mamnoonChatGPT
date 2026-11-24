create or replace function public.default_partner_promotion_governorate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(array_length(new.promotion_governorates, 1), 0) = 0
     and coalesce(new.business_vertical, 'store') <> 'grocery'
     and new.governorate_key is not null then
    new.promotion_governorates := array[new.governorate_key];
  end if;
  return new;
end;
$$;

revoke all on function public.default_partner_promotion_governorate() from public, anon, authenticated;
