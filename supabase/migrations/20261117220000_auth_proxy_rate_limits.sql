-- Database-backed, privacy-preserving rate limits for the public phone auth proxy.
-- The edge function stores only HMAC hashes of IP/phone/email identifiers.
CREATE TABLE IF NOT EXISTS public.auth_proxy_rate_limits (
  key_hash text NOT NULL,
  action_key text NOT NULL,
  bucket_start timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  CONSTRAINT auth_proxy_rate_limits_pkey PRIMARY KEY (key_hash, action_key, bucket_start),
  CONSTRAINT auth_proxy_rate_limits_key_hash_check CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_proxy_rate_limits_action_check CHECK (
    action_key IN ('signup_ip', 'signup_subject', 'login_ip', 'login_subject', 'reset_ip', 'reset_subject')
  ),
  CONSTRAINT auth_proxy_rate_limits_attempts_check CHECK (attempts > 0)
);

ALTER TABLE public.auth_proxy_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_proxy_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.auth_proxy_rate_limits TO service_role;

CREATE INDEX IF NOT EXISTS auth_proxy_rate_limits_expires_idx
  ON public.auth_proxy_rate_limits (expires_at);

CREATE OR REPLACE FUNCTION public.consume_auth_proxy_rate_limit(
  p_key_hash text,
  p_action text,
  p_max_attempts integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_bucket_start timestamptz;
  v_attempts integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_rate_limit_key';
  END IF;

  IF p_action NOT IN ('signup_ip', 'signup_subject', 'login_ip', 'login_subject', 'reset_ip', 'reset_subject') THEN
    RAISE EXCEPTION 'invalid_rate_limit_action';
  END IF;

  IF p_max_attempts < 1 OR p_max_attempts > 1000
     OR p_window_seconds < 60 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_rate_limit_configuration';
  END IF;

  v_bucket_start := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.auth_proxy_rate_limits AS current_limit
    (key_hash, action_key, bucket_start, attempts, expires_at)
  VALUES (
    p_key_hash,
    p_action,
    v_bucket_start,
    1,
    v_bucket_start + make_interval(secs => p_window_seconds * 2)
  )
  ON CONFLICT (key_hash, action_key, bucket_start)
  DO UPDATE SET attempts = current_limit.attempts + 1
  RETURNING attempts INTO v_attempts;

  -- Opportunistically prune expired buckets without a separate scheduled job.
  IF v_attempts = 1 AND random() < 0.02 THEN
    DELETE FROM public.auth_proxy_rate_limits
    WHERE expires_at < clock_timestamp();
  END IF;

  RETURN v_attempts <= p_max_attempts;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_auth_proxy_rate_limit(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_auth_proxy_rate_limit(text, text, integer, integer)
  TO service_role;
