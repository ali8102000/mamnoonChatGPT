CREATE OR REPLACE FUNCTION public.guard_customer_request_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM NEW.customer_id THEN RETURN NEW; END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN RAISE EXCEPTION 'customer_id_immutable'; END IF;
  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN RAISE EXCEPTION 'provider_id_readonly_for_customer'; END IF;
  IF NEW.type IS DISTINCT FROM OLD.type THEN RAISE EXCEPTION 'type_immutable'; END IF;
  IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN RAISE EXCEPTION 'service_id_immutable'; END IF;
  IF NEW.price_estimate IS DISTINCT FROM OLD.price_estimate THEN RAISE EXCEPTION 'price_readonly_for_customer'; END IF;
  IF NEW.commission IS DISTINCT FROM OLD.commission THEN RAISE EXCEPTION 'commission_readonly'; END IF;
  IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN RAISE EXCEPTION 'accepted_at_readonly'; END IF;
  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN RAISE EXCEPTION 'completed_at_readonly'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (NEW.status = 'cancelled' AND OLD.status IN ('pending','searching','accepted','in_progress')) THEN
      RAISE EXCEPTION 'invalid_status_transition_for_customer';
    END IF;
    NEW.cancelled_by := auth.uid();
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_customer_request_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_customer_request_update BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_request_update();

CREATE OR REPLACE FUNCTION public.enforce_single_active_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.service_requests WHERE customer_id = NEW.customer_id
      AND status IN ('pending','searching','accepted','in_progress') AND id <> NEW.id) THEN
    RAISE EXCEPTION 'active_request_exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.user_id = NEW.customer_id AND (b.expires_at IS NULL OR b.expires_at > now())) THEN
    RAISE EXCEPTION 'user_blocked';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.enforce_single_active_request() FROM PUBLIC, anon, authenticated;

CREATE TABLE public.chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.service_requests(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chats_customer_id ON public.chats(customer_id);

CREATE INDEX idx_chats_provider_id ON public.chats(provider_id);

GRANT SELECT ON public.chats TO authenticated;

GRANT ALL ON public.chats TO service_role;

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Chat participants see chat" ON public.chats FOR SELECT TO authenticated
  USING (auth.uid() IN (customer_id, provider_id) OR public.has_staff_role(auth.uid()));

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_chat_id ON public.messages(chat_id, created_at);

GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;

GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Chat participants read messages" ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chats c WHERE c.id = chat_id AND auth.uid() IN (c.customer_id, c.provider_id)) OR public.has_staff_role(auth.uid()));

CREATE POLICY "Chat participants send messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND EXISTS (SELECT 1 FROM public.chats c WHERE c.id = chat_id AND auth.uid() IN (c.customer_id, c.provider_id)));

CREATE POLICY "Receiver marks read" ON public.messages FOR UPDATE TO authenticated
  USING (sender_id <> auth.uid() AND EXISTS (SELECT 1 FROM public.chats c WHERE c.id = chat_id AND auth.uid() IN (c.customer_id, c.provider_id)));

CREATE OR REPLACE FUNCTION public.touch_chat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN UPDATE public.chats SET updated_at = now() WHERE id = NEW.chat_id; RETURN NEW; END $$;

REVOKE EXECUTE ON FUNCTION public.touch_chat() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_touch_chat AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.touch_chat();

CREATE TABLE public.ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  rater_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ratee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stars int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  professionalism int CHECK (professionalism BETWEEN 1 AND 5),
  punctuality int CHECK (punctuality BETWEEN 1 AND 5),
  quality int CHECK (quality BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ratings_request_rater_unique UNIQUE (request_id, rater_id)
);

CREATE INDEX idx_ratings_ratee ON public.ratings(ratee_id, created_at DESC);

GRANT SELECT, INSERT ON public.ratings TO authenticated;

GRANT ALL ON public.ratings TO service_role;

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ratings readable by signed-in users" ON public.ratings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Participant rates counterparty" ON public.ratings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = rater_id AND EXISTS (
    SELECT 1 FROM public.service_requests r WHERE r.id = ratings.request_id
      AND ((r.customer_id = auth.uid() AND r.provider_id = ratings.ratee_id)
        OR (r.provider_id = auth.uid() AND r.customer_id = ratings.ratee_id))));

CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "Counterparties view profile via request" ON public.profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.service_requests r
    WHERE (r.customer_id = profiles.id AND r.provider_id = auth.uid()) OR (r.provider_id = profiles.id AND r.customer_id = auth.uid())));

CREATE POLICY "Staff view profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_staff_role(auth.uid()));

CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Driver profile visible" ON public.driver_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_staff_role(auth.uid())
    OR EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.provider_id = driver_profiles.user_id AND sr.customer_id = auth.uid()));

CREATE POLICY "Driver creates own profile" ON public.driver_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Driver updates own profile" ON public.driver_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Worker profile visible" ON public.worker_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_staff_role(auth.uid())
    OR EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.provider_id = worker_profiles.user_id AND sr.customer_id = auth.uid()));

CREATE POLICY "Worker creates own profile" ON public.worker_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Worker updates own profile" ON public.worker_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE VIEW public.driver_public_stats WITH (security_invoker = true) AS
  SELECT user_id, vehicle_category, rating_avg, ratings_count, available FROM public.driver_profiles;

CREATE VIEW public.worker_public_stats WITH (security_invoker = true) AS
  SELECT user_id, level, rating_avg, ratings_count, available FROM public.worker_profiles;

GRANT SELECT ON public.driver_public_stats TO authenticated;

GRANT SELECT ON public.worker_public_stats TO authenticated;

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
