-- Exempt platform admins (admin and super_admin) from user-facing regional controls.
-- This does not bypass authentication, RLS, staff permissions, or audit logging.

create or replace function public.is_platform_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.user_roles ur
     where ur.user_id = p_user_id
       and ur.role::text in ('admin', 'super_admin')
  );
$$;

revoke all on function public.is_platform_admin(uuid) from public, anon, authenticated;

create or replace function public.guard_regional_service_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detected_governorate text;
begin
  -- Admin accounts are not subject to regional service availability controls.
  if public.is_platform_admin(auth.uid()) then
    return new;
  end if;

  if new.pickup_lat is null or new.pickup_lng is null then
    raise exception using errcode = 'P0001',
      message = 'موقع الانطلاق مطلوب حتى نتحقق من توفر الخدمة في محافظتك.';
  end if;

  v_detected_governorate := public.infer_governorate_key(new.pickup_lat, new.pickup_lng);
  if v_detected_governorate is null then
    raise exception using errcode = 'P0001',
      message = 'تعذّر تحديد المحافظة من موقع الانطلاق. حدّد الموقع من جديد ثم أرسل الطلب.';
  end if;
  new.governorate_key := v_detected_governorate;

  if new.governorate_key is null or length(trim(new.governorate_key)) = 0 then
    raise exception using errcode = 'P0001',
      message = 'تعذّر تحديد المحافظة. حدّد موقع الانطلاق من جديد ثم أرسل الطلب.';
  end if;

  if not public.regional_services_enabled(new.governorate_key) then
    raise exception using errcode = 'P0001',
      message = 'الخدمات متوقفة مؤقتاً في محافظتك بقرار من إدارة ممنون.';
  end if;

  return new;
end;
$$;

create or replace function public.guard_regional_request_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_governorate_key text;
begin
  -- Either the authenticated admin actor or the assigned admin provider is exempt.
  if public.is_platform_admin(auth.uid()) or public.is_platform_admin(old.provider_id) then
    return new;
  end if;

  v_governorate_key := case
    when old.pickup_lat is not null and old.pickup_lng is not null
      then public.infer_governorate_key(old.pickup_lat, old.pickup_lng)
    else coalesce(old.governorate_key, '')
  end;

  if new.status::text = 'accepted'
     and old.status::text is distinct from 'accepted'
     and not public.regional_services_enabled(v_governorate_key) then
    raise exception using errcode = 'P0001',
      message = 'الخدمات متوقفة حالياً في هذه المحافظة بقرار من الإدارة.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_regional_request_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_governorate_key text;
begin
  -- Do not suppress offers addressed to an admin provider account.
  if public.is_platform_admin(new.provider_id) then
    return new;
  end if;

  select case
    when sr.pickup_lat is not null and sr.pickup_lng is not null
      then public.infer_governorate_key(sr.pickup_lat, sr.pickup_lng)
    else coalesce(sr.governorate_key, '')
  end
  into v_governorate_key
  from public.service_requests sr
  where sr.id = new.request_id;

  if new.status = 'pending' and not public.regional_services_enabled(v_governorate_key) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_regional_service_request() from public, anon, authenticated;
revoke all on function public.guard_regional_request_acceptance() from public, anon, authenticated;
revoke all on function public.guard_regional_request_offer() from public, anon, authenticated;
