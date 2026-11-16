-- Block service requests based on the customer's registered governorate as well
-- as the selected pickup location. This prevents bypassing a regional restriction
-- by manually selecting a pickup point in another governorate.
create or replace function public.guard_regional_service_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_detected_governorate text;
  v_customer_governorate text;
  v_rejection_message text;
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

  select nullif(lower(trim(p.governorate_key)), '')
    into v_customer_governorate
    from public.profiles p
   where p.id = new.customer_id;

  if v_customer_governorate is not null
     and not public.regional_services_enabled(v_customer_governorate) then
    select nullif(trim(rejection_message), '') into v_rejection_message
      from public.regional_service_controls
     where governorate_key in (v_customer_governorate, 'all')
     order by case when governorate_key = v_customer_governorate then 0 else 1 end
     limit 1;

    raise exception 'regional_services_disabled'
      using message = coalesce(v_rejection_message,
        'محافظتك متوقفة حالياً بقرار من إدارة ممنون. يمكنك استخدام الخدمات بعد رفع الحظر عن محافظتك.');
  end if;

  if not public.regional_services_enabled(new.governorate_key) then
    select nullif(trim(rejection_message), '') into v_rejection_message
      from public.regional_service_controls
     where governorate_key in (new.governorate_key, 'all')
     order by case when governorate_key = new.governorate_key then 0 else 1 end
     limit 1;

    raise exception 'regional_services_disabled'
      using message = coalesce(v_rejection_message,
        'الخدمة المطلوبة متوقفة حالياً في محافظتك بقرار من إدارة ممنون.');
  end if;

  return new;
end;
$function$;
