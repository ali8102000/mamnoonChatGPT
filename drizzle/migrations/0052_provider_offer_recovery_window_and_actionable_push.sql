CREATE OR REPLACE FUNCTION public.ensure_provider_offer_minimum_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    NEW.expires_at := GREATEST(
      COALESCE(NEW.expires_at, now()),
      now() + interval '3 minutes'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_provider_offer_minimum_window_insert ON public.request_offers;
CREATE TRIGGER trg_provider_offer_minimum_window_insert
BEFORE INSERT ON public.request_offers
FOR EACH ROW
EXECUTE FUNCTION public.ensure_provider_offer_minimum_window();

DROP TRIGGER IF EXISTS trg_provider_offer_minimum_window_update ON public.request_offers;
CREATE TRIGGER trg_provider_offer_minimum_window_update
BEFORE UPDATE OF status, expires_at ON public.request_offers
FOR EACH ROW
EXECUTE FUNCTION public.ensure_provider_offer_minimum_window();

CREATE OR REPLACE FUNCTION public.enqueue_request_offer_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_type text;
  v_pickup text;
  v_vehicle_category text;
  v_title text;
  v_body text;
  v_category_id text;
BEGIN
  IF NEW.status <> 'pending' OR NEW.expires_at <= now() OR NEW.proposed_price IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.type::text, r.pickup_text, r.vehicle_category::text
    INTO v_type, v_pickup, v_vehicle_category
  FROM public.service_requests r
  WHERE r.id = NEW.request_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_type = 'taxi' THEN
    v_title := 'طلب رحلة جديد';
    v_body := 'وصلتك رحلة جديدة' ||
      CASE WHEN NULLIF(trim(v_pickup), '') IS NOT NULL
        THEN ' من ' || left(trim(v_pickup), 90)
        ELSE ''
      END || '. لديك 3 دقائق للرد في ممنون.';
  ELSE
    v_title := 'طلب خدمة جديد';
    v_body := 'وصلك طلب خدمة جديد من زبون قريب. لديك 3 دقائق للرد في ممنون.';
  END IF;

  IF NOT (v_type = 'taxi' AND v_vehicle_category = 'large') THEN
    v_category_id := 'incoming_request';
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
    jsonb_strip_nulls(jsonb_build_object(
      'to', t.expo_push_token,
      'title', v_title,
      'body', v_body,
      'sound', 'default',
      'priority', 'high',
      'channelId', 'default',
      'categoryId', v_category_id,
      'data', jsonb_build_object(
        'type', 'request_offer',
        'request_id', NEW.request_id,
        'offer_id', NEW.id,
        'url', '/request/' || NEW.request_id::text
      )
    ))
  FROM public.user_push_tokens t
  WHERE t.user_id = NEW.provider_id
    AND (
      t.expo_push_token LIKE 'ExpoPushToken[%'
      OR t.expo_push_token LIKE 'ExponentPushToken[%'
    )
  ON CONFLICT (offer_id, expo_push_token) DO UPDATE
  SET status = 'queued',
      payload = EXCLUDED.payload,
      attempts = 0,
      next_attempt_at = now(),
      http_request_id = NULL,
      submitted_at = NULL,
      expo_ticket_id = NULL,
      receipt_request_id = NULL,
      receipt_requested_at = NULL,
      sent_at = NULL,
      delivered_at = NULL,
      last_error = NULL,
      created_at = now(),
      updated_at = now();

  PERFORM public.process_mamnoon_push_outbox();
  RETURN NEW;
END;
$function$;
