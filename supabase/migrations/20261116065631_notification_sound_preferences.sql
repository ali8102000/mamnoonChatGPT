-- Let each signed-in user control sound and vibration for remote notifications.
ALTER TABLE public.user_push_tokens
  ADD COLUMN IF NOT EXISTS sound_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.enqueue_request_offer_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_type text;
  v_pickup text;
  v_title text;
  v_body text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT r.type::text, r.pickup_text
    INTO v_type, v_pickup
  FROM public.service_requests r
  WHERE r.id = NEW.request_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_type = 'taxi' THEN
    v_title := 'طلب رحلة جديد';
    v_body := 'وصلتك رحلة جديدة' ||
      CASE WHEN nullif(trim(v_pickup), '') IS NOT NULL
        THEN ' من ' || left(trim(v_pickup), 90)
        ELSE ''
      END || '. افتح ممنون للرد.';
  ELSE
    v_title := 'طلب خدمة جديد';
    v_body := 'وصلك طلب خدمة جديد من زبون قريب. افتح ممنون للتفاصيل.';
  END IF;

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (
    NEW.provider_id,
    'request_offer',
    v_title,
    v_body,
    '/request/' || NEW.request_id::text,
    jsonb_build_object(
      'type', 'request_offer',
      'request_id', NEW.request_id,
      'offer_id', NEW.id
    )
  );

  INSERT INTO public.push_delivery_outbox(
    offer_id, request_id, provider_id, expo_push_token, payload
  )
  SELECT
    NEW.id,
    NEW.request_id,
    NEW.provider_id,
    t.expo_push_token,
    jsonb_build_object(
      'to', t.expo_push_token,
      'title', v_title,
      'body', v_body,
      'sound', CASE WHEN coalesce(t.sound_enabled, true) THEN 'default' ELSE NULL END,
      'priority', 'high',
      'channelId', CASE WHEN coalesce(t.sound_enabled, true) THEN 'default' ELSE 'silent' END,
      'data', jsonb_build_object(
        'type', 'request_offer',
        'request_id', NEW.request_id,
        'offer_id', NEW.id,
        'url', '/request/' || NEW.request_id::text
      )
    )
  FROM public.user_push_tokens t
  WHERE t.user_id = NEW.provider_id
    AND (
      t.expo_push_token LIKE 'ExpoPushToken[%'
      OR t.expo_push_token LIKE 'ExponentPushToken[%'
    )
  ON CONFLICT (offer_id, expo_push_token) DO NOTHING;

  PERFORM public.process_mamnoon_push_outbox();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_request_offer_push() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.type = 'request_offer' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.push_delivery_outbox(
    notification_id, request_id, provider_id, expo_push_token, payload
  )
  SELECT
    NEW.id,
    CASE
      WHEN (NEW.data->>'request_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (NEW.data->>'request_id')::uuid
      ELSE NULL
    END,
    NEW.user_id,
    t.expo_push_token,
    jsonb_build_object(
      'to', t.expo_push_token,
      'title', NEW.title,
      'body', NEW.body,
      'sound', CASE WHEN coalesce(t.sound_enabled, true) THEN 'default' ELSE NULL END,
      'priority', CASE WHEN NEW.data->>'plan' = 'gold' THEN 'high' ELSE 'normal' END,
      'channelId', CASE WHEN coalesce(t.sound_enabled, true) THEN 'default' ELSE 'silent' END,
      'data', jsonb_build_object(
        'type', NEW.type,
        'notification_id', NEW.id,
        'request_id', NEW.data->>'request_id',
        'url', COALESCE(NEW.link, '/profile')
      )
    )
  FROM public.user_push_tokens t
  WHERE t.user_id = NEW.user_id
    AND (
      t.expo_push_token LIKE 'ExpoPushToken[%'
      OR t.expo_push_token LIKE 'ExponentPushToken[%'
    )
  ON CONFLICT (notification_id, expo_push_token)
  WHERE notification_id IS NOT NULL
  DO NOTHING;

  PERFORM public.process_mamnoon_push_outbox();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_notification_push() FROM PUBLIC, anon, authenticated;
