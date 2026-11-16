-- Prevent trial subscriptions from being upgraded or leaving trial mode
-- except through a verified service-role payment finalizer or an authorized admin grant.
CREATE OR REPLACE FUNCTION public.guard_trial_subscription_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_trial IS TRUE
     AND (NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.is_trial IS DISTINCT FROM OLD.is_trial) THEN
    IF NEW.grant_type = 'paid' AND coalesce(auth.role(), '') = 'service_role' THEN
      RETURN NEW;
    END IF;
    IF NEW.grant_type = 'admin'
       AND auth.uid() IS NOT NULL
       AND public.has_admin_access(auth.uid()) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'trial_subscription_upgrade_requires_payment'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_trial_subscription_upgrade ON public.user_subscriptions;
CREATE TRIGGER trg_guard_trial_subscription_upgrade
BEFORE UPDATE OF plan_id, is_trial, grant_type ON public.user_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.guard_trial_subscription_upgrade();

REVOKE ALL ON FUNCTION public.guard_trial_subscription_upgrade() FROM PUBLIC, anon, authenticated;
