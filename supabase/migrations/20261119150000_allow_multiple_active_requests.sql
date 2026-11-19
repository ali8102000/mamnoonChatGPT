-- Allow customers to keep existing active requests while creating another request.
-- Preserve the existing account-block guard on every new service_requests row.
CREATE OR REPLACE FUNCTION public.enforce_single_active_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_blocks b
    WHERE b.user_id = NEW.customer_id
      AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'user_blocked';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_single_active_request() IS
  'Allows multiple active requests per customer while continuing to reject new requests from currently blocked users.';
