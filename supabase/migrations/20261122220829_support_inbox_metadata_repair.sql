-- Restore the support inbox metadata expected by the admin-inbox Edge Function.
-- This is intentionally limited to support inbox fields; no billing or wallet schema is changed.
ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS needs_admin_reply boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_status text NOT NULL DEFAULT 'bot'
    CHECK (handoff_status IN ('bot','waiting_for_admin','assigned','resolved')),
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS last_message_source text NOT NULL DEFAULT 'user'
    CHECK (last_message_source IN ('user','bot','admin')),
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

CREATE INDEX IF NOT EXISTS support_conversations_inbox_triage_idx
  ON public.support_conversations(needs_admin_reply DESC, last_message_at DESC NULLS LAST, updated_at DESC);

CREATE OR REPLACE FUNCTION public.sync_support_inbox_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_ai_status text;
BEGIN
  SELECT user_id, ai_status INTO v_user_id, v_ai_status
  FROM public.support_conversations
  WHERE id = NEW.conversation_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.support_conversations
  SET last_message_at = NEW.created_at,
      last_message_source = CASE
        WHEN NEW.is_ai THEN 'bot'
        WHEN NEW.sender_id = v_user_id THEN 'user'
        ELSE 'admin'
      END,
      needs_admin_reply = CASE
        WHEN NEW.is_ai THEN (v_ai_status = 'waiting_human')
        WHEN NEW.sender_id = v_user_id THEN (v_ai_status = 'waiting_human')
        ELSE false
      END,
      handoff_status = CASE
        WHEN NEW.is_ai AND v_ai_status = 'waiting_human' THEN 'waiting_for_admin'
        WHEN NEW.is_ai THEN handoff_status
        WHEN NEW.sender_id = v_user_id AND v_ai_status = 'waiting_human' THEN 'waiting_for_admin'
        WHEN NEW.sender_id <> v_user_id THEN 'assigned'
        ELSE handoff_status
      END,
      ticket_status = CASE
        WHEN NEW.sender_id = v_user_id AND v_ai_status = 'waiting_human' THEN 'new'
        WHEN NEW.sender_id <> v_user_id THEN 'in_progress'
        ELSE ticket_status
      END,
      updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_support_inbox_metadata ON public.support_messages;
CREATE TRIGGER sync_support_inbox_metadata
AFTER INSERT ON public.support_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_support_inbox_metadata();

REVOKE ALL ON FUNCTION public.sync_support_inbox_metadata() FROM PUBLIC, anon, authenticated;
