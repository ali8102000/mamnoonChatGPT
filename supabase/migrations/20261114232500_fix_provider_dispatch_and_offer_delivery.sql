-- Keep the caller-scoped public entitlement helper intact; system dispatch needs an internal variant.
CREATE OR REPLACE FUNCTION public.mamnoon_provider_subscription_active_internal(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_enabled boolean;
BEGIN
 SELECT subscription_enabled INTO v_enabled FROM public.subscription_settings WHERE id=1;
 IF NOT COALESCE(v_enabled,false) THEN RETURN true; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=p_user_id AND ur.role::text IN ('worker','driver','large_driver')) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.user_subscriptions us WHERE us.user_id=p_user_id AND us.status='paused' AND (us.current_period_end IS NULL OR us.current_period_end>now())) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.user_subscriptions us WHERE us.user_id=p_user_id AND us.status='active' AND ((us.is_trial AND us.trial_ends_at>now()) OR (us.current_period_end IS NOT NULL AND us.current_period_end>now()) OR (us.current_period_end IS NULL AND us.grant_type='admin'))) THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM public.subscription_plans sp WHERE sp.code='free' AND sp.is_active=true);
END;
$function$;
REVOKE ALL ON FUNCTION public.mamnoon_provider_subscription_active_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mamnoon_provider_subscription_active_internal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mamnoon_provider_subscription_active_internal(uuid) FROM authenticated;
COMMENT ON FUNCTION public.mamnoon_provider_subscription_active_internal(uuid) IS 'Internal entitlement check for owner-executed dispatch and provider discovery functions. Not executable by client roles.';
DO $migration$
DECLARE v_signature text; v_oid regprocedure; v_definition text; v_occurrences integer;
BEGIN
 FOREACH v_signature IN ARRAY ARRAY['public.advance_service_dispatch(uuid)','public.find_nearby_drivers(numeric,numeric,text,numeric,integer)','public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,integer)'] LOOP
  v_oid:=to_regprocedure(v_signature);
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required dispatch function is missing: %',v_signature; END IF;
  SELECT pg_get_functiondef(v_oid::oid) INTO v_definition;
  SELECT count(*) INTO v_occurrences FROM regexp_matches(v_definition,'public\\.mamnoon_provider_subscription_active\\(','g');
  IF v_occurrences<>1 THEN RAISE EXCEPTION 'Unexpected subscription helper references in %: %',v_signature,v_occurrences; END IF;
  v_definition:=regexp_replace(v_definition,'public\\.mamnoon_provider_subscription_active\\(','public.mamnoon_provider_subscription_active_internal(','g');
  EXECUTE v_definition;
 END LOOP;
END
$migration$;

-- A provider must only see an actionable offer while its 60-second timer is live.
CREATE OR REPLACE FUNCTION public.has_offer(_request_id uuid,_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 SELECT CASE WHEN auth.uid() IS NULL OR _user_id IS DISTINCT FROM auth.uid() THEN false
 ELSE EXISTS(SELECT 1 FROM public.request_offers o WHERE o.request_id=_request_id AND o.provider_id=auth.uid() AND o.status='pending' AND o.expires_at>now()) END
$function$;

-- Renewing an expired dispatch row must also enqueue a fresh push to that provider.
CREATE OR REPLACE FUNCTION public.enqueue_request_offer_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_type text; v_pickup text; v_title text; v_body text;
BEGIN
 IF NEW.status<>'pending' OR NEW.expires_at<=now() OR NEW.proposed_price IS NOT NULL THEN RETURN NEW; END IF;
 SELECT r.type::text,r.pickup_text INTO v_type,v_pickup FROM public.service_requests r WHERE r.id=NEW.request_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF v_type='taxi' THEN
  v_title:='طلب رحلة جديد';
  v_body:='وصلتك رحلة جديدة'||CASE WHEN NULLIF(trim(v_pickup),'') IS NOT NULL THEN ' من '||left(trim(v_pickup),90) ELSE '' END||'. لديك دقيقة للرد في ممنون.';
 ELSE
  v_title:='طلب خدمة جديد'; v_body:='وصلك طلب خدمة جديد من زبون قريب. لديك دقيقة للرد في ممنون.';
 END IF;
 INSERT INTO public.notifications(user_id,type,title,body,link,data)
 VALUES(NEW.provider_id,'request_offer',v_title,v_body,'/request/'||NEW.request_id::text,jsonb_build_object('type','request_offer','request_id',NEW.request_id,'offer_id',NEW.id));
 INSERT INTO public.push_delivery_outbox(offer_id,request_id,provider_id,expo_push_token,payload)
 SELECT NEW.id,NEW.request_id,NEW.provider_id,t.expo_push_token,
  jsonb_build_object('to',t.expo_push_token,'title',v_title,'body',v_body,'sound','default','priority','high','channelId','default',
   'data',jsonb_build_object('type','request_offer','request_id',NEW.request_id,'offer_id',NEW.id,'url','/request/'||NEW.request_id::text))
 FROM public.user_push_tokens t
 WHERE t.user_id=NEW.provider_id AND (t.expo_push_token LIKE 'ExpoPushToken[%' OR t.expo_push_token LIKE 'ExponentPushToken[%')
 ON CONFLICT(offer_id,expo_push_token) DO UPDATE SET status='queued',payload=EXCLUDED.payload,attempts=0,next_attempt_at=now(),
  http_request_id=NULL,submitted_at=NULL,expo_ticket_id=NULL,receipt_request_id=NULL,receipt_requested_at=NULL,
  sent_at=NULL,delivered_at=NULL,last_error=NULL,created_at=now(),updated_at=now();
 PERFORM public.process_mamnoon_push_outbox();
 RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_requeue_request_offer_push ON public.request_offers;
CREATE TRIGGER trg_requeue_request_offer_push AFTER UPDATE OF status,expires_at,sent_at ON public.request_offers
FOR EACH ROW WHEN(NEW.status='pending' AND NEW.proposed_price IS NULL AND
 (OLD.status IS DISTINCT FROM NEW.status OR OLD.expires_at IS DISTINCT FROM NEW.expires_at OR OLD.sent_at IS DISTINCT FROM NEW.sent_at))
EXECUTE FUNCTION public.enqueue_request_offer_push();
