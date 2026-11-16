-- Support participants may only mark incoming support messages as read.
CREATE OR REPLACE FUNCTION public.guard_support_message_read_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'support_message_content_is_immutable';
  END IF;

  IF OLD.sender_id = auth.uid() THEN
    RAISE EXCEPTION 'sender_cannot_mark_own_support_message_read';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.support_conversations c
    WHERE c.id=OLD.conversation_id
      AND (c.user_id=auth.uid() OR public.has_chat_moderation_access(auth.uid()))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF OLD.read_at IS NOT NULL THEN
    IF NEW.read_at IS DISTINCT FROM OLD.read_at THEN
      RAISE EXCEPTION 'support_message_already_marked_read';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.read_at IS NULL THEN
    RAISE EXCEPTION 'support_message_read_at_required';
  END IF;

  NEW.read_at := now();
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_guard_support_message_read_receipt ON public.support_messages;
CREATE TRIGGER trg_guard_support_message_read_receipt
BEFORE UPDATE ON public.support_messages
FOR EACH ROW EXECUTE FUNCTION public.guard_support_message_read_receipt();
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.guard_support_message_read_receipt() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE UPDATE ON TABLE public.support_messages FROM authenticated;
GRANT UPDATE (read_at) ON TABLE public.support_messages TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "Staff update support conversations" ON public.support_conversations;
REVOKE UPDATE ON TABLE public.support_conversations FROM authenticated;
