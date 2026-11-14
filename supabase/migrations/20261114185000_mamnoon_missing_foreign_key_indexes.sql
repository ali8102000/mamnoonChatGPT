CREATE INDEX IF NOT EXISTS coupon_assignments_assigned_by_idx
  ON public.coupon_assignments (assigned_by);

CREATE INDEX IF NOT EXISTS coupon_redemptions_request_id_idx
  ON public.coupon_redemptions (request_id);

CREATE INDEX IF NOT EXISTS coupon_subsidy_ledger_coupon_id_idx
  ON public.coupon_subsidy_ledger (coupon_id);

CREATE INDEX IF NOT EXISTS coupon_subsidy_ledger_customer_id_idx
  ON public.coupon_subsidy_ledger (customer_id);

CREATE INDEX IF NOT EXISTS user_subscriptions_granted_by_idx
  ON public.user_subscriptions (granted_by);

-- The unique constraint already owns an identical index on user_id.
-- Remove only the redundant standalone duplicate, preserving the constraint.
DROP INDEX IF EXISTS public.user_subscriptions_user_id_uidx;
