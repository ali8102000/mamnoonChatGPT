GRANT SELECT, INSERT, UPDATE ON public.driver_profiles TO authenticated;

GRANT ALL ON public.driver_profiles TO service_role;

ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER driver_profiles_updated_at BEFORE UPDATE ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.guard_provider_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_admin_access(auth.uid()) THEN
    IF TG_OP = 'INSERT' THEN NEW.status := 'approved';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'status_readonly'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.rating_avg IS DISTINCT FROM OLD.rating_avg THEN RAISE EXCEPTION 'rating_readonly'; END IF;
    IF NEW.status <> 'approved' AND NEW.available THEN NEW.available := false; END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_provider_status() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_driver_status BEFORE INSERT OR UPDATE ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_provider_status();

CREATE TRIGGER trg_guard_worker_status BEFORE INSERT OR UPDATE ON public.worker_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_provider_status();

CREATE TABLE public.vehicle_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  model text NOT NULL,
  category public.vehicle_category NOT NULL,
  base_fare numeric NOT NULL DEFAULT 2000,
  per_km numeric NOT NULL DEFAULT 500,
  min_year int NOT NULL DEFAULT 2000,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (make, model)
);

GRANT SELECT ON public.vehicle_models TO authenticated, anon;

GRANT ALL ON public.vehicle_models TO service_role;

ALTER TABLE public.vehicle_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vehicle_models readable" ON public.vehicle_models FOR SELECT USING (true);

INSERT INTO public.vehicle_models (make, model, category, base_fare, per_km) VALUES
  ('Kia','Pride','economy',1500,400),('Hyundai','Accent','economy',1500,400),('Toyota','Corolla','economy',2000,500),
  ('Nissan','Sunny','economy',1500,400),('Chevrolet','Aveo','economy',1500,400),('Hyundai','Elantra','premium',2500,650),
  ('Kia','Optima','premium',2500,650),('Toyota','Camry','premium',3000,750),('Honda','Accord','premium',3000,750),
  ('Hyundai','Sonata','premium',2800,700),('Mercedes','E-Class','luxury',5000,1200),('BMW','5 Series','luxury',5000,1200),
  ('Lexus','ES','luxury',4500,1100),('Audi','A6','luxury',5000,1200),('Genesis','G80','luxury',4500,1100);

CREATE TABLE public.service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  type public.request_type NOT NULL,
  status public.request_status NOT NULL DEFAULT 'pending',
  service_id uuid REFERENCES public.services(id),
  level_required public.worker_level,
  workers_count int NOT NULL DEFAULT 1,
  pickup_text text NOT NULL DEFAULT '',
  pickup_lat numeric,
  pickup_lng numeric,
  dest_text text,
  dest_lat numeric,
  dest_lng numeric,
  notes text,
  price_estimate numeric,
  vehicle_category public.vehicle_category,
  distance_km numeric,
  duration_min numeric,
  fare_breakdown jsonb,
  commission numeric,
  payment_method text DEFAULT 'cash',
  cancellation_reason text,
  cancelled_by uuid,
  searching_started_at timestamptz,
  admin_notes text,
  pricing_mode text,
  customer_price integer,
  work_hours numeric,
  work_description text,
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_requests_status ON public.service_requests (status, created_at DESC);

CREATE INDEX idx_service_requests_customer ON public.service_requests (customer_id, created_at DESC);

CREATE INDEX idx_service_requests_provider ON public.service_requests (provider_id, created_at DESC);

CREATE INDEX idx_service_requests_status_type ON public.service_requests (status, type);

GRANT SELECT, INSERT, UPDATE ON public.service_requests TO authenticated;

GRANT ALL ON public.service_requests TO service_role;

ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER service_requests_updated_at BEFORE UPDATE ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.request_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired','cancelled')),
  distance_km numeric,
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  responded_at timestamptz,
  UNIQUE (request_id, provider_id)
);

CREATE INDEX idx_offers_provider_status ON public.request_offers(provider_id, status);

CREATE INDEX idx_offers_request ON public.request_offers(request_id);

GRANT SELECT, UPDATE ON public.request_offers TO authenticated;

GRANT ALL ON public.request_offers TO service_role;

ALTER TABLE public.request_offers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_request_customer(_request_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.service_requests WHERE id = _request_id AND customer_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.has_offer(_request_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.request_offers WHERE request_id = _request_id AND provider_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_request_party(_request_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.service_requests WHERE id = _request_id AND _user_id IN (customer_id, provider_id))
$$;

REVOKE ALL ON FUNCTION public.is_request_customer(uuid,uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.has_offer(uuid,uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.is_request_party(uuid,uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_request_customer(uuid,uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.has_offer(uuid,uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_request_party(uuid,uuid) TO authenticated, service_role;

CREATE POLICY "Provider sees own offers" ON public.request_offers FOR SELECT TO authenticated
  USING (provider_id = auth.uid() OR public.has_staff_role(auth.uid()));

CREATE POLICY "Customer sees offers for own request" ON public.request_offers FOR SELECT TO authenticated
  USING (public.is_request_customer(request_id, auth.uid()));

CREATE POLICY "Provider updates own offer" ON public.request_offers FOR UPDATE TO authenticated
  USING (provider_id = auth.uid()) WITH CHECK (provider_id = auth.uid());

CREATE POLICY "Parties see own requests" ON public.service_requests FOR SELECT TO authenticated
  USING (auth.uid() = customer_id OR auth.uid() = provider_id);

CREATE POLICY "Staff see all requests" ON public.service_requests FOR SELECT TO authenticated
  USING (public.has_staff_role(auth.uid()));

CREATE POLICY "Driver sees offered taxi request" ON public.service_requests FOR SELECT TO authenticated
  USING (type = 'taxi' AND status IN ('pending','searching') AND public.has_offer(id, auth.uid()));

CREATE POLICY "Workers see available service requests" ON public.service_requests FOR SELECT TO authenticated
  USING (type = 'service' AND status IN ('pending','searching') AND public.has_role(auth.uid(), 'worker')
    AND (service_id IS NULL OR EXISTS (SELECT 1 FROM public.worker_services ws WHERE ws.worker_id = auth.uid() AND ws.service_id = service_requests.service_id)));

CREATE POLICY "Customer creates own requests" ON public.service_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_id AND provider_id IS NULL);

CREATE POLICY "Customer updates own request" ON public.service_requests FOR UPDATE TO authenticated
  USING (auth.uid() = customer_id) WITH CHECK (auth.uid() = customer_id);

CREATE POLICY "Provider updates assigned request" ON public.service_requests FOR UPDATE TO authenticated
  USING (auth.uid() = provider_id) WITH CHECK (auth.uid() = provider_id);
