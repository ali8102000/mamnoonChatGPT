-- Enforce the pickup governorate from coordinates, never trust a stale client key.
-- This closes the bypass where a customer selected a different governorate in the UI
-- while sending coordinates from a disabled governorate.
create or replace function public.guard_regional_service_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detected_governorate text;
  v_notice_text text;
begin
  if new.pickup_lat is null or new.pickup_lng is null then
    raise exception 'governorate_required'
      using message = 'موقع الانطلاق مطلوب حتى نتحقق من توفر الخدمة في محافظتك.';
  end if;

  v_detected_governorate := public.infer_governorate_key(new.pickup_lat, new.pickup_lng);
  if v_detected_governorate is null then
    raise exception 'governorate_required'
      using message = 'تعذّر تحديد المحافظة من موقع الانطلاق. حدّد الموقع من جديد ثم أرسل الطلب.';
  end if;
  new.governorate_key := v_detected_governorate;

  if new.governorate_key is null or length(trim(new.governorate_key)) = 0 then
    raise exception 'governorate_required'
      using message = 'تعذّر تحديد المحافظة. حدّد موقع الانطلاق من جديد ثم أرسل الطلب.';
  end if;

  if not public.regional_services_enabled(new.governorate_key) then
    select nullif(trim(message_text), '') into v_notice_text
    from public.regional_service_controls
    where governorate_key in (new.governorate_key, 'all')
      and message_enabled = true
    order by case when governorate_key = new.governorate_key then 0 else 1 end
    limit 1;

    raise exception 'regional_services_disabled'
      using message = 'الخدمة المطلوبة متوقفة حالياً في محافظتك. ' || coalesce(v_notice_text, 'الخدمات متوقفة بقرار من إدارة ممنون.');
  end if;

  return new;
end;
$$;

-- Also validate the actual pickup coordinates during acceptance, even for legacy rows
-- whose governorate_key was stored incorrectly or left null.
create or replace function public.guard_regional_request_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_governorate_key text;
  v_notice_text text;
begin
  v_governorate_key := case
    when old.pickup_lat is not null and old.pickup_lng is not null
      then public.infer_governorate_key(old.pickup_lat, old.pickup_lng)
    else coalesce(old.governorate_key, '')
  end;

  if new.status::text = 'accepted'
     and old.status::text is distinct from 'accepted'
     and not public.regional_services_enabled(v_governorate_key) then
    select nullif(trim(message_text), '') into v_notice_text
    from public.regional_service_controls
    where governorate_key in (v_governorate_key, 'all')
      and message_enabled = true
    order by case when governorate_key = v_governorate_key then 0 else 1 end
    limit 1;

    raise exception 'regional_services_disabled'
      using message = 'الخدمة المطلوبة متوقفة حالياً في محافظتك. ' || coalesce(v_notice_text, 'الخدمات متوقفة بقرار من إدارة ممنون.');
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
