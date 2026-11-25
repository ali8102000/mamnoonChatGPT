-- Prevent providers at the wallet debt ceiling from receiving or accepting new work.
-- The canonical balance is public.account_wallets.balance_iqd (IQD).
-- Exactly -5,000 IQD is blocked; a provider must be above this amount.

CREATE OR REPLACE FUNCTION public.mamnoon_guard_provider_wallet_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_balance bigint;
BEGIN
  IF NEW.status::text = 'accepted'
     AND NEW.provider_id IS NOT NULL
     AND (
       OLD.status::text IS DISTINCT FROM 'accepted'
       OR OLD.provider_id IS DISTINCT FROM NEW.provider_id
     )
     AND EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = NEW.provider_id
         AND ur.role::text IN ('driver', 'large_driver', 'worker')
     )
  THEN
    SELECT aw.balance_iqd
      INTO v_balance
    FROM public.account_wallets aw
    WHERE aw.user_id = NEW.provider_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'provider_wallet_not_provisioned';
    END IF;

    IF v_balance <= -5000 THEN
      RAISE EXCEPTION 'provider_wallet_debt_limit_reached';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.mamnoon_guard_provider_wallet_acceptance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aaa_guard_provider_wallet_acceptance ON public.service_requests;
CREATE TRIGGER aaa_guard_provider_wallet_acceptance
BEFORE UPDATE OF status, provider_id ON public.service_requests
FOR EACH ROW
EXECUTE FUNCTION public.mamnoon_guard_provider_wallet_acceptance();


CREATE OR REPLACE FUNCTION public.mamnoon_skip_wallet_blocked_provider_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_balance bigint;
BEGIN
  IF NEW.status::text = 'pending'
     AND NEW.provider_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = NEW.provider_id
         AND ur.role::text IN ('driver', 'large_driver', 'worker')
     )
  THEN
    SELECT aw.balance_iqd
      INTO v_balance
    FROM public.account_wallets aw
    WHERE aw.user_id = NEW.provider_id;

    -- Missing wallet is treated as ineligible: never dispatch work without a verified balance.
    IF NOT FOUND OR v_balance <= -5000 THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.mamnoon_skip_wallet_blocked_provider_offer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aaa_guard_provider_wallet_offer_insert ON public.request_offers;
CREATE TRIGGER aaa_guard_provider_wallet_offer_insert
BEFORE INSERT ON public.request_offers
FOR EACH ROW
EXECUTE FUNCTION public.mamnoon_skip_wallet_blocked_provider_offer();


CREATE OR REPLACE FUNCTION public.mamnoon_guard_large_vehicle_wallet_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_balance bigint;
BEGIN
  IF NEW.proposed_price IS NOT NULL
     AND NEW.status::text = 'pending'
     AND EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = NEW.provider_id
         AND ur.role::text = 'large_driver'
     )
  THEN
    SELECT aw.balance_iqd
      INTO v_balance
    FROM public.account_wallets aw
    WHERE aw.user_id = NEW.provider_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'provider_wallet_not_provisioned';
    END IF;

    IF v_balance <= -5000 THEN
      RAISE EXCEPTION 'provider_wallet_debt_limit_reached';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.mamnoon_guard_large_vehicle_wallet_offer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aaa_guard_large_vehicle_wallet_offer ON public.request_offers;
CREATE TRIGGER aaa_guard_large_vehicle_wallet_offer
BEFORE UPDATE OF proposed_price ON public.request_offers
FOR EACH ROW
EXECUTE FUNCTION public.mamnoon_guard_large_vehicle_wallet_offer();


CREATE OR REPLACE FUNCTION public.mamnoon_disable_provider_at_wallet_debt_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.balance_iqd <= -5000 THEN
    UPDATE public.driver_profiles
    SET available = false
    WHERE user_id = NEW.user_id
      AND available IS DISTINCT FROM false;

    UPDATE public.worker_profiles
    SET available = false
    WHERE user_id = NEW.user_id
      AND available IS DISTINCT FROM false;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.mamnoon_disable_provider_at_wallet_debt_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aaa_disable_provider_at_wallet_debt_limit ON public.account_wallets;
CREATE TRIGGER aaa_disable_provider_at_wallet_debt_limit
AFTER UPDATE OF balance_iqd ON public.account_wallets
FOR EACH ROW
WHEN (NEW.balance_iqd <= -5000)
EXECUTE FUNCTION public.mamnoon_disable_provider_at_wallet_debt_limit();

-- Bring any existing provider already at the debt ceiling offline immediately.
UPDATE public.driver_profiles dp
SET available = false
FROM public.account_wallets aw
WHERE aw.user_id = dp.user_id
  AND aw.balance_iqd <= -5000
  AND dp.available IS DISTINCT FROM false;

UPDATE public.worker_profiles wp
SET available = false
FROM public.account_wallets aw
WHERE aw.user_id = wp.user_id
  AND aw.balance_iqd <= -5000
  AND wp.available IS DISTINCT FROM false;
