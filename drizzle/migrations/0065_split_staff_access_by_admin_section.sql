-- Separate staff permissions by the sections exposed in the web admin navigation.
CREATE OR REPLACE FUNCTION public.has_chat_moderation_access(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN false
  ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('super_admin','admin','support','moderator')) END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.has_live_ops_access(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN false
  ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('super_admin','admin','support')) END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.has_provider_ops_access(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN false
  ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('super_admin','admin','support')) END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.has_user_moderation_access(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN false
  ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('super_admin','admin','support','moderator')) END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.has_finance_access(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN false
  ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('super_admin','admin','finance')) END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.has_friend_admin_access(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN false
  ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('super_admin','admin','moderator')) END
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.has_chat_moderation_access(uuid), public.has_live_ops_access(uuid), public.has_provider_ops_access(uuid), public.has_user_moderation_access(uuid), public.has_finance_access(uuid), public.has_friend_admin_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_chat_moderation_access(uuid), public.has_live_ops_access(uuid), public.has_provider_ops_access(uuid), public.has_user_moderation_access(uuid), public.has_finance_access(uuid), public.has_friend_admin_access(uuid) TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "Chat participants see chat" ON public.chats;
CREATE POLICY "Chat participants see chat" ON public.chats FOR SELECT TO authenticated
USING (auth.uid()=customer_id OR auth.uid()=provider_id OR has_chat_moderation_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Chat participants read messages" ON public.messages;
CREATE POLICY "Chat participants read messages" ON public.messages FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.chats c WHERE c.id=messages.chat_id AND auth.uid() IN (c.customer_id,c.provider_id)) OR has_chat_moderation_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Parties read live location" ON public.live_locations;
CREATE POLICY "Parties read live location" ON public.live_locations FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.service_requests r WHERE r.id=live_locations.request_id AND r.status IN ('accepted','in_progress') AND auth.uid() IN (r.customer_id,r.provider_id) AND live_locations.user_id IN (r.customer_id,r.provider_id))
  OR (has_live_ops_access(auth.uid()) AND EXISTS (SELECT 1 FROM public.service_requests r WHERE r.id=live_locations.request_id AND r.status IN ('accepted','in_progress') AND live_locations.user_id IN (r.customer_id,r.provider_id)))
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Driver profile visible" ON public.driver_profiles;
CREATE POLICY "Driver profile visible" ON public.driver_profiles FOR SELECT TO authenticated
USING (user_id=auth.uid() OR has_provider_ops_access(auth.uid()) OR mamnoon_customer_has_assigned_provider(user_id));
--> statement-breakpoint
DROP POLICY IF EXISTS "Driver sees own wallet" ON public.driver_wallets;
CREATE POLICY "Driver sees own wallet" ON public.driver_wallets FOR SELECT TO authenticated
USING (user_id=auth.uid() OR has_finance_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Staff view profiles" ON public.profiles;
CREATE POLICY "Staff view profiles" ON public.profiles FOR SELECT TO authenticated
USING (has_user_moderation_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Providers read own change requests" ON public.provider_change_requests;
CREATE POLICY "Providers read own change requests" ON public.provider_change_requests FOR SELECT TO authenticated
USING (auth.uid()=user_id OR has_provider_ops_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Providers read own verification" ON public.provider_verifications;
CREATE POLICY "Providers read own verification" ON public.provider_verifications FOR SELECT TO authenticated
USING (auth.uid()=user_id OR has_provider_ops_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Providers update own verification" ON public.provider_verifications;
CREATE POLICY "Providers update own verification" ON public.provider_verifications FOR UPDATE TO authenticated
USING (auth.uid()=user_id OR has_provider_ops_access(auth.uid()))
WITH CHECK ((auth.uid()=user_id AND status='pending') OR has_provider_ops_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Provider sees own offers" ON public.request_offers;
CREATE POLICY "Provider sees own offers" ON public.request_offers FOR SELECT TO authenticated
USING (provider_id=auth.uid() OR has_provider_ops_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Staff see all requests" ON public.service_requests;
CREATE POLICY "Staff see all requests" ON public.service_requests FOR SELECT TO authenticated
USING (has_provider_ops_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Staff update support conversations" ON public.support_conversations;
CREATE POLICY "Staff update support conversations" ON public.support_conversations FOR UPDATE TO authenticated
USING (has_chat_moderation_access(auth.uid())) WITH CHECK (has_chat_moderation_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Support participants read conversations" ON public.support_conversations;
CREATE POLICY "Support participants read conversations" ON public.support_conversations FOR SELECT TO authenticated
USING (user_id=auth.uid() OR has_chat_moderation_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Users open own support conversation" ON public.support_conversations;
CREATE POLICY "Users open own support conversation" ON public.support_conversations FOR INSERT TO authenticated
WITH CHECK ((user_id=auth.uid() AND created_by=auth.uid()) OR (has_chat_moderation_access(auth.uid()) AND created_by=auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Support participants mark messages read" ON public.support_messages;
CREATE POLICY "Support participants mark messages read" ON public.support_messages FOR UPDATE TO authenticated
USING (sender_id<>auth.uid() AND EXISTS (SELECT 1 FROM public.support_conversations c WHERE c.id=support_messages.conversation_id AND (c.user_id=auth.uid() OR has_chat_moderation_access(auth.uid()))))
WITH CHECK (EXISTS (SELECT 1 FROM public.support_conversations c WHERE c.id=support_messages.conversation_id AND (c.user_id=auth.uid() OR has_chat_moderation_access(auth.uid())));
--> statement-breakpoint
DROP POLICY IF EXISTS "Support participants read messages" ON public.support_messages;
CREATE POLICY "Support participants read messages" ON public.support_messages FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.support_conversations c WHERE c.id=support_messages.conversation_id AND (c.user_id=auth.uid() OR has_chat_moderation_access(auth.uid())));
--> statement-breakpoint
DROP POLICY IF EXISTS "Support participants send messages" ON public.support_messages;
CREATE POLICY "Support participants send messages" ON public.support_messages FOR INSERT TO authenticated
WITH CHECK (sender_id=auth.uid() AND EXISTS (SELECT 1 FROM public.support_conversations c WHERE c.id=support_messages.conversation_id AND (c.user_id=auth.uid() OR has_chat_moderation_access(auth.uid())) AND c.status='open'));
--> statement-breakpoint
DROP POLICY IF EXISTS "Ticket parties read messages" ON public.support_ticket_messages;
CREATE POLICY "Ticket parties read messages" ON public.support_ticket_messages FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id=support_ticket_messages.ticket_id AND t.user_id=auth.uid()) OR has_chat_moderation_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Ticket parties send messages" ON public.support_ticket_messages;
CREATE POLICY "Ticket parties send messages" ON public.support_ticket_messages FOR INSERT TO authenticated
WITH CHECK (sender_id=auth.uid() AND ((is_staff=false AND EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id=support_ticket_messages.ticket_id AND t.user_id=auth.uid())) OR (is_staff=true AND has_chat_moderation_access(auth.uid())));
--> statement-breakpoint
DROP POLICY IF EXISTS "Owner or staff see tickets" ON public.support_tickets;
CREATE POLICY "Owner or staff see tickets" ON public.support_tickets FOR SELECT TO authenticated
USING (user_id=auth.uid() OR has_chat_moderation_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "User sees own transactions" ON public.transactions;
CREATE POLICY "User sees own transactions" ON public.transactions FOR SELECT TO authenticated
USING (user_id=auth.uid() OR has_finance_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Staff can review user reports" ON public.user_reports;
CREATE POLICY "Staff can review user reports" ON public.user_reports FOR SELECT TO authenticated
USING (has_user_moderation_access(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "Worker profile visible" ON public.worker_profiles;
CREATE POLICY "Worker profile visible" ON public.worker_profiles FOR SELECT TO authenticated
USING (user_id=auth.uid() OR has_provider_ops_access(auth.uid()) OR mamnoon_customer_has_assigned_provider(user_id));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admin_delete_message(p_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.has_chat_moderation_access(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.messages WHERE id=p_message_id;
  PERFORM public.log_admin_action('delete_message','message',p_message_id::text);
END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admin_resolve_report(p_report_id uuid,p_status text,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.has_user_moderation_access(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_status NOT IN ('resolved','closed','dismissed') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.user_reports SET status=p_status,resolution_note=p_note,resolved_by=auth.uid(),resolved_at=now() WHERE id=p_report_id;
  PERFORM public.log_admin_action('resolve_report','report',p_report_id::text,jsonb_build_object('status',p_status));
END
$fn$;
