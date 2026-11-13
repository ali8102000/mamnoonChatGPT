-- lovable-cron-fallback-reviewed: Time-based 60-second driver offers require persisted transitions; wake only on enqueue and unschedule after drain, 5-second delivery tolerance.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE TABLE public.taxi_dispatch_queue (
 request_id uuid PRIMARY KEY REFERENCES public.service_requests(id) ON DELETE CASCADE,
 stage integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.taxi_dispatch_queue TO service_role;
ALTER TABLE public.taxi_dispatch_queue ENABLE ROW LEVEL SECURITY;
CREATE INDEX taxi_dispatch_next_at ON public.taxi_dispatch_queue(next_at);
ALTER TABLE public.request_offers ALTER COLUMN expires_at SET DEFAULT (now() + interval '60 seconds');
CREATE OR REPLACE FUNCTION public.advance_taxi_dispatch(_request_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.service_requests%ROWTYPE; q public.taxi_dispatch_queue%ROWTYPE; v_radius numeric; v_min numeric; v_count integer;
BEGIN
 SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
 SELECT * INTO q FROM public.taxi_dispatch_queue WHERE request_id = _request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 IF r.status NOT IN ('pending','searching') OR r.provider_id IS NOT NULL THEN DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id; RETURN 0; END IF;
 IF q.next_at > now() THEN RETURN 0; END IF;
 UPDATE public.request_offers SET status = 'expired', responded_at = now() WHERE request_id = _request_id AND status = 'pending' AND expires_at <= now();
 IF q.stage >= 3 THEN
   DELETE FROM public.taxi_dispatch_queue WHERE request_id = _request_id;
   UPDATE public.service_requests SET status = 'cancelled', cancellation_reason = 'لم يقبل أي سائق الطلب بعد انتهاء مراحل البحث', cancelled_by = NULL WHERE id = _request_id;
   UPDATE public.request_offers SET status = 'cancelled' WHERE request_id = _request_id AND status = 'pending';
   INSERT INTO public.notifications(user_id,type,title,body,link) VALUES (r.customer_id,'request_cancelled','أُلغي الطلب تلقائياً','لم يتوفر سائق يقبل طلبك؛ يمكنك المحاولة مرة أخرى','/request/' || _request_id);
   RETURN 0;
 END IF;
 v_radius := (ARRAY[2,5,10]::numeric[])[q.stage+1];
 v_min := (ARRAY[-1,2,5]::numeric[])[q.stage+1];
 WITH inserted AS (
   INSERT INTO public.request_offers(request_id,provider_id,distance_km,status,sent_at,expires_at)
   SELECT _request_id,d.user_id,d.distance_km,'pending',now(),now()+interval '60 seconds'
   FROM public.find_nearby_drivers(r.pickup_lat,r.pickup_lng,r.vehicle_category::text,v_radius,100) d
   WHERE d.distance_km > v_min AND d.user_id <> r.customer_id
     AND NOT EXISTS(SELECT 1 FROM public.request_offers o WHERE o.request_id=_request_id AND o.provider_id=d.user_id)
   ORDER BY d.distance_km LIMIT 10 ON CONFLICT(request_id,provider_id) DO NOTHING RETURNING provider_id
 )
 INSERT INTO public.notifications(user_id,type,title,body,link)
 SELECT provider_id,'ride_offer','طلب رحلة جديد','لديك دقيقة لقبول الرحلة من ' || COALESCE(r.pickup_text,'الموقع المحدد') || ' إلى ' || COALESCE(r.dest_text,'الوجهة المحددة'),'/request/' || _request_id FROM inserted;
 GET DIAGNOSTICS v_count = ROW_COUNT;
 UPDATE public.taxi_dispatch_queue SET stage=q.stage+1,next_at=now()+interval '60 seconds' WHERE request_id=_request_id;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.advance_taxi_dispatch(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.advance_taxi_dispatch(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.process_taxi_dispatch()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(91840060);
 FOR v_id IN SELECT request_id FROM public.taxi_dispatch_queue WHERE next_at<=now() ORDER BY next_at LIMIT 100 LOOP PERFORM public.advance_taxi_dispatch(v_id); END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.taxi_dispatch_queue) THEN PERFORM cron.unschedule('mamnoon-taxi-dispatch'); END IF;
END $$;
REVOKE ALL ON FUNCTION public.process_taxi_dispatch() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_taxi_dispatch() TO service_role;
CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NEW.type='taxi' THEN
   IF NEW.distance_km IS NULL OR NEW.distance_km < 0 OR NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL OR NEW.dest_lat IS NULL OR NEW.dest_lng IS NULL THEN RAISE EXCEPTION 'مسافة الطريق ونقطتا الانطلاق والوجهة مطلوبة'; END IF;
   NEW.price_estimate := NEW.distance_km * 400; NEW.commission := 0; NEW.status := 'searching'; NEW.searching_started_at := now();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.prepare_taxi_request() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER taxi_prepare BEFORE INSERT ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public.prepare_taxi_request();
CREATE OR REPLACE FUNCTION public.on_taxi_dispatch_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NEW.type <> 'taxi' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(91840060);
 IF NEW.status IN ('pending','searching') AND NEW.provider_id IS NULL THEN
   IF TG_OP='INSERT' OR OLD.status NOT IN ('pending','searching') THEN
     INSERT INTO public.taxi_dispatch_queue(request_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
     PERFORM public.advance_taxi_dispatch(NEW.id);
     PERFORM cron.schedule('mamnoon-taxi-dispatch','5 seconds','SELECT public.process_taxi_dispatch()');
   END IF;
 ELSE
   DELETE FROM public.taxi_dispatch_queue WHERE request_id=NEW.id;
   UPDATE public.request_offers SET status='cancelled',responded_at=now() WHERE request_id=NEW.id AND status='pending' AND provider_id IS DISTINCT FROM NEW.provider_id;
   IF NOT EXISTS(SELECT 1 FROM public.taxi_dispatch_queue) THEN PERFORM cron.unschedule('mamnoon-taxi-dispatch'); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.on_taxi_dispatch_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER taxi_dispatch_changed AFTER INSERT OR UPDATE OF status ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public.on_taxi_dispatch_change();
CREATE OR REPLACE FUNCTION public.accept_service_request(_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_customer uuid; v_updated integer; r public.service_requests%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
 IF NOT (public.has_role(auth.uid(),'driver') OR public.has_role(auth.uid(),'worker')) THEN RAISE EXCEPTION 'provider_role_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_blocks b WHERE b.user_id=auth.uid() AND (b.expires_at IS NULL OR b.expires_at>now())) THEN RAISE EXCEPTION 'user_blocked'; END IF;
 PERFORM pg_advisory_xact_lock(91840060);
 SELECT * INTO r FROM public.service_requests WHERE id=_request_id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('pending','searching') OR r.provider_id IS NOT NULL THEN RAISE EXCEPTION 'request_unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.service_requests WHERE provider_id=auth.uid() AND status IN ('accepted','in_progress')) THEN RAISE EXCEPTION 'لديك رحلة نشطة بالفعل'; END IF;
 UPDATE public.service_requests SET provider_id=auth.uid(),status='accepted',accepted_at=now()
 WHERE id=_request_id AND ((type='taxi' AND public.has_role(auth.uid(),'driver') AND EXISTS(
 SELECT 1 FROM public.request_offers o WHERE o.request_id=_request_id AND o.provider_id=auth.uid() AND o.status='pending' AND o.expires_at>now()))
 OR (type='service' AND public.has_role(auth.uid(),'worker') AND (service_id IS NULL OR EXISTS(SELECT 1 FROM public.worker_services ws WHERE ws.worker_id=auth.uid() AND ws.service_id=service_requests.service_id))))
 RETURNING customer_id INTO v_customer;
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 IF v_updated=0 THEN RAISE EXCEPTION 'request_unavailable'; END IF;
 INSERT INTO public.chats(request_id,customer_id,provider_id) VALUES(_request_id,v_customer,auth.uid()) ON CONFLICT(request_id) DO UPDATE SET provider_id=EXCLUDED.provider_id,updated_at=now();
 UPDATE public.request_offers SET status='accepted',responded_at=now() WHERE request_id=_request_id AND provider_id=auth.uid();
 INSERT INTO public.notifications(user_id,type,title,body,link) VALUES(v_customer,'request_accepted','تم قبول طلبك','مقدّم الخدمة في الطريق إليك','/request/' || _request_id);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.accept_service_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_service_request(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.reject_request_offer(_offer_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
 UPDATE public.request_offers SET status='rejected',responded_at=now() WHERE id=_offer_id AND provider_id=auth.uid() AND status='pending' AND expires_at>now();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.reject_request_offer(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reject_request_offer(uuid) TO authenticated;
DROP POLICY "Provider updates own offer" ON public.request_offers;
REVOKE UPDATE ON public.request_offers FROM authenticated;

CREATE OR REPLACE FUNCTION public.round_to_250(n numeric) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT round(n / 250) * 250 $$;
CREATE OR REPLACE FUNCTION public.round_taxi_price_estimate() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.type = 'taxi' AND NEW.price_estimate IS NOT NULL THEN NEW.price_estimate := GREATEST(1000, public.round_to_250(NEW.price_estimate)); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_taxi_round_price ON public.service_requests;
CREATE TRIGGER zz_taxi_round_price BEFORE INSERT ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public.round_taxi_price_estimate();

CREATE TABLE public.provider_presence (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  heading double precision,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_presence TO authenticated;
GRANT ALL ON public.provider_presence TO service_role;
ALTER TABLE public.provider_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own presence read" ON public.provider_presence FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own presence insert" ON public.provider_presence FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own presence update" ON public.provider_presence FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own presence delete" ON public.provider_presence FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE OR REPLACE FUNCTION public.touch_provider_presence() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DO $$
BEGIN
  -- Some deployments create provider_presence in a later migration.
  -- Attach the timestamp trigger when the table already exists; migration
  -- 0005 creates it and attaches this trigger otherwise.
  IF to_regclass('public.provider_presence') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS provider_presence_touch ON public.provider_presence';
    EXECUTE 'CREATE TRIGGER provider_presence_touch BEFORE INSERT OR UPDATE ON public.provider_presence FOR EACH ROW EXECUTE FUNCTION public.touch_provider_presence()';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_nearby_drivers(_lat numeric, _lng numeric, _category text, _radius_km numeric DEFAULT 5, _limit int DEFAULT 10)
RETURNS TABLE(user_id uuid, distance_km numeric, rating_avg numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT x.user_id, x.distance_km, x.rating_avg FROM (
    SELECT DISTINCT ON (dp.user_id) dp.user_id, dp.rating_avg,
      (6371 * acos(LEAST(1.0, GREATEST(-1.0,
        cos(radians(_lat)) * cos(radians(loc.lat)) * cos(radians(loc.lng) - radians(_lng)) + sin(radians(_lat)) * sin(radians(loc.lat))))))::numeric AS distance_km
    FROM public.driver_profiles dp
    JOIN (
      SELECT pp.user_id, pp.lat, pp.lng, pp.updated_at FROM public.provider_presence pp
      UNION ALL
      SELECT ll.user_id, ll.lat, ll.lng, ll.updated_at FROM public.live_locations ll
    ) loc ON loc.user_id = dp.user_id
    WHERE dp.available AND dp.status = 'approved'
      AND (_category IS NULL OR dp.vehicle_category::text = _category)
      AND loc.updated_at > now() - interval '5 minutes'
      AND NOT EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.provider_id = dp.user_id AND sr.status IN ('accepted','in_progress'))
      AND NOT EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.user_id = dp.user_id AND (b.expires_at IS NULL OR b.expires_at > now()))
    ORDER BY dp.user_id, loc.updated_at DESC
  ) x
  WHERE x.distance_km <= _radius_km
  ORDER BY x.distance_km ASC, x.rating_avg DESC NULLS LAST
  LIMIT _limit
$$;
REVOKE ALL ON FUNCTION public.find_nearby_drivers(numeric,numeric,text,numeric,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_nearby_drivers(numeric,numeric,text,numeric,int) TO service_role;

CREATE OR REPLACE FUNCTION public.find_nearby_provider_pins(_lat numeric, _lng numeric, _type text, _category text DEFAULT NULL, _service_id uuid DEFAULT NULL, _radius_km numeric DEFAULT 5, _limit int DEFAULT 30)
RETURNS TABLE(pin_id text, lat numeric, lng numeric, heading numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(pp.user_id::text), pp.lat::numeric, pp.lng::numeric, pp.heading::numeric
  FROM public.provider_presence pp
  WHERE pp.updated_at > now() - interval '5 minutes'
    AND ((_type = 'taxi' AND EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = pp.user_id AND dp.available AND dp.status = 'approved' AND (_category IS NULL OR dp.vehicle_category::text = _category)))
      OR (_type = 'service' AND EXISTS (SELECT 1 FROM public.worker_profiles wp WHERE wp.user_id = pp.user_id AND wp.available
            AND (_service_id IS NULL OR EXISTS (SELECT 1 FROM public.worker_services ws WHERE ws.worker_id = wp.user_id AND ws.service_id = _service_id)))))
    AND 6371 * acos(LEAST(1.0, GREATEST(-1.0, cos(radians(_lat)) * cos(radians(pp.lat)) * cos(radians(pp.lng) - radians(_lng)) + sin(radians(_lat)) * sin(radians(pp.lat))))) <= _radius_km
  ORDER BY pp.updated_at DESC
  LIMIT _limit
$$;
REVOKE ALL ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_nearby_provider_pins(numeric,numeric,text,text,uuid,numeric,int) TO authenticated, service_role;