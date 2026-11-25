CREATE OR REPLACE FUNCTION public.mamnoon_guard_provider_offer_wallet_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_balance bigint;
  v_should_check boolean := false;
BEGIN
  IF NEW.status::text <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_check := true;
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_check := OLD.status::text IS DISTINCT FROM NEW.status::text
      OR OLD.provider_id IS DISTINCT FROM NEW.provider_id;
  END IF;

  IF v_should_check THEN
    SELECT aw.balance_iqd INTO v_balance
    FROM public.account_wallets aw
    WHERE aw.user_id = NEW.provider_id
    FOR UPDATE;

    IF NOT FOUND OR v_balance <= -5000 THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.mamnoon_guard_provider_offer_wallet_limit() FROM PUBLIC, anon, authenticated;
