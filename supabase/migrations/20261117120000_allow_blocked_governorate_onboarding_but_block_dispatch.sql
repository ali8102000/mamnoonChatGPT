-- Keep onboarding and document submission open in disabled governorates,
-- while preventing providers located in those governorates from becoming available
-- or receiving/accepting work. Customer requests remain guarded by the existing
-- pickup-coordinate trigger.

create or replace function public.guard_provider_regional_presence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_governorate_key text;
begin
  select nullif(lower(trim(p.governorate_key)), '')
    into v_governorate_key
    from public.profiles p
   where p.id = new.user_id;

  if v_governorate_key is null and new.lat is not null and new.lng is not null then
    v_governorate_key := public.infer_governorate_key(new.lat, new.lng);
  end if;

  if v_governorate_key is not null
     and not public.regional_services_enabled(v_governorate_key) then
    raise exception using errcode = 'P0001',
      message = 'محافظتك متوقفة حالياً. يمكنك إكمال التسجيل وإرفاق المستمسكات، لكن استقبال الأعمال متاح بعد رفع الحظر من الإدارة.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_provider_regional_presence() from public, anon, authenticated;

drop trigger if exists guard_provider_regional_presence_before_write on public.provider_presence;
create trigger guard_provider_regional_presence_before_write
before insert or update on public.provider_presence
for each row execute function public.guard_provider_regional_presence();


-- When an administrator disables a governorate, immediately take existing
-- providers there offline as well; do not wait for their next heartbeat.
create or replace function public.cleanup_disabled_provider_presence()
returns trigger
language plpgsql
security definer
set search_path = public
as $
begin
  update public.worker_profiles wp
     set available = false
    from public.profiles p
   where p.id = wp.user_id
     and wp.available = true
     and not public.regional_services_enabled(p.governorate_key);

  update public.driver_profiles dp
     set available = false
    from public.profiles p
   where p.id = dp.user_id
     and dp.available = true
     and not public.regional_services_enabled(p.governorate_key);

  update public.worker_profiles wp
     set available = false
   where wp.available = true
     and wp.user_id in (
       select pp.user_id
         from public.provider_presence pp
         left join public.profiles p on p.id = pp.user_id
        where not public.regional_services_enabled(
          coalesce(nullif(lower(trim(p.governorate_key)), ''),
                   public.infer_governorate_key(pp.lat, pp.lng))
        )
     );

  update public.driver_profiles dp
     set available = false
   where dp.available = true
     and dp.user_id in (
       select pp.user_id
         from public.provider_presence pp
         left join public.profiles p on p.id = pp.user_id
        where not public.regional_services_enabled(
          coalesce(nullif(lower(trim(p.governorate_key)), ''),
                   public.infer_governorate_key(pp.lat, pp.lng))
        )
     );

  delete from public.provider_presence pp
   using public.profiles p
   where p.id = pp.user_id
     and not public.regional_services_enabled(
       coalesce(nullif(lower(trim(p.governorate_key)), ''),
                public.infer_governorate_key(pp.lat, pp.lng))
     );

  return null;
end;
$;

revoke all on function public.cleanup_disabled_provider_presence() from public, anon, authenticated;

drop trigger if exists cleanup_disabled_provider_presence_after_change on public.regional_service_controls;
create trigger cleanup_disabled_provider_presence_after_change
after insert or update or delete on public.regional_service_controls
for each statement execute function public.cleanup_disabled_provider_presence();

create or replace function public.guard_regional_request_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_governorate text;
  v_provider_governorate text;
begin
  select case
    when sr.pickup_lat is not null and sr.pickup_lng is not null
      then public.infer_governorate_key(sr.pickup_lat, sr.pickup_lng)
    else coalesce(sr.governorate_key, '')
  end
    into v_request_governorate
    from public.service_requests sr
   where sr.id = new.request_id;

  if new.status = 'pending'
     and not public.regional_services_enabled(v_request_governorate) then
    return null;
  end if;

  select nullif(lower(trim(p.governorate_key)), '')
    into v_provider_governorate
    from public.profiles p
   where p.id = new.provider_id;

  if new.status = 'pending'
     and v_provider_governorate is not null
     and not public.regional_services_enabled(v_provider_governorate) then
    return null;
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
  v_request_governorate text;
  v_provider_governorate text;
begin
  v_request_governorate := case
    when old.pickup_lat is not null and old.pickup_lng is not null
      then public.infer_governorate_key(old.pickup_lat, old.pickup_lng)
    else coalesce(old.governorate_key, '')
  end;

  if new.status::text = 'accepted'
     and old.status::text is distinct from 'accepted'
     and not public.regional_services_enabled(v_request_governorate) then
    raise exception using errcode = 'P0001',
      message = 'الخدمات متوقفة حالياً في محافظة الطلب بقرار من الإدارة.';
  end if;

  if new.status::text = 'accepted'
     and new.provider_id is not null then
    select nullif(lower(trim(p.governorate_key)), '')
      into v_provider_governorate
      from public.profiles p
     where p.id = new.provider_id;

    if v_provider_governorate is not null
       and not public.regional_services_enabled(v_provider_governorate) then
      raise exception using errcode = 'P0001',
        message = 'محافظة مقدم الخدمة متوقفة حالياً. لا يمكنه استلام أعمال حتى ترفع الإدارة الحظر.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_regional_request_acceptance() from public, anon, authenticated;
revoke all on function public.guard_regional_request_offer() from public, anon, authenticated;
