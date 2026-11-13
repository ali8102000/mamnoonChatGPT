-- Dedicated support conversations between Mamnoon staff and providers.
BEGIN;

CREATE TABLE IF NOT EXISTS public.support_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject text NOT NULL DEFAULT 'مراسلة إدارة ممنون',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS support_conversations_one_open_per_user
  ON public.support_conversations(user_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS support_conversations_updated_idx
  ON public.support_conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_conversation_idx
  ON public.support_messages(conversation_id, created_at);

ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.support_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_messages TO authenticated;
GRANT ALL ON public.support_conversations, public.support_messages TO service_role;

DROP POLICY IF EXISTS "Support participants read conversations" ON public.support_conversations;
CREATE POLICY "Support participants read conversations"
  ON public.support_conversations FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_staff_role(auth.uid()));

DROP POLICY IF EXISTS "Users open own support conversation" ON public.support_conversations;
CREATE POLICY "Users open own support conversation"
  ON public.support_conversations FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = auth.uid() AND created_by = auth.uid())
    OR (public.has_staff_role(auth.uid()) AND created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Staff update support conversations" ON public.support_conversations;
CREATE POLICY "Staff update support conversations"
  ON public.support_conversations FOR UPDATE TO authenticated
  USING (public.has_staff_role(auth.uid()))
  WITH CHECK (public.has_staff_role(auth.uid()));

DROP POLICY IF EXISTS "Support participants read messages" ON public.support_messages;
CREATE POLICY "Support participants read messages"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_conversations c
      WHERE c.id = conversation_id
        AND (c.user_id = auth.uid() OR public.has_staff_role(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Support participants send messages" ON public.support_messages;
CREATE POLICY "Support participants send messages"
  ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_conversations c
      WHERE c.id = conversation_id
        AND (c.user_id = auth.uid() OR public.has_staff_role(auth.uid()))
        AND c.status = 'open'
    )
  );

DROP POLICY IF EXISTS "Support participants mark messages read" ON public.support_messages;
CREATE POLICY "Support participants mark messages read"
  ON public.support_messages FOR UPDATE TO authenticated
  USING (
    sender_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_conversations c
      WHERE c.id = conversation_id
        AND (c.user_id = auth.uid() OR public.has_staff_role(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.support_conversations c
      WHERE c.id = conversation_id
        AND (c.user_id = auth.uid() OR public.has_staff_role(auth.uid()))
    )
  );

CREATE OR REPLACE FUNCTION public.touch_support_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.support_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.touch_support_conversation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_touch_support_conversation ON public.support_messages;
CREATE TRIGGER trg_touch_support_conversation
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_support_conversation();

CREATE OR REPLACE FUNCTION public.notify_support_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_sender_name text;
  v_staff record;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.support_conversations
  WHERE id = NEW.conversation_id;

  SELECT full_name INTO v_sender_name
  FROM public.profiles WHERE id = NEW.sender_id;

  IF NEW.sender_id = v_user_id THEN
    FOR v_staff IN
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE role IN ('super_admin', 'admin', 'support')
    LOOP
      INSERT INTO public.notifications(user_id, type, title, body, link, data)
      VALUES (
        v_staff.user_id,
        'support_message',
        'رسالة جديدة إلى إدارة ممنون',
        COALESCE(v_sender_name, 'مستخدم') || ' أرسل رسالة إلى الدعم',
        '/admin',
        jsonb_build_object('conversation_id', NEW.conversation_id)
      );
    END LOOP;
  ELSE
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (
      v_user_id,
      'support_message',
      'رد جديد من إدارة ممنون',
      'وصلتك رسالة جديدة من فريق شركة ممنون',
      '/messages',
      jsonb_build_object('conversation_id', NEW.conversation_id)
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_support_message() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_support_message ON public.support_messages;
CREATE TRIGGER trg_notify_support_message
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_support_message();

COMMIT;
