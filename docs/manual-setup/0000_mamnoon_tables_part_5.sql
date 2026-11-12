CREATE TABLE public.friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender_id, receiver_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_requests TO authenticated;

GRANT ALL ON public.friend_requests TO service_role;

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parties see friend requests" ON public.friend_requests FOR SELECT TO authenticated USING (auth.uid() IN (sender_id, receiver_id));

CREATE POLICY "Sender creates friend request" ON public.friend_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id AND status = 'pending');

CREATE POLICY "Receiver responds" ON public.friend_requests FOR UPDATE TO authenticated USING (auth.uid() = receiver_id) WITH CHECK (auth.uid() = receiver_id);

CREATE POLICY "Parties delete friend request" ON public.friend_requests FOR DELETE TO authenticated USING (auth.uid() IN (sender_id, receiver_id));

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.support_tickets TO authenticated;

GRANT ALL ON public.support_tickets TO service_role;

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER support_tickets_updated_at BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Owner or staff see tickets" ON public.support_tickets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_staff_role(auth.uid()));

CREATE POLICY "Users open own tickets" ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'open');

CREATE TABLE public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text NOT NULL,
  is_staff boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_msgs_ticket ON public.support_ticket_messages(ticket_id, created_at);

GRANT SELECT, INSERT ON public.support_ticket_messages TO authenticated;

GRANT ALL ON public.support_ticket_messages TO service_role;

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ticket parties read messages" ON public.support_ticket_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()) OR public.has_staff_role(auth.uid()));

CREATE POLICY "Ticket parties send messages" ON public.support_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND (
    (is_staff = false AND EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()))
    OR (is_staff = true AND public.has_staff_role(auth.uid()))));

CREATE TABLE public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  description_ar text,
  tier int NOT NULL DEFAULT 0,
  max_requests_per_month int,
  priority_weight int NOT NULL DEFAULT 0,
  offer_priority int NOT NULL DEFAULT 0,
  badge_label text,
  badge_color text,
  show_stats boolean NOT NULL DEFAULT false,
  priority_support boolean NOT NULL DEFAULT false,
  monthly_price int NOT NULL DEFAULT 0,
  yearly_price int NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IQD',
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_plans TO authenticated;

GRANT ALL ON public.subscription_plans TO service_role;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active plans readable" ON public.subscription_plans FOR SELECT TO authenticated USING (is_active);

INSERT INTO public.subscription_plans (code, name_ar, name_en, tier, max_requests_per_month, priority_weight, offer_priority, badge_label, badge_color, show_stats, priority_support, monthly_price, yearly_price, sort_order) VALUES
  ('free','مجاني','Free',0,NULL,0,0,NULL,NULL,false,false,0,0,1),
  ('silver','فضي','Silver',1,NULL,10,10,'فضي','#C0C0C0',true,false,0,0,2),
  ('gold','ذهبي','Gold',2,NULL,20,20,'ذهبي','#FFD700',true,true,0,0,3);

CREATE TABLE public.subscription_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  subscription_enabled boolean NOT NULL DEFAULT false,
  minimum_downloads_before_activation int NOT NULL DEFAULT 100000,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.subscription_settings TO service_role;

ALTER TABLE public.subscription_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.subscription_settings (id) VALUES (1);

CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  status text NOT NULL DEFAULT 'active',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  request_count int NOT NULL DEFAULT 0,
  resets_count_period_start timestamptz NOT NULL DEFAULT now(),
  auto_renew boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_subscriptions TO authenticated;

GRANT ALL ON public.user_subscriptions TO service_role;

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER user_subscriptions_updated_at BEFORE UPDATE ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Users see own subscription" ON public.user_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.subscription_plans(id),
  amount int NOT NULL,
  currency text NOT NULL DEFAULT 'IQD',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  status text NOT NULL DEFAULT 'paid',
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_payments TO authenticated;

GRANT ALL ON public.subscription_payments TO service_role;

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own payments" ON public.subscription_payments FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER trg_single_active_request BEFORE INSERT ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public.enforce_single_active_request();

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

ALTER PUBLICATION supabase_realtime ADD TABLE public.service_requests;

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_locations;

ALTER PUBLICATION supabase_realtime ADD TABLE public.request_offers;

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_messages;

ALTER TABLE public.messages REPLICA IDENTITY FULL;

ALTER TABLE public.service_requests REPLICA IDENTITY FULL;
