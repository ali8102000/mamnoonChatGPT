-- Charge provider commission at the first real service milestone, not at acceptance.
DROP TRIGGER IF EXISTS charge_commission_on_request_acceptance ON public.service_requests;
DROP FUNCTION IF EXISTS public.charge_commission_on_request_acceptance();

CREATE OR REPLACE FUNCTION public.charge_commission_on_provider_milestone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.provider_id IS NULL OR NEW.type::text NOT IN ('taxi','service') THEN
    RETURN NEW;
  END IF;

  IF (OLD.provider_arrived_at IS NULL AND NEW.provider_arrived_at IS NOT NULL)
     OR (OLD.status::text IS DISTINCT FROM 'in_progress' AND NEW.status::text = 'in_progress') THEN
    PERFORM public.charge_mamnoon_commission_on_accept(
      NEW.provider_id,
      NEW.id,
      COALESCE(
        NEW.customer_payable::bigint,
        NEW.customer_price::bigint,
        NEW.price_estimate::bigint
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.charge_commission_on_provider_milestone() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER charge_commission_on_provider_milestone
AFTER UPDATE OF provider_arrived_at, status ON public.service_requests
FOR EACH ROW
EXECUTE FUNCTION public.charge_commission_on_provider_milestone();

-- Never dispatch a new pending offer to a provider without a wallet or at the debt cap.
CREATE OR REPLACE FUNCTION public.mamnoon_guard_provider_offer_wallet_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_balance bigint;
BEGIN
  IF NEW.status::text = 'pending'
     AND (
       TG_OP = 'INSERT'
       OR OLD.status::text IS DISTINCT FROM NEW.status::text
       OR OLD.provider_id IS DISTINCT FROM NEW.provider_id
     ) THEN
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
DROP TRIGGER IF EXISTS mamnoon_guard_provider_offer_wallet_limit ON public.request_offers;
CREATE TRIGGER mamnoon_guard_provider_offer_wallet_limit
BEFORE INSERT OR UPDATE OF status, provider_id ON public.request_offers
FOR EACH ROW
EXECUTE FUNCTION public.mamnoon_guard_provider_offer_wallet_limit();

-- When a commission pushes a provider to -5,000 IQD, cancel any outstanding offers.
CREATE OR REPLACE FUNCTION public.mamnoon_pause_provider_offers_at_wallet_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_cancelled integer := 0;
BEGIN
  IF OLD.balance_iqd > -5000 AND NEW.balance_iqd <= -5000 THEN
    UPDATE public.request_offers
    SET status = 'cancelled', responded_at = now()
    WHERE provider_id = NEW.user_id AND status = 'pending';

    GET DIAGNOSTICS v_cancelled = ROW_COUNT;

    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (
      NEW.user_id,
      'wallet_commission_limit_reached',
      'توقفت الطلبات مؤقتاً',
      'وصل رصيد محفظتك إلى الحد الأدنى -5,000 د.ع. لن تصلك طلبات جديدة ولن تتمكن من قبولها حتى تشحن المحفظة.',
      '/wallet',
      jsonb_build_object('balance_iqd', NEW.balance_iqd, 'cancelled_pending_offers', v_cancelled)
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.mamnoon_pause_provider_offers_at_wallet_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mamnoon_pause_provider_offers_at_wallet_limit ON public.account_wallets;
CREATE TRIGGER mamnoon_pause_provider_offers_at_wallet_limit
AFTER UPDATE OF balance_iqd ON public.account_wallets
FOR EACH ROW
EXECUTE FUNCTION public.mamnoon_pause_provider_offers_at_wallet_limit();
