-- Allow chat recipients to mark messages read without permitting message edits or impersonation.
CREATE OR REPLACE FUNCTION public.guard_message_read_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.chat_id IS DISTINCT FROM OLD.chat_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'message_content_is_immutable';
  END IF;

  IF OLD.sender_id = auth.uid() THEN
    RAISE EXCEPTION 'sender_cannot_mark_own_message_read';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = OLD.chat_id
      AND auth.uid() IN (c.customer_id, c.provider_id)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF OLD.read_at IS NOT NULL THEN
    IF NEW.read_at IS DISTINCT FROM OLD.read_at THEN
      RAISE EXCEPTION 'message_already_marked_read';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.read_at IS NULL THEN
    RAISE EXCEPTION 'read_at_required';
  END IF;

  NEW.read_at := now();
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_guard_message_read_receipt ON public.messages;
CREATE TRIGGER trg_guard_message_read_receipt
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.guard_message_read_receipt();
