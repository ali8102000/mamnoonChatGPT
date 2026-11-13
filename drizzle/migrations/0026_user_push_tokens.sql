-- Store device push tokens so account-review decisions can reach users when the app is closed.
BEGIN;

CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  device_platform text NOT NULL DEFAULT 'unknown',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user
  ON public.user_push_tokens(user_id);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_push_tokens TO authenticated;
GRANT ALL ON public.user_push_tokens TO service_role;

DROP POLICY IF EXISTS "Users manage own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users manage own push tokens"
ON public.user_push_tokens
FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMIT;
