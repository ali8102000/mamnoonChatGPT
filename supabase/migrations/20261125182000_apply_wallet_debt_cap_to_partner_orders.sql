-- Apply the same -5,000 IQD wallet eligibility rule to restaurants and stores.
CREATE OR REPLACE FUNCTION public.mamnoon_guard_partner_order_wallet_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id uuid;
  v_balance bigint;
  v_should_check boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_check := NEW.status IN ('pending','accepted');
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_check := NEW.status IN ('pending','accepted')
      AND OLD.status IS DISTINCT FROM NEW.status;
  END IF;

  IF NOT v_should_check THEN
    RETURN NEW;
  END IF;

  SELECT bp.user_id INTO v_user_id
  FROM public.partner_business_profiles bp
  WHERE bp.id = NEW.business_profile_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'partner_profile_not_found';
  END IF;

  SELECT aw.balance_iqd INTO v_balance
  FROM public.account_wallets aw
  WHERE aw.user_id = v_user_id
  FOR UPDATE;

  -- A partner without a wallet starts at zero; the commission RPC provisions it on acceptance.
  IF FOUND AND v_balance <= -5000 THEN
    RAISE EXCEPTION 'partner_wallet_debt_limit_reached';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.mamnoon_guard_partner_order_wallet_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mamnoon_guard_partner_order_wallet_limit ON public.partner_customer_orders;
CREATE TRIGGER mamnoon_guard_partner_order_wallet_limit
BEFORE INSERT OR UPDATE OF status ON public.partner_customer_orders
FOR EACH ROW
EXECUTE FUNCTION public.mamnoon_guard_partner_order_wallet_limit();
