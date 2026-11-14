create extension if not exists pg_net;

create table if not exists public.push_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.request_offers(id) on delete cascade,
  request_id uuid not null references public.service_requests(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  payload jsonb not null,
  status text not null default 'queued'
    check (status in ('queued','sending','accepted','receipt_pending','delivered','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  http_request_id bigint,
  submitted_at timestamptz,
  expo_ticket_id text,
  receipt_request_id bigint,
  receipt_requested_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offer_id, expo_push_token)
);

create index if not exists idx_push_delivery_outbox_due
  on public.push_delivery_outbox (next_attempt_at, created_at)
  where status = 'queued';
create index if not exists idx_push_delivery_outbox_sending
  on public.push_delivery_outbox (submitted_at)
  where status = 'sending';
create index if not exists idx_push_delivery_outbox_receipts
  on public.push_delivery_outbox (receipt_requested_at)
  where status = 'receipt_pending';

alter table public.push_delivery_outbox enable row level security;
revoke all on table public.push_delivery_outbox from public, anon, authenticated;

create or replace function public.enqueue_request_offer_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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
    jsonb_build_object('type', 'request_offer', 'request_id', new.request_id, 'offer_id', new.id)
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
    and (
      t.expo_push_token like 'ExpoPushToken[%'
      or t.expo_push_token like 'ExponentPushToken[%'
    )
  on conflict (offer_id, expo_push_token) do nothing;

  return new;
end;
$function$;

revoke all on function public.enqueue_request_offer_push() from public, anon, authenticated;

drop trigger if exists trg_enqueue_request_offer_push on public.request_offers;
create trigger trg_enqueue_request_offer_push
after insert on public.request_offers
for each row
when (new.status = 'pending')
execute function public.enqueue_request_offer_push();

create or replace function public.process_mamnoon_push_outbox()
returns integer
language plpgsql
security definer
set search_path = public, net, pg_temp
as $function$
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
  for r in
    select * from public.push_delivery_outbox
    where status = 'sending' and http_request_id is not null
    order by submitted_at
    for update skip locked
    limit 100
  loop
    select * into v_response from net._http_response where id = r.http_request_id;
    if not found then
      if r.submitted_at < now() - interval '3 minutes' then
        if r.attempts >= 6 then
          update public.push_delivery_outbox
          set status = 'failed', last_error = 'No response from Expo after retries', updated_at = now()
          where id = r.id;
        else
          update public.push_delivery_outbox
          set status = 'queued',
              next_attempt_at = now() + make_interval(secs =>
                least(300, 15 * power(2, greatest(r.attempts - 1, 0))::integer)),
              http_request_id = null, submitted_at = null,
              last_error = 'Expo request timed out; retry scheduled', updated_at = now()
          where id = r.id;
        end if;
      end if;
      continue;
    end if;

    v_content := '{}'::jsonb;
    begin
      v_content := coalesce(v_response.content, '{}')::jsonb;
    exception when others then
      v_content := '{}'::jsonb;
    end;
    v_ticket := v_content #> '{data,0}';

    if v_response.status_code between 200 and 299
       and v_ticket->>'status' = 'ok'
       and nullif(v_ticket->>'id', '') is not null then
      update public.push_delivery_outbox
      set status = 'accepted', expo_ticket_id = v_ticket->>'id',
          sent_at = now(), http_request_id = null, submitted_at = null,
          last_error = null, updated_at = now()
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
        set status = 'failed', last_error = left(v_error, 500),
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

  for r in
    select * from public.push_delivery_outbox
    where status = 'receipt_pending' and receipt_request_id is not null
    order by receipt_requested_at
    for update skip locked
    limit 100
  loop
    select * into v_response from net._http_response where id = r.receipt_request_id;
    if not found then
      if r.receipt_requested_at < now() - interval '5 minutes' then
        update public.push_delivery_outbox
        set status = 'accepted', receipt_request_id = null,
            receipt_requested_at = null,
            last_error = 'Receipt response delayed; will check again', updated_at = now()
        where id = r.id;
      end if;
      continue;
    end if;

    v_content := '{}'::jsonb;
    begin
      v_content := coalesce(v_response.content, '{}')::jsonb;
    exception when others then
      v_content := '{}'::jsonb;
    end;
    v_receipt := v_content #> array['data', r.expo_ticket_id];

    if v_response.status_code between 200 and 299 and v_receipt->>'status' = 'ok' then
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
          receipt_request_id = null, receipt_requested_at = null, updated_at = now()
      where id = r.id;
    else
      update public.push_delivery_outbox
      set status = 'accepted', receipt_request_id = null,
          receipt_requested_at = null,
          last_error = left(coalesce(v_receipt->>'message', v_response.error_msg,
                                     'Delivery receipt not available yet'), 500),
          updated_at = now()
      where id = r.id;
    end if;
    v_processed := v_processed + 1;
  end loop;

  for r in
    select * from public.push_delivery_outbox
    where status = 'accepted' and expo_ticket_id is not null
      and sent_at <= now() - interval '15 minutes'
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
    set status = 'receipt_pending', receipt_request_id = v_request_id,
        receipt_requested_at = now(), updated_at = now()
    where id = r.id;
    v_processed := v_processed + 1;
  end loop;

  for r in
    select * from public.push_delivery_outbox
    where status = 'queued' and next_attempt_at <= now() and attempts < 6
    order by created_at
    for update skip locked
    limit 100
  loop
    v_request_id := net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := r.payload,
      headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb,
      timeout_milliseconds := 5000
    );
    update public.push_delivery_outbox
    set status = 'sending', attempts = attempts + 1,
        http_request_id = v_request_id, submitted_at = now(),
        last_error = null, updated_at = now()
    where id = r.id;
    v_processed := v_processed + 1;
  end loop;

  update public.push_delivery_outbox
  set status = 'failed', last_error = coalesce(last_error, 'Retry limit reached'),
      updated_at = now()
  where status = 'queued' and attempts >= 6;

  return v_processed;
end;
$function$;

revoke all on function public.process_mamnoon_push_outbox() from public, anon, authenticated;

select cron.schedule(
  'mamnoon-push-outbox',
  '* * * * *',
  'select public.process_mamnoon_push_outbox();'
);
