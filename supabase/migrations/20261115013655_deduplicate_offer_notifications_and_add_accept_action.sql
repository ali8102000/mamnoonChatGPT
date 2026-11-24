CREATE OR REPLACE FUNCTION public.enqueue_request_offer_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Dispatch functions create the single authoritative ride_offer/service_offer
  -- notification after inserting each targeted offer. Avoid generating a second
  -- notification and push from this request_offers trigger.
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_request_id uuid;
  v_category_id text;
  v_body text;
  v_priority text;
BEGIN
  IF NEW.type = 'request_offer' THEN
    RETURN NEW;
  END IF;

  IF (NEW.data->>'request_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_request_id := (NEW.data->>'request_id')::uuid;
  END IF;

  IF NEW.type = 'service_offer'
     OR (NEW.type = 'ride_offer' AND NULLIF(NEW.data->>'vehicle_type', '') IS NULL) THEN
    v_category_id := 'incoming_request';
  END IF;

  v_body := CASE
    WHEN NEW.type IN ('service_offer', 'ride_offer')
      THEN replace(NEW.body, 'لديك دقيقة', 'لديك 3 دقائق')
    ELSE NEW.body
  END;

  v_priority := CASE
    WHEN NEW.data->>'plan' = 'gold'
      OR NEW.type IN ('service_offer', 'ride_offer')
      THEN 'high'
    ELSE 'normal'
  END;

  INSERT INTO public.push_delivery_outbox(
    notification_id, request_id, provider_id, expo_push_token, payload
  )
  SELECT
    NEW.id,
    v_request_id,
    NEW.user_id,
    t.expo_push_token,
    jsonb_strip_nulls(jsonb_build_object(
      'to', t.expo_push_token,
      'title', NEW.title,
      'body', v_body,
      'sound', 'default',
      'priority', v_priority,
      'channelId', 'default',
      'categoryId', v_category_id,
      'data', jsonb_build_object(
        'type', NEW.type,
        'notification_id', NEW.id,
        'request_id', NEW.data->>'request_id',
        'url', COALESCE(NEW.link, '/profile')
      )
    ))
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
