-- Customer-controlled x2/x3 urgency from the request waiting screen.
-- The percentage itself remains admin-controlled in taxi_pricing_controls. The
-- customer chooses only the multiplier; all price changes are server-authoritative.

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS urgency_base_price numeric,
  ADD COLUMN IF NOT EXISTS urgency_multiplier smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS urgency_percent numeric(7,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS urgency_amount numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.guard_customer_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF current_setting('mamnoon.allow_request_urgency', true) = 'true'
     AND auth.uid() = OLD.customer_id
     AND OLD.customer_id = NEW.customer_id
     AND OLD.provider_id IS NULL AND NEW.provider_id IS NULL
     AND OLD.status IN ('pending','searching')
     AND NEW.status = OLD.status THEN
    IF NEW.type IS DISTINCT FROM OLD.type
       OR NEW.service_id IS DISTINCT FROM OLD.service_id
       OR NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category
       OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
       OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat
       OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng
       OR NEW.dest_lat IS DISTINCT FROM OLD.dest_lat
       OR NEW.dest_lng IS DISTINCT FROM OLD.dest_lng
       OR NEW.commission IS DISTINCT FROM OLD.commission
       OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'request_urgency_immutable_fields_changed';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('mamnoon.allow_large_vehicle_accept', true) = 'true'
     AND OLD.vehicle_category::text = 'large'
     AND NEW.vehicle_category::text = 'large'
     AND auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF current_setting('mamnoon.allow_dispatch_retry', true) = 'true'
     AND auth.uid() = OLD.customer_id
     AND OLD.status = 'cancelled'
     AND NEW.status = 'searching' THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.service_id IS DISTINCT FROM OLD.service_id
       OR NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category
       OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
       OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat
       OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng
       OR NEW.dest_lat IS DISTINCT FROM OLD.dest_lat
       OR NEW.dest_lng IS DISTINCT FROM OLD.dest_lng THEN
      RAISE EXCEPTION 'retry_request_immutable_fields_changed';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.provider_id THEN
    IF current_setting('mamnoon.allow_provider_request_transition', true) = 'true' THEN
      RETURN NEW;
    END IF;
    IF pg_trigger_depth() > 1
       AND (to_jsonb(NEW) - ARRAY['commission', 'updated_at']) =
           (to_jsonb(OLD) - ARRAY['commission', 'updated_at']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'provider_request_update_requires_rpc';
  END IF;

  IF auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN RAISE EXCEPTION 'customer_id_immutable'; END IF;
  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN RAISE EXCEPTION 'provider_id_readonly_for_customer'; END IF;
  IF NEW.type IS DISTINCT FROM OLD.type THEN RAISE EXCEPTION 'type_immutable'; END IF;
  IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN RAISE EXCEPTION 'service_id_immutable'; END IF;
  IF NEW.price_estimate IS DISTINCT FROM OLD.price_estimate THEN RAISE EXCEPTION 'price_readonly_for_customer'; END IF;
  IF NEW.commission IS DISTINCT FROM OLD.commission THEN RAISE EXCEPTION 'commission_readonly'; END IF;
  IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN RAISE EXCEPTION 'accepted_at_readonly'; END IF;
  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN RAISE EXCEPTION 'completed_at_readonly'; END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'cancelled'
       AND OLD.type::text = 'taxi'
       AND OLD.status = 'in_progress' THEN
      RAISE EXCEPTION 'taxi_trip_already_started';
    END IF;
    IF NOT (NEW.status = 'cancelled' AND OLD.status IN ('pending','searching','accepted','in_progress')) THEN
      RAISE EXCEPTION 'invalid_status_transition_for_customer';
    END IF;
    NEW.cancelled_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_request_coupon_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.coupon_code IS DISTINCT FROM OLD.coupon_code
     OR NEW.coupon_id IS DISTINCT FROM OLD.coupon_id
     OR NEW.coupon_discount IS DISTINCT FROM OLD.coupon_discount THEN
    RAISE EXCEPTION 'لا يمكن تعديل الكوبون أو الخصم بعد إرسال الطلب';
  END IF;
  IF NEW.customer_payable IS DISTINCT FROM OLD.customer_payable
     AND current_setting('mamnoon.allow_dispatch_retry', true) IS DISTINCT FROM 'true'
     AND current_setting('mamnoon.allow_request_urgency', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'لا يمكن تعديل المبلغ المستحق بعد إرسال الطلب';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_large_vehicle_customer_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('mamnoon.allow_request_urgency', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.type::text = 'taxi'
     AND NEW.vehicle_category::text = 'large'
     AND NEW.customer_price IS NOT NULL
     AND (NEW.customer_price < 250 OR NEW.customer_price > 50000 OR NEW.customer_price % 250 <> 0) THEN
    RAISE EXCEPTION 'السعر المقترح يجب أن يكون من 250 إلى 50000 دينار ومن مضاعفات 250';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_request_urgency(_request_id uuid, _multiplier smallint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_enabled boolean;
  v_admin_percent numeric;
  v_percent numeric;
  v_base numeric;
  v_new numeric;
  v_pending_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _multiplier NOT IN (2,3) THEN RAISE EXCEPTION 'invalid_urgency_multiplier'; END IF;

  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND OR r.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'request_not_found_or_forbidden';
  END IF;
  IF r.status NOT IN ('pending','searching') OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'urgency_only_available_while_searching';
  END IF;
  IF COALESCE(r.urgency_multiplier,1) >= _multiplier THEN
    RAISE EXCEPTION 'urgency_multiplier_already_applied';
  END IF;

  SELECT urgency_enabled, urgency_max_percent
  INTO v_enabled, v_admin_percent
  FROM public.taxi_pricing_controls
  WHERE governorate_key = 'all';

  IF NOT COALESCE(v_enabled,false) OR COALESCE(v_admin_percent,0) <= 0 THEN
    RAISE EXCEPTION 'urgency_disabled_by_admin';
  END IF;

  IF r.type::text = 'taxi' AND r.vehicle_category::text <> 'large' THEN
    v_base := COALESCE(r.urgency_base_price, r.price_estimate);
  ELSE
    v_base := COALESCE(r.urgency_base_price, r.customer_price);
  END IF;
  IF v_base IS NULL OR v_base <= 0 THEN
    RAISE EXCEPTION 'request_has_no_fixed_price_for_urgency';
  END IF;

  v_percent := LEAST(300, GREATEST(0, v_admin_percent * _multiplier));
  v_new := round((v_base * (1 + v_percent / 100.0)) / 250.0) * 250.0;

  PERFORM set_config('mamnoon.allow_request_urgency','true',true);
  UPDATE public.service_requests
  SET urgency_base_price = COALESCE(urgency_base_price, v_base),
      urgency_multiplier = _multiplier,
      urgency_percent = v_percent,
      urgency_amount = v_new - v_base,
      price_estimate = CASE WHEN type::text = 'taxi' AND vehicle_category::text <> 'large' THEN v_new ELSE price_estimate END,
      customer_price = CASE WHEN type::text = 'service' OR vehicle_category::text = 'large' THEN v_new::integer ELSE customer_price END,
      customer_payable = CASE
        WHEN coupon_id IS NOT NULL THEN GREATEST(v_new - COALESCE(coupon_discount,0),0)
        ELSE v_new
      END,
      taxi_urgency_enabled = (type::text = 'taxi' AND vehicle_category::text <> 'large'),
      taxi_urgency_percent = CASE WHEN type::text = 'taxi' AND vehicle_category::text <> 'large' THEN v_percent ELSE 0 END
  WHERE id = _request_id;
  PERFORM set_config('mamnoon.allow_request_urgency','false',true);

  SELECT count(*)::integer INTO v_pending_count
  FROM public.request_offers
  WHERE request_id = _request_id AND status = 'pending' AND expires_at > now();

  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  SELECT o.provider_id,
         'urgent_request',
         'الزبون فعّل وضع الاستعجال ⚡',
         'تم رفع أجر الطلب إلى ' || to_char(v_new,'FM999,999,999') || ' د.ع. افتح الطلب للاطلاع على الأجر الجديد.',
         '/request/' || r.id,
         jsonb_build_object('request_id',r.id,'urgency_multiplier',_multiplier,'urgency_percent',v_percent,'price_iqd',v_new)
  FROM public.request_offers o
  WHERE o.request_id = _request_id AND o.status = 'pending' AND o.expires_at > now();

  RETURN jsonb_build_object(
    'request_id', _request_id,
    'price', v_new,
    'base_price', v_base,
    'urgency_percent', v_percent,
    'multiplier', _multiplier,
    'notified_providers', v_pending_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_request_urgency(uuid,smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_request_urgency(uuid,smallint) TO authenticated;

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

  INSERT INTO public.push_delivery_outbox(notification_id,request_id,provider_id,expo_push_token,payload)
  SELECT NEW.id,
    CASE WHEN (NEW.data->>'request_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (NEW.data->>'request_id')::uuid ELSE NULL END,
    NEW.user_id,t.expo_push_token,
    jsonb_build_object(
      'to',t.expo_push_token,
      'title',NEW.title,
      'body',NEW.body,
      'sound',CASE WHEN coalesce(t.sound_enabled,true) THEN 'default' ELSE NULL END,
      'priority',CASE WHEN NEW.type IN ('urgent_request','request_accepted') OR NEW.data->>'plan'='gold' THEN 'high' ELSE 'normal' END,
      'channelId',CASE WHEN coalesce(t.sound_enabled,true) THEN 'default' ELSE 'silent' END,
      'data',jsonb_build_object('type',NEW.type,'notification_id',NEW.id,'request_id',NEW.data->>'request_id','url',COALESCE(NEW.link,'/profile'))
    )
  FROM public.user_push_tokens t
  WHERE t.user_id=NEW.user_id
    AND (t.expo_push_token LIKE 'ExpoPushToken[%' OR t.expo_push_token LIKE 'ExponentPushToken[%')
  ON CONFLICT (notification_id,expo_push_token) WHERE notification_id IS NOT NULL DO NOTHING;

  PERFORM public.process_mamnoon_push_outbox();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_request_offer_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_type text;
  v_pickup text;
  v_title text;
  v_body text;
  v_urgency smallint;
  v_price numeric;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT r.type::text, r.pickup_text, r.urgency_multiplier,
         CASE WHEN r.type::text = 'taxi' AND r.vehicle_category::text <> 'large'
           THEN COALESCE(r.customer_payable,r.price_estimate)
           ELSE r.customer_price END
  INTO v_type, v_pickup, v_urgency, v_price
  FROM public.service_requests r
  WHERE r.id = NEW.request_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF COALESCE(v_urgency,1) > 1 THEN
    v_title := 'طلب عاجل ×' || v_urgency::text;
    v_body := 'الزبون فعّل وضع الاستعجال ورفع الأجر إلى ' ||
      to_char(COALESCE(v_price,0),'FM999,999,999') || ' د.ع. افتح ممنون لقبول الطلب.';
  ELSIF v_type = 'taxi' THEN
    v_title := 'طلب رحلة جديد';
    v_body := 'وصلتك رحلة جديدة' ||
      CASE WHEN nullif(trim(v_pickup), '') IS NOT NULL
        THEN ' من ' || left(trim(v_pickup), 90) ELSE '' END || '. افتح ممنون للرد.';
  ELSE
    v_title := 'طلب خدمة جديد';
    v_body := 'وصلك طلب خدمة جديد من زبون قريب. افتح ممنون للتفاصيل.';
  END IF;

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (NEW.provider_id, 'request_offer', v_title, v_body,
    '/request/' || NEW.request_id::text,
    jsonb_build_object('type','request_offer','request_id',NEW.request_id,'offer_id',NEW.id,'urgency_multiplier',COALESCE(v_urgency,1)));

  INSERT INTO public.push_delivery_outbox(offer_id,request_id,provider_id,expo_push_token,payload)
  SELECT NEW.id, NEW.request_id, NEW.provider_id, t.expo_push_token,
    jsonb_build_object(
      'to',t.expo_push_token,'title',v_title,'body',v_body,
      'sound',CASE WHEN coalesce(t.sound_enabled,true) THEN 'default' ELSE NULL END,
      'priority','high',
      'channelId',CASE WHEN coalesce(t.sound_enabled,true) THEN 'default' ELSE 'silent' END,
      'data',jsonb_build_object('type','request_offer','request_id',NEW.request_id,'offer_id',NEW.id,'urgency_multiplier',COALESCE(v_urgency,1),'url','/request/'||NEW.request_id::text))
  FROM public.user_push_tokens t
  WHERE t.user_id=NEW.provider_id
    AND (t.expo_push_token LIKE 'ExpoPushToken[%' OR t.expo_push_token LIKE 'ExponentPushToken[%')
  ON CONFLICT (offer_id,expo_push_token) DO NOTHING;

  PERFORM public.process_mamnoon_push_outbox();
  RETURN NEW;
END;
$function$;


-- A taxi trip cannot be cancelled by either party after the driver starts it.
CREATE OR REPLACE FUNCTION public.cancel_service_request(_request_id uuid, _reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT id, customer_id, provider_id, status, type
  INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF r.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'request_finished'; END IF;

  IF r.type::text = 'taxi' AND r.status = 'in_progress'
     AND (r.customer_id = auth.uid() OR r.provider_id = auth.uid()) THEN
    RAISE EXCEPTION 'taxi_trip_already_started';
  END IF;

  IF r.customer_id = auth.uid() THEN
    UPDATE public.service_requests
    SET status = 'cancelled', cancelled_by = auth.uid(), cancellation_reason = left(_reason, 500)
    WHERE id = _request_id;

    DELETE FROM public.request_offers WHERE request_id = _request_id;
    IF r.provider_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (r.provider_id, 'request_cancelled', 'أُلغي الطلب',
        COALESCE(left(_reason, 200), 'ألغى الزبون الطلب'), '/request/' || _request_id);
    END IF;
    RETURN 'cancelled';

  ELSIF r.provider_id = auth.uid() THEN
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);

    UPDATE public.service_requests
    SET status = 'searching', provider_id = NULL, accepted_at = NULL,
        cancelled_by = auth.uid(), cancellation_reason = left(_reason, 500)
    WHERE id = _request_id;

    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);

    DELETE FROM public.request_offers WHERE request_id = _request_id AND provider_id = auth.uid();
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (r.customer_id, 'provider_released', 'نبحث عن مقدّم خدمة آخر',
      COALESCE(left(_reason, 200), 'اعتذر مقدّم الخدمة'), '/request/' || _request_id);
    RETURN 'released';
  END IF;

  RAISE EXCEPTION 'forbidden';
END;
$function$;
