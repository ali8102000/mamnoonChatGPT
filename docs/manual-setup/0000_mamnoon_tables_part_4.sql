CREATE TABLE public.live_locations (
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer','provider')),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  heading double precision,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);
CREATE INDEX idx_live_locations_user ON public.live_locations(user_id);
CREATE INDEX idx_live_locations_updated_at ON public.live_locations(updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_locations TO authenticated;
GRANT ALL ON public.live_locations TO service_role;
ALTER TABLE public.live_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parties read live location" ON public.live_locations FOR SELECT TO authenticated
  USING (public.is_request_party(request_id, auth.uid()) OR public.has_staff_role(auth.uid()));
CREATE POLICY "Owner writes own live location" ON public.live_locations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_request_party(request_id, auth.uid()));
CREATE POLICY "Owner updates own live location" ON public.live_locations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner deletes own live location" ON public.live_locations FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.guard_live_location_speed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev RECORD; dist_km numeric; dt_sec numeric;
BEGIN
  SELECT lat, lng, updated_at INTO prev FROM public.live_locations WHERE user_id = NEW.user_id ORDER BY updated_at DESC LIMIT 1;
  IF prev.lat IS NOT NULL THEN
    dt_sec := GREATEST(1, EXTRACT(EPOCH FROM (now() - prev.updated_at)));
    dist_km := 6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(prev.lat)) * cos(radians(NEW.lat)) * cos(radians(NEW.lng) - radians(prev.lng)) + sin(radians(prev.lat)) * sin(radians(NEW.lat)))));
    IF (dist_km / dt_sec) * 3600 > 250 AND dist_km > 1 THEN RAISE EXCEPTION 'implausible_speed'; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.guard_live_location_speed() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_live_location_speed BEFORE INSERT OR UPDATE ON public.live_locations FOR EACH ROW EXECUTE FUNCTION public.guard_live_location_speed();

CREATE TABLE public.pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_category text NOT NULL UNIQUE,
  base_fare numeric NOT NULL DEFAULT 1500,
  per_km numeric NOT NULL DEFAULT 400,
  per_min numeric NOT NULL DEFAULT 50,
  minimum_fare numeric NOT NULL DEFAULT 2000,
  commission_pct numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IQD',
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pricing_rules TO anon, authenticated;
GRANT ALL ON public.pricing_rules TO service_role;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pricing readable by all" ON public.pricing_rules FOR SELECT USING (true);
INSERT INTO public.pricing_rules (vehicle_category, base_fare, per_km, per_min, minimum_fare, commission_pct) VALUES
  ('economy',1500,400,40,2000,0),('premium',2500,650,60,3000,0),('luxury',4500,1100,100,5000,0);

CREATE TABLE public.driver_wallets (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance numeric NOT NULL DEFAULT 0,
  total_earned numeric NOT NULL DEFAULT 0,
  total_commission numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IQD',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_wallets TO authenticated;
GRANT ALL ON public.driver_wallets TO service_role;
ALTER TABLE public.driver_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver sees own wallet" ON public.driver_wallets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_staff_role(auth.uid()));

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('earning','commission','withdrawal','refund','adjustment')),
  amount numeric NOT NULL,
  balance_after numeric,
  currency text NOT NULL DEFAULT 'IQD',
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_user_created ON public.transactions(user_id, created_at DESC);
GRANT SELECT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User sees own transactions" ON public.transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_staff_role(auth.uid()));

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user_created ON public.notifications(user_id, created_at DESC);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User sees own notifications" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "User marks own notifications read" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text,
  expires_at timestamptz,
  blocked_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.user_blocks TO service_role;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'pending',
  resolution_note text,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.user_reports TO authenticated;
GRANT ALL ON public.user_reports TO service_role;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reporter sees own reports" ON public.user_reports FOR SELECT TO authenticated USING (reporter_id = auth.uid());
CREATE POLICY "Users file reports" ON public.user_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND status = 'pending' AND resolved_by IS NULL);

CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  type text NOT NULL DEFAULT 'percentage' CHECK (type IN ('percentage','fixed')),
  value numeric NOT NULL DEFAULT 0,
  max_uses int NOT NULL DEFAULT 1000,
  used_count int NOT NULL DEFAULT 0,
  min_amount numeric NOT NULL DEFAULT 0,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER coupons_updated_at BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, friend_id),
  CHECK (user_id <> friend_id)
);
GRANT SELECT, INSERT, DELETE ON public.friends TO authenticated;
GRANT ALL ON public.friends TO service_role;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own friends" ON public.friends FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users add own friends" ON public.friends FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users remove own friends" ON public.friends FOR DELETE TO authenticated USING (user_id = auth.uid());
