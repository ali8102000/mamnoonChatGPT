-- Allow the authenticated customer who owns a taxi request to restart
-- dispatch after all previous offers have expired. Never expose the
-- service-role-only dispatch worker directly to clients.

CREATE OR REPLACE FUNCTION public.retry_taxi_dispatch(_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.service_requests%ROWTYPE;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO r
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND OR r.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF r.type <> 'taxi' OR r.status NOT IN ('pending', 'searching') OR r.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  UPDATE public.request_offers
  SET status = 'expired', responded_at = now()
  WHERE request_id = _request_id
    AND status = 'pending'
    AND expires_at <= now();

  SELECT count(*)::integer INTO v_count
  FROM public.request_offers
  WHERE request_id = _request_id
    AND status = 'pending'
    AND expires_at > now();

  IF v_count > 0 THEN
    RETURN v_count;
  END IF;

  INSERT INTO public.taxi_dispatch_queue (request_id, stage, next_at)
  VALUES (_request_id, 0, now())
  ON CONFLICT (request_id)
  DO UPDATE SET stage = 0, next_at = now();

  v_count := public.advance_taxi_dispatch(_request_id);

  PERFORM cron.schedule(
    'mamnoon-taxi-dispatch',
    '5 seconds',
    'SELECT public.process_taxi_dispatch()'
  );

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.retry_taxi_dispatch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_taxi_dispatch(uuid) TO authenticated;
