-- Add per-device vibration preference and route all background pushes to the
-- matching Android channel. Kept separate from the unrelated staff-policy
-- changes in the older combined migration.
alter table public.user_push_tokens
  add column if not exists vibration_enabled boolean not null default true;

create or replace function public.enqueue_notification_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.type = 'request_offer' then
    return new;
  end if;

  insert into public.push_delivery_outbox(
    notification_id, request_id, provider_id, expo_push_token, payload
  )
  select
    new.id,
    case
      when (new.data->>'request_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (new.data->>'request_id')::uuid
      else null
    end,
    new.user_id,
    t.expo_push_token,
    jsonb_build_object(
      'to', t.expo_push_token,
      'title', new.title,
      'body', new.body,
      'sound', case when coalesce(t.sound_enabled, true) then 'default' else null end,
      'priority', case when new.data->>'plan' = 'gold' then 'high' else 'normal' end,
      'channelId', case
        when coalesce(t.sound_enabled, true) and coalesce(t.vibration_enabled, true) then 'mamnoon_sound_vibrate'
        when coalesce(t.sound_enabled, true) then 'mamnoon_sound_only'
        when coalesce(t.vibration_enabled, true) then 'mamnoon_vibrate_only'
        else 'mamnoon_silent'
      end,
      'data', jsonb_build_object(
        'type', new.type,
        'notification_id', new.id,
        'request_id', new.data->>'request_id',
        'url', coalesce(new.link, '/profile')
      )
    )
  from public.user_push_tokens t
  where t.user_id = new.user_id
    and (t.expo_push_token like 'ExpoPushToken[%' or t.expo_push_token like 'ExponentPushToken[%')
  on conflict (notification_id, expo_push_token)
    where notification_id is not null do nothing;

  perform public.process_mamnoon_push_outbox();
  return new;
end;
$function$;

create or replace function public.enqueue_request_offer_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_type text;
  v_pickup text;
  v_title text;
  v_body text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select r.type::text, r.pickup_text into v_type, v_pickup
  from public.service_requests r where r.id = new.request_id;
  if not found then return new; end if;

  if v_type = 'taxi' then
    v_title := 'طلب رحلة جديد';
    v_body := 'وصلتك رحلة جديدة' ||
      case when nullif(trim(v_pickup), '') is not null
        then ' من ' || left(trim(v_pickup), 90) else '' end || '. افتح ممنون للرد.';
  else
    v_title := 'طلب خدمة جديد';
    v_body := 'وصلك طلب خدمة جديد من زبون قريب. افتح ممنون للتفاصيل.';
  end if;

  insert into public.notifications(user_id, type, title, body, link, data)
  values (
    new.provider_id, 'request_offer', v_title, v_body,
    '/request/' || new.request_id::text,
    jsonb_build_object('type','request_offer','request_id',new.request_id,'offer_id',new.id)
  );

  insert into public.push_delivery_outbox(offer_id, request_id, provider_id, expo_push_token, payload)
  select
    new.id, new.request_id, new.provider_id, t.expo_push_token,
    jsonb_build_object(
      'to', t.expo_push_token,
      'title', v_title,
      'body', v_body,
      'sound', case when coalesce(t.sound_enabled, true) then 'default' else null end,
      'priority', 'high',
      'channelId', case
        when coalesce(t.sound_enabled, true) and coalesce(t.vibration_enabled, true) then 'mamnoon_sound_vibrate'
        when coalesce(t.sound_enabled, true) then 'mamnoon_sound_only'
        when coalesce(t.vibration_enabled, true) then 'mamnoon_vibrate_only'
        else 'mamnoon_silent'
      end,
      'data', jsonb_build_object(
        'type','request_offer',
        'request_id',new.request_id,
        'offer_id',new.id,
        'url','/request/' || new.request_id::text
      )
    )
  from public.user_push_tokens t
  where t.user_id = new.provider_id
    and (t.expo_push_token like 'ExpoPushToken[%' or t.expo_push_token like 'ExponentPushToken[%')
  on conflict (offer_id, expo_push_token) do nothing;

  perform public.process_mamnoon_push_outbox();
  return new;
end;
$function$;
