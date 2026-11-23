-- Extend the existing partner application workflow with legal documents and a verified business pin.
alter table public.partner_applications
  add column if not exists license_number text,
  add column if not exists license_document_path text,
  add column if not exists id_front_path text,
  add column if not exists id_back_path text,
  add column if not exists business_latitude double precision,
  add column if not exists business_longitude double precision;

alter table public.partner_applications
  drop constraint if exists partner_applications_business_pin_pair,
  add constraint partner_applications_business_pin_pair check (
    ((business_latitude is null) = (business_longitude is null))
    and (business_latitude is null or (business_latitude between -90 and 90 and business_longitude between -180 and 180))
  );

alter table public.partner_business_profiles
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.partner_business_profiles
  drop constraint if exists partner_business_profiles_location_pair,
  add constraint partner_business_profiles_location_pair check (
    ((latitude is null) = (longitude is null))
    and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))
  );

create or replace function public.sync_partner_business_profile()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.status = 'approved' then
    insert into public.partner_business_profiles (
      application_id,user_id,partner_type,business_name,phone,email,
      governorate_key,city,address,description,latitude,longitude
    )
    values (
      new.id,new.user_id,new.partner_type,new.business_name,new.phone,new.email,
      new.governorate_key,new.city,new.address,new.description,
      new.business_latitude,new.business_longitude
    )
    on conflict (application_id) do update set
      business_name = excluded.business_name,
      phone = excluded.phone,
      email = excluded.email,
      governorate_key = excluded.governorate_key,
      city = excluded.city,
      address = excluded.address,
      description = excluded.description,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      updated_at = now();
  elsif new.status = 'suspended' then
    update public.partner_business_profiles
      set is_published=false,updated_at=now()
      where application_id=new.id;
  end if;
  return new;
end;
$function$;
