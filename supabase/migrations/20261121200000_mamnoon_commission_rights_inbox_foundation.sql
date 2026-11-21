-- Mamnoon commission-first billing foundation (additive; not applied to production by this commit).
-- Wallet debt is capped at IQD 5,000 below zero. Gateway settlement remains disabled
-- until the merchant account and ZainCash secrets pass UAT.

ALTER TABLE public.account_wallets
  DROP CONSTRAINT IF EXISTS account_wallets_balance_iqd_check;
ALTER TABLE public.account_wallets
  ADD CONSTRAINT account_wallets_balance_iqd_debt_cap_check
  CHECK (balance_iqd >= -5000);

ALTER TABLE public.account_wallet_transactions
  DROP CONSTRAINT IF EXISTS account_wallet_transactions_balance_after_iqd_check;
ALTER TABLE public.account_wallet_transactions
  ADD CONSTRAINT account_wallet_transactions_balance_after_debt_cap_check
  CHECK (balance_after_iqd >= -5000);

CREATE TABLE IF NOT EXISTS public.mamnoon_commission_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('global','governorate','role')),
  scope_key text,
  commission_rate_percent numeric(7,4) NOT NULL DEFAULT 0
    CHECK (commission_rate_percent >= 0 AND commission_rate_percent <= 100),
  commission_charge_percent numeric(7,4) NOT NULL DEFAULT 100
    CHECK (commission_charge_percent >= 0 AND commission_charge_percent <= 100),
  collection_event text NOT NULL DEFAULT 'taxi_acceptance'
    CHECK (collection_event IN ('taxi_acceptance','service_acceptance','order_acceptance')),
  free_trial_enabled boolean NOT NULL DEFAULT false,
  free_trial_days integer NOT NULL DEFAULT 0 CHECK (free_trial_days BETWEEN 0 AND 365),
  new_users_only boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mamnoon_commission_scope_key_check CHECK (
    (scope_type = 'global' AND scope_key IS NULL)
    OR (scope_type <> 'global' AND scope_key IS NOT NULL AND length(btrim(scope_key)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS mamnoon_commission_policies_scope_unique
  ON public.mamnoon_commission_policies(scope_type, COALESCE(scope_key, ''));

CREATE TABLE IF NOT EXISTS public.mamnoon_user_fee_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  commission_charge_percent numeric(7,4) NOT NULL
    CHECK (commission_charge_percent >= 0 AND commission_charge_percent <= 100),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 2 AND 500),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  CONSTRAINT mamnoon_user_fee_override_dates_check CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS mamnoon_user_fee_overrides_active_idx
  ON public.mamnoon_user_fee_overrides(user_id, starts_at DESC, ends_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.mamnoon_revenue_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid REFERENCES public.service_requests(id),
  revenue_type text NOT NULL CHECK (revenue_type IN ('taxi_commission','service_commission','order_commission','complaint_deduction','wallet_debt_collection','admin_credit_reversal')),
  assessed_iqd bigint NOT NULL CHECK (assessed_iqd >= 0),
  collected_iqd bigint NOT NULL DEFAULT 0 CHECK (collected_iqd >= 0 AND collected_iqd <= assessed_iqd),
  status text NOT NULL DEFAULT 'accrued'
    CHECK (status IN ('accrued','partially_collected','collected','void')),
  idempotency_key text NOT NULL UNIQUE,
  provider_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mamnoon_revenue_request_unique UNIQUE (request_id, revenue_type)
);

CREATE INDEX IF NOT EXISTS mamnoon_revenue_ledger_user_created_idx
  ON public.mamnoon_revenue_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mamnoon_revenue_ledger_status_idx
  ON public.mamnoon_revenue_ledger(status, created_at DESC);

ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS needs_admin_reply boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_status text NOT NULL DEFAULT 'bot'
    CHECK (handoff_status IN ('bot','waiting_for_admin','assigned','resolved')),
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS last_message_source text NOT NULL DEFAULT 'user'
    CHECK (last_message_source IN ('user','bot','admin')),
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

CREATE INDEX IF NOT EXISTS support_conversations_inbox_triage_idx
  ON public.support_conversations(needs_admin_reply DESC, last_message_at DESC NULLS LAST, updated_at DESC);

ALTER TABLE public.mamnoon_commission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mamnoon_user_fee_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mamnoon_revenue_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mamnoon_commission_policies FROM anon, authenticated;
REVOKE ALL ON public.mamnoon_user_fee_overrides FROM anon, authenticated;
REVOKE ALL ON public.mamnoon_revenue_ledger FROM anon, authenticated;

COMMENT ON TABLE public.mamnoon_commission_policies IS
  'Commission-first billing rules by global, governorate, or account role scope. Subscription plans are not the billing model.';
COMMENT ON TABLE public.mamnoon_user_fee_overrides IS
  'Time-bounded per-user commission charge overrides. A 0 percent value means no commission is collected during the override.';
COMMENT ON TABLE public.mamnoon_revenue_ledger IS
  'Append-oriented accounting ledger for assessed and collected Mamnoon revenue; gateway collection is only recorded after verified settlement.';
