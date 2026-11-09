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

-- Authenticated customers may safely request an immediate retry only for their own
-- still-searching taxi request. Active offers are reused; no duplicate fan-out.
CREATE OR REPLACE FUNCTION public.retry_taxi_dispatch(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $retry_taxi_dispatch$
DECLARE
  v_request public.service_requests%ROWTYPE;
  v_active_count integer := 0;
  v_offers integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text, 0));

  SELECT * INTO v_request
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  IF v_request.type <> 'taxi'::public.request_type
     OR v_request.status NOT IN ('pending'::public.request_status, 'searching'::public.request_status)
     OR v_request.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_request_status';
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.request_offers
  WHERE request_id = _request_id
    AND status = 'pending'
    AND expires_at > now();

  IF v_active_count > 0 THEN
    RETURN v_active_count;
  END IF;

  UPDATE public.request_offers
  SET status = 'expired', responded_at = now()
  WHERE request_id = _request_id
    AND status = 'pending'
    AND expires_at <= now();

  INSERT INTO public.taxi_dispatch_queue(request_id, stage, next_at)
  VALUES (_request_id, 0, now())
  ON CONFLICT (request_id) DO NOTHING;

  v_offers := public.advance_taxi_dispatch(_request_id);
  RETURN v_offers;
END;
$retry_taxi_dispatch$;

REVOKE ALL ON FUNCTION public.retry_taxi_dispatch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_taxi_dispatch(uuid) TO authenticated;
