-- Atomic per-user rolling-window taxi request limiter.
CREATE TABLE IF NOT EXISTS public.taxi_request_rate_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

ALTER TABLE public.taxi_request_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.taxi_request_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.taxi_request_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_taxi_request_slot(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $taxi_rate_limit$
DECLARE
  v_count integer;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_required';
  END IF;

  INSERT INTO public.taxi_request_rate_limits AS limits (user_id, window_started_at, request_count)
  VALUES (_user_id, now(), 1)
  ON CONFLICT (user_id) DO UPDATE
  SET window_started_at = CASE
        WHEN limits.window_started_at <= now() - interval '60 seconds'
          THEN now()
        ELSE public.taxi_request_rate_limits.window_started_at
      END,
      request_count = CASE
        WHEN public.taxi_request_rate_limits.window_started_at <= now() - interval '60 seconds'
          THEN 1
        ELSE limits.request_count + 1
      END
  RETURNING request_count INTO v_count;

  RETURN v_count <= 3;
END;
$taxi_rate_limit$;

REVOKE ALL ON FUNCTION public.consume_taxi_request_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_taxi_request_slot(uuid) TO service_role;
