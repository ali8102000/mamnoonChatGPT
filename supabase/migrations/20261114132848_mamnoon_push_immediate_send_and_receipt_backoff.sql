CREATE OR REPLACE FUNCTION public.process_mamnoon_push_outbox()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'pg_temp'
AS $function$
declare
  r record;
  v_response record;
  v_content jsonb;
  v_ticket jsonb;
  v_receipt jsonb;
  v_request_id bigint;
  v_processed integer := 0;
  v_error text;
begin
  -- Resolve asynchronous send responses and retry transient failures.
  for r in
    select *
    from public.push_delivery_outbox
    where status = 'sending' and http_request_id is not null
    order by submitted_at
    for update skip locked
    limit 100
  loop
    select * into v_response
    from net._http_response
    where id = r.http_request_id;

    if not found then
      if r.submitted_at < now() - interval '3 minutes' then
        if r.attempts >= 6 then
          update public.push_delivery_outbox
          set status = 'failed', last_error = 'No response from Expo after retries',
              updated_at = now()
          where id = r.id;
        else
          update public.push_delivery_outbox
          set status = 'queued',
              next_attempt_at = now() + make_interval(secs =>
                least(300, 15 * power(2, greatest(r.attempts - 1, 0))::integer)),
              http_request_id = null, submitted_at = null,
              last_error = 'Expo request timed out; retry scheduled',
              updated_at = now()
          where id = r.id;
        end if;
      end if;
      continue;
    end if;

    v_content := null;
    begin
      v_content := v_response.content::jsonb;
    exception when others then
      v_content := '{}'::jsonb;
    end;

    v_ticket := v_content #> '{data,0}';
    if v_response.status_code between 200 and 299
       and v_ticket->>'status' = 'ok'
       and nullif(v_ticket->>'id', '') is not null then
      update public.push_delivery_outbox
      set status = 'accepted',
          expo_ticket_id = v_ticket->>'id',
          sent_at = now(),
          next_attempt_at = now() + interval '15 minutes',
          http_request_id = null,
          submitted_at = null,
          last_error = null,
          updated_at = now()
      where id = r.id;
    else
      v_error := coalesce(
        v_ticket->>'message',
        v_ticket #>> '{details,error}',
        v_response.error_msg,
        'Expo rejected the push request'
      );

      if v_ticket #>> '{details,error}' = 'DeviceNotRegistered' then
        delete from public.user_push_tokens
        where user_id = r.provider_id and expo_push_token = r.expo_push_token;
        update public.push_delivery_outbox
        set status = 'failed', last_error = v_error,
            http_request_id = null, submitted_at = null, updated_at = now()
        where id = r.id;
      elsif r.attempts >= 6 then
        update public.push_delivery_outbox
        set status = 'failed', last_error = left(v_error, 500),
            http_request_id = null, submitted_at = null, updated_at = now()
        where id = r.id;
      else
        update public.push_delivery_outbox
        set status = 'queued',
            next_attempt_at = now() + make_interval(secs =>
              least(300, 15 * power(2, greatest(r.attempts - 1, 0))::integer)),
            http_request_id = null, submitted_at = null,
            last_error = left(v_error, 500), updated_at = now()
        where id = r.id;
      end if;
    end if;
    v_processed := v_processed + 1;
  end loop;

  -- Check Expo delivery receipts after the provider has had time to process them.
  for r in
    select *
    from public.push_delivery_outbox
    where status = 'receipt_pending' and receipt_request_id is not null
    order by receipt_requested_at
    for update skip locked
    limit 100
  loop
    select * into v_response
    from net._http_response
    where id = r.receipt_request_id;

    if not found then
      if r.receipt_requested_at < now() - interval '5 minutes' then
        update public.push_delivery_outbox
        set status = 'accepted', receipt_request_id = null,
            receipt_requested_at = null,
            next_attempt_at = now() + interval '5 minutes',
            last_error = 'Receipt response delayed; will check again',
            updated_at = now()
        where id = r.id;
      end if;
      continue;
    end if;

    v_content := null;
    begin
      v_content := v_response.content::jsonb;
    exception when others then
      v_content := '{}'::jsonb;
    end;
    v_receipt := v_content #> array['data', r.expo_ticket_id];

    if v_response.status_code between 200 and 299
       and v_receipt->>'status' = 'ok' then
      update public.push_delivery_outbox
      set status = 'delivered', delivered_at = now(),
          receipt_request_id = null, receipt_requested_at = null,
          last_error = null, updated_at = now()
      where id = r.id;
    elsif v_receipt #>> '{details,error}' = 'DeviceNotRegistered' then
      delete from public.user_push_tokens
      where user_id = r.provider_id and expo_push_token = r.expo_push_token;
      update public.push_delivery_outbox
      set status = 'failed',
          last_error = coalesce(v_receipt->>'message', 'DeviceNotRegistered'),
          receipt_request_id = null, receipt_requested_at = null,
          updated_at = now()
      where id = r.id;
    else
      update public.push_delivery_outbox
      set status = 'accepted', receipt_request_id = null,
          receipt_requested_at = null,
          next_attempt_at = now() + interval '5 minutes',
          last_error = left(coalesce(v_receipt->>'message', v_response.error_msg,
                                     'Delivery receipt not available yet'), 500),
          updated_at = now()
      where id = r.id;
    end if;
    v_processed := v_processed + 1;
  end loop;

  -- Request receipts for accepted tickets. Expo receipts are not available immediately.
  for r in
    select *
    from public.push_delivery_outbox
    where status = 'accepted'
      and expo_ticket_id is not null
      and next_attempt_at <= now()
      and receipt_request_id is null
    order by sent_at
    for update skip locked
    limit 100
  loop
    v_request_id := net.http_post(
      url := 'https://exp.host/--/api/v2/push/getReceipts',
      body := jsonb_build_object('ids', jsonb_build_array(r.expo_ticket_id)),
      headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb,
      timeout_milliseconds := 5000
    );
    update public.push_delivery_outbox
    set status = 'receipt_pending',
        receipt_request_id = v_request_id,
        receipt_requested_at = now(),
        updated_at = now()
    where id = r.id;
    v_processed := v_processed + 1;
  end loop;

  -- Expired or already-claimed offers must never produce a late push.
  update public.push_delivery_outbox o
  set status = 'failed', last_error = 'Offer is no longer active', updated_at = now()
  from public.request_offers ro
  join public.service_requests sr on sr.id = ro.request_id
  where o.offer_id = ro.id and o.request_id = sr.id and o.status = 'queued'
    and (ro.status <> 'pending' or ro.expires_at <= now()
      or sr.status not in ('pending', 'searching') or sr.provider_id is not null);

  -- Submit due notifications in bounded batches; each message has its own retry state.
  for r in
    select o.*
    from public.push_delivery_outbox o
    join public.request_offers ro on ro.id = o.offer_id
    join public.service_requests sr on sr.id = o.request_id
    where o.status = 'queued' and o.next_attempt_at <= now() and o.attempts < 6
      and ro.status = 'pending' and ro.expires_at > now()
      and sr.status in ('pending', 'searching') and sr.provider_id is null
    order by o.created_at
    for update of o skip locked
    limit 100
  loop
    v_request_id := net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := r.payload,
      headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb,
      timeout_milliseconds := 5000
    );
    update public.push_delivery_outbox
    set status = 'sending',
        attempts = attempts + 1,
        http_request_id = v_request_id,
        submitted_at = now(),
        last_error = null,
        updated_at = now()
    where id = r.id;
    v_processed := v_processed + 1;
  end loop;

  update public.push_delivery_outbox
  set status = 'failed', last_error = coalesce(last_error, 'Retry limit reached'),
      updated_at = now()
  where status = 'queued' and attempts >= 6;

  return v_processed;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_request_offer_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_type text;
  v_pickup text;
  v_title text;
  v_body text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select r.type::text, r.pickup_text
    into v_type, v_pickup
  from public.service_requests r
  where r.id = new.request_id;

  if not found then
    return new;
  end if;

  if v_type = 'taxi' then
    v_title := 'طلب رحلة جديد';
    v_body := 'وصلتك رحلة جديدة' ||
      case when nullif(trim(v_pickup), '') is not null
        then ' من ' || left(trim(v_pickup), 90)
        else ''
      end || '. افتح ممنون للرد.';
  else
    v_title := 'طلب خدمة جديد';
    v_body := 'وصلك طلب خدمة جديد من زبون قريب. افتح ممنون للتفاصيل.';
  end if;

  insert into public.notifications(user_id, type, title, body, link, data)
  values (
    new.provider_id,
    'request_offer',
    v_title,
    v_body,
    '/request/' || new.request_id::text,
    jsonb_build_object(
      'type', 'request_offer',
      'request_id', new.request_id,
      'offer_id', new.id
    )
  );

  insert into public.push_delivery_outbox(
    offer_id, request_id, provider_id, expo_push_token, payload
  )
  select
    new.id,
    new.request_id,
    new.provider_id,
    t.expo_push_token,
    jsonb_build_object(
      'to', t.expo_push_token,
      'title', v_title,
      'body', v_body,
      'sound', 'default',
      'priority', 'high',
      'channelId', 'default',
      'data', jsonb_build_object(
        'type', 'request_offer',
        'request_id', new.request_id,
        'offer_id', new.id,
        'url', '/request/' || new.request_id::text
      )
    )
  from public.user_push_tokens t
  where t.user_id = new.provider_id
    and t.expo_push_token like 'ExpoPushToken[%'
       or (t.user_id = new.provider_id and t.expo_push_token like 'ExponentPushToken[%')
  on conflict (offer_id, expo_push_token) do nothing;

  -- Send the first notification immediately; the cron worker handles retries.
  perform public.process_mamnoon_push_outbox();

  return new;
end;
$function$
;
