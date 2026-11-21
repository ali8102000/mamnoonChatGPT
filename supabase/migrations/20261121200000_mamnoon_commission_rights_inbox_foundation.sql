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
  scope_type text NOT NULL CHECK (scope_type IN ('global','governorate','role','governorate_role')),
  scope_key text,
  commission_rate_percent numeric(7,4) NOT NULL DEFAULT 0
    CHECK (commission_rate_percent >= 0 AND commission_rate_percent <= 100),
  commission_charge_percent numeric(7,4) NOT NULL DEFAULT 100
    CHECK (commission_charge_percent >= 0 AND commission_charge_percent <= 100),
  collection_event text NOT NULL DEFAULT 'taxi_acceptance'
    CHECK (collection_event IN ('taxi_acceptance','service_acceptance','order_acceptance','all_acceptance')),
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

DROP INDEX IF EXISTS public.mamnoon_commission_policies_scope_unique;
CREATE UNIQUE INDEX mamnoon_commission_policies_scope_unique
  ON public.mamnoon_commission_policies(scope_type, COALESCE(scope_key, ''), collection_event)
  WHERE is_enabled = true;

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

CREATE OR REPLACE FUNCTION public.sync_support_inbox_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_ai_status text;
BEGIN
  SELECT user_id, ai_status INTO v_user_id, v_ai_status
  FROM public.support_conversations
  WHERE id = NEW.conversation_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.support_conversations
  SET last_message_at = NEW.created_at,
      last_message_source = CASE
        WHEN NEW.is_ai THEN 'bot'
        WHEN NEW.sender_id = v_user_id THEN 'user'
        ELSE 'admin'
      END,
      needs_admin_reply = CASE
        WHEN NEW.is_ai THEN (v_ai_status = 'waiting_human')
        WHEN NEW.sender_id = v_user_id THEN (v_ai_status = 'waiting_human')
        ELSE false
      END,
      handoff_status = CASE
        WHEN NEW.is_ai AND v_ai_status = 'waiting_human' THEN 'waiting_for_admin'
        WHEN NEW.is_ai THEN handoff_status
        WHEN NEW.sender_id = v_user_id AND v_ai_status = 'waiting_human' THEN 'waiting_for_admin'
        WHEN NEW.sender_id <> v_user_id THEN 'assigned'
        ELSE handoff_status
      END,
      ticket_status = CASE
        WHEN NEW.sender_id = v_user_id AND v_ai_status = 'waiting_human' THEN 'new'
        WHEN NEW.sender_id <> v_user_id THEN 'in_progress'
        ELSE ticket_status
      END,
      updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_support_inbox_metadata ON public.support_messages;
CREATE TRIGGER sync_support_inbox_metadata
AFTER INSERT ON public.support_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_support_inbox_metadata();

REVOKE ALL ON FUNCTION public.sync_support_inbox_metadata() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.mamnoon_revenue_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_ledger_id uuid NOT NULL REFERENCES public.mamnoon_revenue_ledger(id),
  payment_id uuid NOT NULL REFERENCES public.payment_transactions(id),
  amount_iqd bigint NOT NULL CHECK (amount_iqd > 0),
  provider_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mamnoon_revenue_collection_once UNIQUE (revenue_ledger_id, payment_id)
);
CREATE INDEX IF NOT EXISTS mamnoon_revenue_collections_payment_idx
  ON public.mamnoon_revenue_collections(payment_id);
ALTER TABLE public.mamnoon_revenue_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mamnoon_revenue_collections FROM anon, authenticated;

-- Verified ZainCash wallet top-ups first repay the wallet debt, then credit any
-- remainder. New subscription purchases are intentionally disabled; historical
-- subscription rows remain untouched for audit/compatibility.
CREATE OR REPLACE FUNCTION public.finalize_zaincash_payment(
  p_payment_id uuid,
  p_gateway_transaction_id text,
  p_gateway_status text,
  p_confirmed_amount integer,
  p_currency text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment public.payment_transactions%ROWTYPE;
  v_balance bigint;
  v_debt_collected bigint := 0;
  v_remaining bigint := 0;
  v_due bigint := 0;
  v_take bigint := 0;
  v_wallet_result jsonb;
  v_revenue public.mamnoon_revenue_ledger%ROWTYPE;
  v_fallback_id uuid;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT * INTO v_payment
  FROM public.payment_transactions
  WHERE id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF v_payment.status = 'paid' THEN RETURN true; END IF;
  IF v_payment.status <> 'pending' THEN RETURN false; END IF;

  IF p_gateway_status <> 'SUCCESS' THEN
    UPDATE public.payment_transactions
    SET gateway_status = p_gateway_status,
        status = CASE WHEN p_gateway_status = 'EXPIRED' THEN 'expired' ELSE 'failed' END,
        gateway_transaction_id = COALESCE(gateway_transaction_id,p_gateway_transaction_id),
        metadata = metadata || COALESCE(p_payload,'{}'::jsonb),
        updated_at = now()
    WHERE id = v_payment.id;
    RETURN false;
  END IF;

  IF p_confirmed_amount <> v_payment.amount OR p_currency <> 'IQD' THEN
    RAISE EXCEPTION 'payment_amount_or_currency_mismatch';
  END IF;

  IF v_payment.purpose = 'subscription' THEN
    RAISE EXCEPTION 'subscriptions_disabled_use_commission_billing';
  ELSIF v_payment.purpose = 'wallet_topup' THEN
    IF p_gateway_transaction_id IS NULL OR length(p_gateway_transaction_id) < 3 THEN
      RAISE EXCEPTION 'gateway_transaction_id_required';
    END IF;

    INSERT INTO public.account_wallets(user_id)
    VALUES (v_payment.user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT balance_iqd INTO v_balance
    FROM public.account_wallets
    WHERE user_id = v_payment.user_id
    FOR UPDATE;

    v_debt_collected := LEAST(v_payment.amount::bigint, GREATEST(0, -v_balance));

    v_wallet_result := public.apply_account_wallet_transaction(
      v_payment.user_id,
      'zaincash_topup',
      v_payment.amount::bigint,
      'zaincash-payment:' || v_payment.id::text,
      'zaincash',
      p_gateway_transaction_id,
      'شحن محفظة ممنون عبر زين كاش - تسوية الدين أولاً',
      jsonb_build_object(
        'payment_id', v_payment.id,
        'external_reference_id', v_payment.external_reference_id,
        'gateway_transaction_id', p_gateway_transaction_id,
        'verified_status', 'SUCCESS',
        'debt_collected_iqd', v_debt_collected
      )
    );

    v_remaining := v_debt_collected;
    FOR v_revenue IN
      SELECT *
      FROM public.mamnoon_revenue_ledger
      WHERE user_id = v_payment.user_id
        AND status IN ('accrued','partially_collected','partially_waived')
        AND assessed_iqd > collected_iqd + waived_iqd
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_due := v_revenue.assessed_iqd - v_revenue.collected_iqd - v_revenue.waived_iqd;
      v_take := LEAST(v_remaining, v_due);
      UPDATE public.mamnoon_revenue_ledger
      SET collected_iqd = collected_iqd + v_take,
          status = CASE
            WHEN collected_iqd + v_take >= assessed_iqd THEN 'collected'
            WHEN collected_iqd + waived_iqd + v_take >= assessed_iqd THEN 'waived'
            ELSE 'partially_collected'
          END,
          updated_at = now()
      WHERE id = v_revenue.id;

      INSERT INTO public.mamnoon_revenue_collections(
        revenue_ledger_id, payment_id, amount_iqd, provider_reference
      ) VALUES (v_revenue.id, v_payment.id, v_take, p_gateway_transaction_id)
      ON CONFLICT (revenue_ledger_id, payment_id) DO NOTHING;

      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      INSERT INTO public.mamnoon_revenue_ledger(
        user_id, revenue_type, assessed_iqd, collected_iqd, status,
        idempotency_key, provider_reference, metadata
      ) VALUES (
        v_payment.user_id, 'wallet_debt_collection', v_remaining, v_remaining, 'collected',
        'zaincash-debt:' || v_payment.id::text, p_gateway_transaction_id,
        jsonb_build_object('payment_id', v_payment.id, 'source', 'wallet_negative_balance')
      )
      ON CONFLICT (idempotency_key) DO UPDATE
        SET collected_iqd = EXCLUDED.collected_iqd,
            status = EXCLUDED.status,
            provider_reference = EXCLUDED.provider_reference,
            updated_at = now()
      RETURNING id INTO v_fallback_id;

      INSERT INTO public.mamnoon_revenue_collections(
        revenue_ledger_id, payment_id, amount_iqd, provider_reference
      ) VALUES (v_fallback_id, v_payment.id, v_remaining, p_gateway_transaction_id)
      ON CONFLICT (revenue_ledger_id, payment_id) DO NOTHING;
    END IF;

  ELSIF v_payment.purpose = 'service_request' THEN
    UPDATE public.service_requests
    SET payment_method='zaincash', updated_at=now()
    WHERE id=v_payment.request_id
      AND customer_id=v_payment.user_id
      AND status IN ('accepted','in_progress','completed');
    IF NOT FOUND THEN RAISE EXCEPTION 'request_not_payable_or_not_owned'; END IF;
  ELSE
    RAISE EXCEPTION 'unsupported_payment_purpose';
  END IF;

  UPDATE public.payment_transactions
  SET status='paid',gateway_status='SUCCESS',
      gateway_transaction_id=p_gateway_transaction_id,paid_at=now(),
      metadata=metadata || COALESCE(p_payload,'{}'::jsonb) ||
        jsonb_build_object('debt_collected_iqd',v_debt_collected),
      updated_at=now()
  WHERE id=v_payment.id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_zaincash_payment(uuid,text,text,integer,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_zaincash_payment(uuid,text,text,integer,text,jsonb)
  TO service_role;

-- Permit provider commission deductions to create a controlled wallet debt.
CREATE OR REPLACE FUNCTION public.apply_account_wallet_transaction(
  p_user_id uuid,
  p_transaction_type text,
  p_amount_iqd bigint,
  p_idempotency_key text,
  p_provider text DEFAULT NULL,
  p_provider_reference text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_balance bigint;
  v_next_balance bigint;
  v_transaction_id uuid;
  v_existing public.account_wallet_transactions%ROWTYPE;
  v_role text;
BEGIN
  v_role := auth.jwt() ->> 'role';
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'wallet_user_required'; END IF;
  IF p_transaction_type NOT IN ('topup','zaincash_topup','payment','deduction','refund','cashout','adjustment') THEN
    RAISE EXCEPTION 'invalid_wallet_transaction_type';
  END IF;
  IF p_amount_iqd IS NULL OR p_amount_iqd = 0 THEN
    RAISE EXCEPTION 'wallet_amount_must_be_nonzero_iqd';
  END IF;
  IF p_transaction_type IN ('topup','zaincash_topup','refund') AND p_amount_iqd < 0 THEN
    RAISE EXCEPTION 'wallet_credit_must_be_positive';
  END IF;
  IF p_transaction_type IN ('payment','deduction','cashout') AND p_amount_iqd > 0 THEN
    RAISE EXCEPTION 'wallet_debit_must_be_negative';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'valid_idempotency_key_required';
  END IF;
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'wallet_metadata_must_be_object';
  END IF;

  INSERT INTO public.account_wallets(user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance_iqd INTO v_balance
  FROM public.account_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  SELECT * INTO v_existing
  FROM public.account_wallet_transactions
  WHERE idempotency_key = p_idempotency_key
     OR (p_provider IS NOT NULL AND p_provider_reference IS NOT NULL
         AND provider = p_provider AND provider_reference = p_provider_reference)
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id <> p_user_id
       OR v_existing.transaction_type <> p_transaction_type
       OR v_existing.amount_iqd <> p_amount_iqd
       OR v_existing.idempotency_key <> p_idempotency_key THEN
      RAISE EXCEPTION 'wallet_idempotency_or_provider_reference_conflict';
    END IF;
    RETURN jsonb_build_object('transaction_id',v_existing.id,'balance_iqd',v_existing.balance_after_iqd,'duplicate',true);
  END IF;

  v_next_balance := v_balance + p_amount_iqd;
  IF v_next_balance < -5000 THEN
    RAISE EXCEPTION 'wallet_debt_limit_exceeded';
  END IF;

  INSERT INTO public.account_wallet_transactions(
    user_id,transaction_type,amount_iqd,balance_after_iqd,
    provider,provider_reference,idempotency_key,description,metadata
  ) VALUES (
    p_user_id,p_transaction_type,p_amount_iqd,v_next_balance,
    p_provider,p_provider_reference,p_idempotency_key,left(p_description,500),p_metadata
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.account_wallet_transactions
    WHERE idempotency_key = p_idempotency_key
       OR (p_provider IS NOT NULL AND p_provider_reference IS NOT NULL
           AND provider = p_provider AND provider_reference = p_provider_reference)
    LIMIT 1;
    IF NOT FOUND OR v_existing.user_id <> p_user_id
       OR v_existing.transaction_type <> p_transaction_type
       OR v_existing.amount_iqd <> p_amount_iqd
       OR v_existing.idempotency_key <> p_idempotency_key THEN
      RAISE EXCEPTION 'wallet_idempotency_or_provider_reference_conflict';
    END IF;
    RETURN jsonb_build_object('transaction_id',v_existing.id,'balance_iqd',v_existing.balance_after_iqd,'duplicate',true);
  END IF;

  UPDATE public.account_wallets
  SET balance_iqd = v_next_balance, updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('transaction_id',v_transaction_id,'balance_iqd',v_next_balance,'duplicate',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_account_wallet_transaction(uuid,text,bigint,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_account_wallet_transaction(uuid,text,bigint,text,text,text,text,jsonb)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.mamnoon_user_trial_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_role text NOT NULL,
  policy_id uuid REFERENCES public.mamnoon_commission_policies(id) ON DELETE SET NULL,
  governorate_key text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'signup' CHECK (source IN ('signup','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mamnoon_user_trial_role_unique UNIQUE (user_id, account_role),
  CONSTRAINT mamnoon_user_trial_dates_check CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS mamnoon_user_trial_active_idx
  ON public.mamnoon_user_trial_entitlements(user_id, account_role, ends_at);
ALTER TABLE public.mamnoon_user_trial_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mamnoon_user_trial_entitlements FROM anon, authenticated;

-- Paid subscriptions are no longer a product entitlement. Keep legacy subscription
-- records intact, but do not let their settings block provider activity.
CREATE OR REPLACE FUNCTION public.mamnoon_provider_subscription_active(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_user_id
     AND NOT public.has_admin_access(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.mamnoon_provider_subscription_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mamnoon_provider_subscription_active(uuid) TO authenticated, service_role;

-- Called only inside the trusted request-acceptance transaction. The user's
-- fee override is evaluated before governorate/category/global policies.
CREATE OR REPLACE FUNCTION public.charge_mamnoon_commission_on_accept(
  p_user_id uuid,
  p_request_id uuid,
  p_base_amount_iqd bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_request public.service_requests%ROWTYPE;
  v_role text;
  v_governorate text;
  v_event text;
  v_revenue_type text;
  v_base bigint;
  v_rate numeric(7,4) := 0;
  v_charge_percent numeric(7,4) := 100;
  v_override numeric(7,4);
  v_override_found boolean := false;
  v_commission bigint := 0;
  v_collected bigint := 0;
  v_balance bigint := 0;
  v_next_balance bigint := 0;
  v_policy public.mamnoon_commission_policies%ROWTYPE;
  v_existing public.account_wallet_transactions%ROWTYPE;
  v_key text;
BEGIN
  IF p_user_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_commission_target'; END IF;
  SELECT * INTO v_request FROM public.service_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_unavailable'; END IF;
  IF v_request.provider_id IS NOT NULL AND v_request.provider_id <> p_user_id THEN
    RAISE EXCEPTION 'commission_provider_mismatch';
  END IF;

  SELECT role::text INTO v_role
  FROM public.user_roles
  WHERE user_id = p_user_id AND role::text IN ('driver','large_driver','worker')
  ORDER BY CASE
    WHEN v_request.type::text = 'taxi' AND v_request.vehicle_category::text = 'large' AND role::text = 'large_driver' THEN 1
    WHEN role::text = 'driver' THEN 2
    WHEN role::text = 'large_driver' THEN 3
    ELSE 4
  END
  LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'commission_provider_role_required'; END IF;

  v_governorate := COALESCE(v_request.governorate_key,
    (SELECT governorate_key FROM public.profiles WHERE id=p_user_id));
  v_event := CASE WHEN v_request.type::text = 'taxi' THEN 'taxi_acceptance' ELSE 'service_acceptance' END;
  v_revenue_type := CASE WHEN v_request.type::text = 'taxi' THEN 'taxi_commission' ELSE 'service_commission' END;
  v_base := COALESCE(p_base_amount_iqd, v_request.customer_payable::bigint,
                     v_request.customer_price::bigint, v_request.price_estimate::bigint,
                     (SELECT ro.proposed_price::bigint FROM public.request_offers ro
                       WHERE ro.request_id = p_request_id AND ro.provider_id = p_user_id
                       ORDER BY ro.sent_at DESC NULLS LAST LIMIT 1), 0);
  IF v_base <= 0 THEN RETURN 0; END IF;

  SELECT * INTO v_policy
  FROM public.mamnoon_commission_policies p
  WHERE p.is_enabled = true
    AND p.collection_event IN (v_event,'all_acceptance')
    AND (p.starts_at IS NULL OR p.starts_at <= now())
    AND (p.ends_at IS NULL OR p.ends_at > now())
    AND (
      (p.scope_type = 'governorate_role' AND p.scope_key = COALESCE(v_governorate,'') || ':' || v_role)
      OR (p.scope_type = 'governorate' AND p.scope_key = v_governorate)
      OR (p.scope_type = 'role' AND p.scope_key = v_role)
      OR (p.scope_type = 'global' AND p.scope_key IS NULL)
    )
  ORDER BY CASE p.scope_type
    WHEN 'governorate_role' THEN 1
    WHEN 'governorate' THEN 2
    WHEN 'role' THEN 3
    ELSE 4
  END,
    CASE WHEN p.collection_event=v_event THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND THEN RETURN 0; END IF;
  v_rate := v_policy.commission_rate_percent;
  v_charge_percent := v_policy.commission_charge_percent;

  SELECT commission_charge_percent INTO v_override
  FROM public.mamnoon_user_fee_overrides
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND starts_at <= now()
    AND (ends_at IS NULL OR ends_at > now())
  ORDER BY starts_at DESC, created_at DESC
  LIMIT 1;
  v_override_found := FOUND;
  IF v_override_found THEN v_charge_percent := v_override; END IF;

  IF NOT v_override_found AND EXISTS (
    SELECT 1 FROM public.mamnoon_user_trial_entitlements t
    WHERE t.user_id = p_user_id AND t.account_role = v_role
      AND t.starts_at <= now() AND t.ends_at > now()
      AND (t.governorate_key IS NULL OR t.governorate_key = v_governorate)
  ) THEN
    v_charge_percent := 0;
  END IF;

  v_commission := round(v_base::numeric * v_rate / 100 * v_charge_percent / 100)::bigint;
  IF v_commission <= 0 THEN RETURN 0; END IF;

  v_key := 'mamnoon-commission:' || p_request_id::text || ':' || p_user_id::text;
  SELECT * INTO v_existing FROM public.account_wallet_transactions
  WHERE idempotency_key = v_key;
  IF FOUND THEN RETURN abs(v_existing.amount_iqd); END IF;

  INSERT INTO public.account_wallets(user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT balance_iqd INTO v_balance
  FROM public.account_wallets WHERE user_id = p_user_id FOR UPDATE;

  v_collected := LEAST(v_commission, GREATEST(v_balance,0));
  v_next_balance := v_balance - v_commission;
  IF v_next_balance < -5000 THEN RAISE EXCEPTION 'wallet_debt_limit_exceeded'; END IF;

  INSERT INTO public.account_wallet_transactions(
    user_id, transaction_type, amount_iqd, balance_after_iqd,
    provider, provider_reference, idempotency_key, description, metadata
  ) VALUES (
    p_user_id, 'deduction', -v_commission, v_next_balance,
    'mamnoon', p_request_id::text, v_key,
    'عمولة ممنون عند قبول الطلب',
    jsonb_build_object('request_id',p_request_id,'collection_event',v_event,'commission_rate_percent',v_rate,'commission_charge_percent',v_charge_percent)
  );

  UPDATE public.account_wallets SET balance_iqd = v_next_balance, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.mamnoon_revenue_ledger(
    user_id, request_id, revenue_type, assessed_iqd, collected_iqd, status, idempotency_key, metadata
  ) VALUES (
    p_user_id, p_request_id, v_revenue_type, v_commission, v_collected,
    CASE WHEN v_collected >= v_commission THEN 'collected' WHEN v_collected > 0 THEN 'partially_collected' ELSE 'accrued' END, v_key,
    jsonb_build_object('base_amount_iqd',v_base,'commission_rate_percent',v_rate,'commission_charge_percent',v_charge_percent,'wallet_balance_after_iqd',v_next_balance)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_commission;
END;
$function$;

REVOKE ALL ON FUNCTION public.charge_mamnoon_commission_on_accept(uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated;

-- The provider acceptance RPC charges the configured platform commission atomically
-- before it assigns the provider. Any failure rolls back both charge and acceptance.
CREATE OR REPLACE FUNCTION public.accept_service_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  r public.service_requests%ROWTYPE;
  v_customer uuid;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.has_role(auth.uid(), 'driver') OR public.has_role(auth.uid(), 'worker')) THEN
    RAISE EXCEPTION 'provider_role_required';
  END IF;
  IF NOT public.mamnoon_provider_subscription_active(auth.uid()) THEN
    RAISE EXCEPTION 'provider_unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.user_id = auth.uid()
    AND (b.expires_at IS NULL OR b.expires_at > now())) THEN
    RAISE EXCEPTION 'user_blocked';
  END IF;
  IF EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = auth.uid()
    AND dp.suspended_until IS NOT NULL AND dp.suspended_until > now())
    OR EXISTS (SELECT 1 FROM public.worker_profiles wp WHERE wp.user_id = auth.uid()
    AND wp.suspended_until IS NOT NULL AND wp.suspended_until > now()) THEN
    RAISE EXCEPTION 'provider_temporarily_suspended';
  END IF;

  SELECT * INTO r FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_unavailable'; END IF;

  PERFORM 1 FROM public.request_offers o
  WHERE o.request_id = _request_id AND o.provider_id = auth.uid()
    AND o.status = 'pending' AND o.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_offer_expired'; END IF;

  PERFORM pg_advisory_xact_lock(91840060);
  IF EXISTS (SELECT 1 FROM public.service_requests active
    WHERE active.provider_id = auth.uid() AND active.status IN ('accepted', 'in_progress')) THEN
    RAISE EXCEPTION 'لديك طلب نشط بالفعل';
  END IF;

  PERFORM public.charge_mamnoon_commission_on_accept(auth.uid(), _request_id, NULL);

  PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
  UPDATE public.service_requests sr
  SET provider_id = auth.uid(), status = 'accepted', accepted_at = now()
  WHERE sr.id = _request_id
    AND sr.status IN ('pending', 'searching')
    AND sr.provider_id IS NULL
    AND (
      (r.type = 'taxi' AND r.vehicle_category::text IS DISTINCT FROM 'large'
        AND public.has_role(auth.uid(), 'driver')
        AND EXISTS (SELECT 1 FROM public.driver_profiles dp
          WHERE dp.user_id = auth.uid() AND dp.vehicle_category = r.vehicle_category
            AND dp.vehicle_category::text IN ('economy', 'premium', 'luxury')
            AND dp.status = 'approved' AND dp.available = true
            AND (dp.suspended_until IS NULL OR dp.suspended_until <= now())))
      OR
      (r.type = 'service' AND public.has_role(auth.uid(), 'worker')
        AND r.service_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.worker_profiles wp
          WHERE wp.user_id = auth.uid() AND wp.status = 'approved' AND wp.available = true
            AND (wp.suspended_until IS NULL OR wp.suspended_until <= now())
            AND (r.level_required IS NULL OR wp.level = r.level_required))
        AND EXISTS (SELECT 1 FROM public.worker_services ws
          WHERE ws.worker_id = auth.uid() AND ws.service_id = r.service_id))
    )
  RETURNING sr.customer_id INTO v_customer;
  PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'request_unavailable_or_specialty_mismatch'; END IF;

  INSERT INTO public.chats(request_id, customer_id, provider_id)
  VALUES (_request_id, v_customer, auth.uid())
  ON CONFLICT (request_id)
  DO UPDATE SET provider_id = EXCLUDED.provider_id, updated_at = now();

  UPDATE public.request_offers
  SET status = CASE WHEN provider_id = auth.uid() THEN 'accepted' ELSE 'cancelled' END,
      responded_at = now()
  WHERE request_id = _request_id AND status = 'pending';

  INSERT INTO public.notifications(user_id, type, title, body, link, data)
  VALUES (v_customer, 'request_accepted', 'تم قبول طلبك',
    'مقدّم الخدمة قبل طلبك ويمكنك متابعة التفاصيل الآن.',
    '/request/' || _request_id,
    jsonb_build_object('request_id', _request_id, 'provider_id', auth.uid()));
  RETURN true;
END;
$function$;

-- No user-side cancellation after a taxi has been accepted. Admins retain the
-- existing audited exception path; no commission refund is created.
CREATE OR REPLACE FUNCTION public.guard_no_cancel_after_taxi_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.type::text = 'taxi'
     AND OLD.status::text IN ('accepted','in_progress')
     AND NEW.status::text = 'cancelled'
     AND auth.uid() IS NOT NULL
     AND NOT public.has_admin_access(auth.uid()) THEN
    RAISE EXCEPTION 'taxi_cancellation_disabled_after_acceptance';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_no_cancel_after_taxi_acceptance ON public.service_requests;
CREATE TRIGGER guard_no_cancel_after_taxi_acceptance
BEFORE UPDATE OF status ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_no_cancel_after_taxi_acceptance();
REVOKE ALL ON FUNCTION public.guard_no_cancel_after_taxi_acceptance() FROM PUBLIC, anon, authenticated;

-- Expire only unaccepted requests. Accepted trips are never touched by this job.
CREATE OR REPLACE FUNCTION public.expire_unaccepted_mamnoon_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH expired_requests AS (
    UPDATE public.service_requests
    SET status = 'cancelled',
        cancellation_reason = 'انتهت مهلة قبول الطلب بعد 6 ساعات',
        updated_at = now()
    WHERE status::text IN ('pending','searching')
      AND type::text = 'taxi'
      AND provider_id IS NULL
      AND created_at <= now() - interval '6 hours'
    RETURNING id, customer_id
  )
  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  SELECT customer_id,'request_expired','تم إلغاء طلبك تلقائياً',
    'انتهت مهلة انتظار قبول الطلب بعد ست ساعات.',
    '/request/' || id,
    jsonb_build_object('request_id',id,'reason','six_hour_expiry')
  FROM expired_requests;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.request_offers
  SET status = 'cancelled', responded_at = now()
  WHERE status = 'pending'
    AND request_id IN (
      SELECT id FROM public.service_requests
      WHERE status::text = 'cancelled'
        AND type::text = 'taxi'
        AND cancellation_reason = 'انتهت مهلة قبول الطلب بعد 6 ساعات'
        AND updated_at >= now() - interval '10 minutes'
    );

  DELETE FROM public.service_dispatch_queue
  WHERE request_id IN (
    SELECT id FROM public.service_requests
    WHERE status::text = 'cancelled'
      AND type::text = 'taxi'
      AND cancellation_reason = 'انتهت مهلة قبول الطلب بعد 6 ساعات'
      AND updated_at >= now() - interval '10 minutes'
  );
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.expire_unaccepted_mamnoon_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unaccepted_mamnoon_requests() TO service_role;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'mamnoon-expire-unaccepted-requests',
      '* * * * *',
      'select public.expire_unaccepted_mamnoon_requests();'
    );
  END IF;
END;
$schedule$;

-- Signup-based trials are snapshotted by account role. Turning an offer off closes
-- its policy window for future signups but never shortens already granted trials.
CREATE OR REPLACE FUNCTION public.grant_mamnoon_signup_trial_for_role(
  p_user_id uuid,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_signup_at timestamptz;
  v_governorate text;
  v_trial_governorate text;
  v_policy public.mamnoon_commission_policies%ROWTYPE;
BEGIN
  IF p_role NOT IN ('driver','large_driver','worker','restaurant','hotel','store') THEN RETURN; END IF;

  SELECT created_at INTO v_signup_at FROM auth.users WHERE id = p_user_id;
  IF v_signup_at IS NULL THEN RETURN; END IF;
  IF p_role IN ('restaurant','hotel','store') THEN
    SELECT governorate_key INTO v_governorate
    FROM public.partner_business_profiles
    WHERE user_id=p_user_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  IF v_governorate IS NULL THEN
    SELECT governorate_key INTO v_governorate FROM public.profiles WHERE id = p_user_id;
  END IF;

  SELECT * INTO v_policy
  FROM public.mamnoon_commission_policies p
  WHERE p.free_trial_enabled = true
    AND p.new_users_only = true
    AND p.free_trial_days > 0
    AND (
      p.collection_event='all_acceptance'
      OR (p.collection_event='taxi_acceptance' AND p_role IN ('driver','large_driver'))
      OR (p.collection_event='service_acceptance' AND p_role='worker')
      OR (p.collection_event='order_acceptance' AND p_role IN ('restaurant','hotel','store'))
    )
    AND COALESCE(p.starts_at, p.created_at) <= v_signup_at
    AND (p.ends_at IS NULL OR p.ends_at > v_signup_at)
    AND (
      (p.scope_type = 'governorate_role' AND p.scope_key = COALESCE(v_governorate,'') || ':' || p_role)
      OR (p.scope_type = 'governorate' AND p.scope_key = v_governorate)
      OR (p.scope_type = 'role' AND p.scope_key = p_role)
      OR (p.scope_type = 'global' AND p.scope_key IS NULL)
    )
  ORDER BY CASE p.scope_type
    WHEN 'governorate_role' THEN 1
    WHEN 'governorate' THEN 2
    WHEN 'role' THEN 3
    ELSE 4
  END
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  v_trial_governorate := CASE WHEN v_policy.scope_type IN ('governorate','governorate_role') THEN v_governorate ELSE NULL END;
  INSERT INTO public.mamnoon_user_trial_entitlements(
    user_id, account_role, policy_id, governorate_key, starts_at, ends_at, source
  ) VALUES (
    p_user_id, p_role, v_policy.id, v_trial_governorate, v_signup_at,
    v_signup_at + make_interval(days => v_policy.free_trial_days), 'signup'
  )
  ON CONFLICT (user_id, account_role) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_mamnoon_signup_trial_from_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.grant_mamnoon_signup_trial_for_role(NEW.user_id, NEW.role::text);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mamnoon_signup_trial_after_role_insert ON public.user_roles;
CREATE TRIGGER mamnoon_signup_trial_after_role_insert
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.trigger_mamnoon_signup_trial_from_role();

CREATE OR REPLACE FUNCTION public.trigger_mamnoon_signup_trial_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role text;
BEGIN
  IF NEW.governorate_key IS DISTINCT FROM OLD.governorate_key THEN
    FOR v_role IN
      SELECT role::text FROM public.user_roles
      WHERE user_id = NEW.id AND role::text IN ('driver','large_driver','worker')
    LOOP
      PERFORM public.grant_mamnoon_signup_trial_for_role(NEW.id, v_role);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mamnoon_signup_trial_after_governorate_update ON public.profiles;
CREATE TRIGGER mamnoon_signup_trial_after_governorate_update
AFTER UPDATE OF governorate_key ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.trigger_mamnoon_signup_trial_from_profile();

REVOKE ALL ON FUNCTION public.grant_mamnoon_signup_trial_for_role(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_mamnoon_signup_trial_from_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_mamnoon_signup_trial_from_profile() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.charge_commission_on_request_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.status::text IN ('pending','searching')
     AND NEW.status::text = 'accepted'
     AND NEW.provider_id IS NOT NULL
     AND NEW.type::text IN ('taxi','service') THEN
    PERFORM public.charge_mamnoon_commission_on_accept(
      NEW.provider_id,
      NEW.id,
      COALESCE(NEW.customer_payable::bigint, NEW.customer_price::bigint, NEW.price_estimate::bigint)
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS charge_commission_on_request_acceptance ON public.service_requests;
CREATE TRIGGER charge_commission_on_request_acceptance
BEFORE UPDATE OF status ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.charge_commission_on_request_acceptance();
REVOKE ALL ON FUNCTION public.charge_commission_on_request_acceptance() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.mamnoon_revenue_ledger
  ADD COLUMN IF NOT EXISTS waived_iqd bigint NOT NULL DEFAULT 0 CHECK (waived_iqd >= 0),
  ADD COLUMN IF NOT EXISTS waived_by uuid REFERENCES auth.users(id);
ALTER TABLE public.mamnoon_revenue_ledger
  DROP CONSTRAINT IF EXISTS mamnoon_revenue_ledger_collected_iqd_check,
  DROP CONSTRAINT IF EXISTS mamnoon_revenue_ledger_status_check;
ALTER TABLE public.mamnoon_revenue_ledger
  ADD CONSTRAINT mamnoon_revenue_collected_nonnegative_check
    CHECK (collected_iqd >= 0),
  ADD CONSTRAINT mamnoon_revenue_collected_waived_check
    CHECK (collected_iqd + waived_iqd <= assessed_iqd),
  ADD CONSTRAINT mamnoon_revenue_ledger_status_check
    CHECK (status IN ('accrued','partially_collected','collected','void','partially_waived','waived'));

CREATE OR REPLACE FUNCTION public.admin_adjust_account_wallet(
  p_user_id uuid,
  p_amount_iqd bigint,
  p_type text,
  p_note text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_governorate text;
  v_balance bigint;
  v_next_balance bigint;
  v_delta bigint;
  v_collected bigint;
  v_waived bigint;
  v_tx_id uuid;
  v_ledger public.mamnoon_revenue_ledger%ROWTYPE;
  v_due bigint;
  v_take bigint;
  v_remaining bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_user_id IS NULL OR p_amount_iqd IS NULL OR p_amount_iqd <= 0 OR p_amount_iqd > 100000000 THEN
    RAISE EXCEPTION 'invalid_wallet_adjustment';
  END IF;
  IF p_type NOT IN ('credit','debit') THEN RAISE EXCEPTION 'invalid_adjustment_type'; END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'valid_idempotency_key_required';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION 'wallet_adjustment_reason_required';
  END IF;

  SELECT governorate_key INTO v_governorate FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_user_not_found'; END IF;
  IF NOT (
    public.is_super_admin(auth.uid())
    OR public.admin_has_permission(
      'finance.wallet.adjust',
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    )
  ) THEN RAISE EXCEPTION 'missing_finance_wallet_permission'; END IF;

  SELECT id INTO v_tx_id FROM public.account_wallet_transactions
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN (SELECT jsonb_build_object('transaction_id',id,'balance_iqd',balance_after_iqd,'duplicate',true)
            FROM public.account_wallet_transactions WHERE id = v_tx_id);
  END IF;

  INSERT INTO public.account_wallets(user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT balance_iqd INTO v_balance FROM public.account_wallets WHERE user_id = p_user_id FOR UPDATE;

  v_delta := CASE WHEN p_type = 'credit' THEN p_amount_iqd ELSE -p_amount_iqd END;
  v_next_balance := v_balance + v_delta;
  IF v_next_balance < -5000 THEN RAISE EXCEPTION 'wallet_debt_limit_exceeded'; END IF;

  INSERT INTO public.account_wallet_transactions(
    user_id,transaction_type,amount_iqd,balance_after_iqd,provider,idempotency_key,description,metadata
  ) VALUES (
    p_user_id,'adjustment',v_delta,v_next_balance,'mamnoon_admin',p_idempotency_key,
    left(p_note,500),jsonb_build_object('actor_user_id',auth.uid(),'adjustment_type',p_type)
  ) RETURNING id INTO v_tx_id;

  UPDATE public.account_wallets SET balance_iqd = v_next_balance, updated_at = now()
  WHERE user_id = p_user_id;

  IF p_type = 'debit' THEN
    v_collected := LEAST(p_amount_iqd, GREATEST(v_balance,0));
    v_remaining := p_amount_iqd - v_collected;
    INSERT INTO public.mamnoon_revenue_ledger(
      user_id,revenue_type,assessed_iqd,collected_iqd,status,idempotency_key,metadata
    ) VALUES (
      p_user_id,'complaint_deduction',p_amount_iqd,v_collected,
      CASE WHEN v_collected >= p_amount_iqd THEN 'collected'
           WHEN v_collected > 0 THEN 'partially_collected' ELSE 'accrued' END,
      'complaint:' || p_idempotency_key,
      jsonb_build_object('note',p_note,'wallet_transaction_id',v_tx_id)
    );
  ELSE
    -- An administrative credit that reduces an existing debt is a documented
    -- company waiver, not cash revenue and not a ZainCash collection.
    v_waived := LEAST(p_amount_iqd, GREATEST(0,-v_balance));
    v_remaining := v_waived;
    FOR v_ledger IN
      SELECT * FROM public.mamnoon_revenue_ledger
      WHERE user_id = p_user_id AND status IN ('accrued','partially_collected','partially_waived')
        AND assessed_iqd > collected_iqd + waived_iqd
      ORDER BY created_at ASC,id ASC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_due := v_ledger.assessed_iqd - v_ledger.collected_iqd - v_ledger.waived_iqd;
      v_take := LEAST(v_remaining,v_due);
      UPDATE public.mamnoon_revenue_ledger
      SET waived_iqd = waived_iqd + v_take,
          waived_by = auth.uid(),
          status = CASE
            WHEN collected_iqd + waived_iqd + v_take >= assessed_iqd THEN 'waived'
            ELSE 'partially_waived'
          END,
          updated_at = now()
      WHERE id = v_ledger.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
  END IF;

  PERFORM public.log_admin_action(
    'adjust_account_wallet','user',p_user_id::text,
    jsonb_build_object('amount_iqd',v_delta,'note',p_note,'balance_after_iqd',v_next_balance,'transaction_id',v_tx_id)
  );

  RETURN jsonb_build_object('transaction_id',v_tx_id,'balance_iqd',v_next_balance,'duplicate',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_adjust_account_wallet(uuid,bigint,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_account_wallet(uuid,bigint,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_fee_override(
  p_user_id uuid,
  p_charge_percent numeric,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  IF p_user_id IS NULL OR p_charge_percent IS NULL OR p_charge_percent < 0 OR p_charge_percent > 100 THEN
    RAISE EXCEPTION 'invalid_user_fee_override';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'override_reason_required'; END IF;
  IF p_ends_at IS NOT NULL AND p_ends_at <= COALESCE(p_starts_at,now()) THEN RAISE EXCEPTION 'invalid_override_dates'; END IF;

  INSERT INTO public.mamnoon_user_fee_overrides(
    user_id,commission_charge_percent,starts_at,ends_at,reason,created_by
  ) VALUES (
    p_user_id,p_charge_percent,COALESCE(p_starts_at,now()),p_ends_at,left(p_reason,500),auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM public.log_admin_action(
    'set_user_fee_override','user',p_user_id::text,
    jsonb_build_object('override_id',v_id,'commission_charge_percent',p_charge_percent,'starts_at',p_starts_at,'ends_at',p_ends_at,'reason',p_reason)
  );
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_user_fee_override(uuid,numeric,timestamptz,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_fee_override(uuid,numeric,timestamptz,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_commission_policy(
  p_scope_type text,
  p_scope_key text,
  p_commission_rate_percent numeric,
  p_commission_charge_percent numeric,
  p_collection_event text,
  p_free_trial_enabled boolean,
  p_free_trial_days integer,
  p_new_users_only boolean,
  p_is_enabled boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_access(auth.uid()) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  IF p_scope_type NOT IN ('global','governorate','role','governorate_role') THEN RAISE EXCEPTION 'invalid_policy_scope'; END IF;
  IF (p_scope_type = 'global' AND p_scope_key IS NOT NULL)
     OR (p_scope_type <> 'global' AND (p_scope_key IS NULL OR length(btrim(p_scope_key))=0)) THEN
    RAISE EXCEPTION 'invalid_policy_scope_key';
  END IF;
  IF p_commission_rate_percent IS NULL OR p_commission_rate_percent NOT BETWEEN 0 AND 100
     OR p_commission_charge_percent IS NULL OR p_commission_charge_percent NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'invalid_commission_percent';
  END IF;
  IF p_collection_event NOT IN ('taxi_acceptance','service_acceptance','order_acceptance','all_acceptance') THEN RAISE EXCEPTION 'invalid_collection_event'; END IF;
  IF p_free_trial_days IS NULL OR p_free_trial_days NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'invalid_trial_days'; END IF;
  IF p_ends_at IS NOT NULL AND p_starts_at IS NOT NULL AND p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'invalid_policy_dates'; END IF;

  UPDATE public.mamnoon_commission_policies
  SET is_enabled=false, ends_at=now(), updated_at=now(), updated_by=auth.uid()
  WHERE scope_type=p_scope_type
    AND COALESCE(scope_key,'')=COALESCE(p_scope_key,'')
    AND collection_event=p_collection_event
    AND is_enabled=true;

  INSERT INTO public.mamnoon_commission_policies(
    scope_type,scope_key,commission_rate_percent,commission_charge_percent,collection_event,
    free_trial_enabled,free_trial_days,new_users_only,is_enabled,starts_at,ends_at,created_by,updated_by
  ) VALUES (
    p_scope_type,p_scope_key,p_commission_rate_percent,p_commission_charge_percent,p_collection_event,
    COALESCE(p_free_trial_enabled,false),p_free_trial_days,COALESCE(p_new_users_only,false),
    COALESCE(p_is_enabled,false),COALESCE(p_starts_at,now()),
    CASE WHEN p_is_enabled THEN p_ends_at ELSE COALESCE(p_ends_at,now()) END,
    auth.uid(),auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM public.log_admin_action(
    'save_commission_policy','commission_policy',v_id::text,
    jsonb_build_object('scope_type',p_scope_type,'scope_key',p_scope_key,'commission_rate_percent',p_commission_rate_percent,
      'commission_charge_percent',p_commission_charge_percent,'collection_event',p_collection_event,
      'free_trial_enabled',p_free_trial_enabled,'free_trial_days',p_free_trial_days,'new_users_only',p_new_users_only,'is_enabled',p_is_enabled)
  );
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_save_commission_policy(text,text,numeric,numeric,text,boolean,integer,boolean,boolean,timestamptz,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_commission_policy(text,text,numeric,numeric,text,boolean,integer,boolean,boolean,timestamptz,timestamptz)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.charge_mamnoon_partner_order_commission(
  p_order_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order public.partner_customer_orders%ROWTYPE;
  v_partner public.partner_business_profiles%ROWTYPE;
  v_role text;
  v_governorate text;
  v_rate numeric(7,4) := 0;
  v_charge_percent numeric(7,4) := 100;
  v_override numeric(7,4);
  v_override_found boolean := false;
  v_policy public.mamnoon_commission_policies%ROWTYPE;
  v_commission bigint := 0;
  v_collected bigint := 0;
  v_balance bigint := 0;
  v_next_balance bigint := 0;
  v_key text;
BEGIN
  SELECT * INTO v_order FROM public.partner_customer_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'partner_order_not_found'; END IF;
  SELECT * INTO v_partner FROM public.partner_business_profiles WHERE id=v_order.business_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'partner_profile_not_found'; END IF;

  v_role := CASE
    WHEN lower(COALESCE(v_partner.partner_type,v_partner.business_vertical,'')) LIKE '%restaurant%'
      OR lower(COALESCE(v_partner.partner_type,v_partner.business_vertical,'')) LIKE '%food%' THEN 'restaurant'
    WHEN lower(COALESCE(v_partner.partner_type,v_partner.business_vertical,'')) LIKE '%hotel%'
      OR lower(COALESCE(v_partner.partner_type,v_partner.business_vertical,'')) LIKE '%hospitality%' THEN 'hotel'
    ELSE 'store'
  END;
  v_governorate := COALESCE(v_partner.governorate_key,
    (SELECT governorate_key FROM public.profiles WHERE id=v_partner.user_id));

  SELECT * INTO v_policy
  FROM public.mamnoon_commission_policies p
  WHERE p.is_enabled=true AND p.collection_event IN ('order_acceptance','all_acceptance')
    AND (p.starts_at IS NULL OR p.starts_at<=now())
    AND (p.ends_at IS NULL OR p.ends_at>now())
    AND (
      (p.scope_type='governorate_role' AND p.scope_key=COALESCE(v_governorate,'')||':'||v_role)
      OR (p.scope_type='governorate' AND p.scope_key=v_governorate)
      OR (p.scope_type='role' AND p.scope_key=v_role)
      OR (p.scope_type='global' AND p.scope_key IS NULL)
    )
  ORDER BY CASE p.scope_type WHEN 'governorate_role' THEN 1 WHEN 'governorate' THEN 2 WHEN 'role' THEN 3 ELSE 4 END,
    CASE WHEN p.collection_event='order_acceptance' THEN 0 ELSE 1 END
  LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_rate := v_policy.commission_rate_percent;
  v_charge_percent := v_policy.commission_charge_percent;
  SELECT commission_charge_percent INTO v_override
  FROM public.mamnoon_user_fee_overrides
  WHERE user_id=v_partner.user_id AND revoked_at IS NULL
    AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())
  ORDER BY starts_at DESC,created_at DESC LIMIT 1;
  v_override_found := FOUND;
  IF v_override_found THEN v_charge_percent := v_override; END IF;

  IF NOT v_override_found AND EXISTS (
    SELECT 1 FROM public.mamnoon_user_trial_entitlements
    WHERE user_id=v_partner.user_id AND account_role=v_role
      AND starts_at<=now() AND ends_at>now()
      AND (governorate_key IS NULL OR governorate_key=v_governorate)
  ) THEN v_charge_percent := 0; END IF;

  v_commission := round(COALESCE(v_order.partner_total,0)::numeric*v_rate/100*v_charge_percent/100)::bigint;
  IF v_commission<=0 THEN RETURN 0; END IF;
  v_key := 'mamnoon-order-commission:'||p_order_id::text||':'||v_partner.user_id::text;

  IF EXISTS (SELECT 1 FROM public.account_wallet_transactions WHERE idempotency_key=v_key) THEN
    RETURN abs((SELECT amount_iqd FROM public.account_wallet_transactions WHERE idempotency_key=v_key));
  END IF;

  INSERT INTO public.account_wallets(user_id) VALUES(v_partner.user_id) ON CONFLICT(user_id) DO NOTHING;
  SELECT balance_iqd INTO v_balance FROM public.account_wallets WHERE user_id=v_partner.user_id FOR UPDATE;
  v_collected := LEAST(v_commission,GREATEST(v_balance,0));
  v_next_balance := v_balance-v_commission;
  IF v_next_balance < -5000 THEN RAISE EXCEPTION 'wallet_debt_limit_exceeded'; END IF;

  INSERT INTO public.account_wallet_transactions(
    user_id,transaction_type,amount_iqd,balance_after_iqd,provider,provider_reference,idempotency_key,description,metadata
  ) VALUES(
    v_partner.user_id,'deduction',-v_commission,v_next_balance,'mamnoon',p_order_id::text,v_key,
    'عمولة ممنون عند قبول طلب الشريك',
    jsonb_build_object('order_id',p_order_id,'business_profile_id',v_partner.id,'commission_rate_percent',v_rate,'commission_charge_percent',v_charge_percent)
  );
  UPDATE public.account_wallets SET balance_iqd=v_next_balance,updated_at=now() WHERE user_id=v_partner.user_id;
  INSERT INTO public.mamnoon_revenue_ledger(
    user_id,revenue_type,assessed_iqd,collected_iqd,status,idempotency_key,metadata
  ) VALUES(
    v_partner.user_id,'order_commission',v_commission,v_collected,
    CASE WHEN v_collected>=v_commission THEN 'collected' WHEN v_collected>0 THEN 'partially_collected' ELSE 'accrued' END,v_key,
    jsonb_build_object('order_id',p_order_id,'base_amount_iqd',v_order.partner_total,'commission_rate_percent',v_rate,'commission_charge_percent',v_charge_percent)
  ) ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN v_commission;
END;
$function$;
REVOKE ALL ON FUNCTION public.charge_mamnoon_partner_order_commission(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.charge_commission_on_partner_order_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.status='pending' AND NEW.status='accepted' THEN
    PERFORM public.charge_mamnoon_partner_order_commission(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS charge_commission_on_partner_order_acceptance ON public.partner_customer_orders;
CREATE TRIGGER charge_commission_on_partner_order_acceptance
BEFORE UPDATE OF status ON public.partner_customer_orders
FOR EACH ROW EXECUTE FUNCTION public.charge_commission_on_partner_order_acceptance();
REVOKE ALL ON FUNCTION public.charge_commission_on_partner_order_acceptance() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trigger_mamnoon_signup_trial_from_partner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role text;
BEGIN
  v_role := CASE
    WHEN lower(COALESCE(NEW.partner_type,NEW.business_vertical,'')) LIKE '%restaurant%'
      OR lower(COALESCE(NEW.partner_type,NEW.business_vertical,'')) LIKE '%food%' THEN 'restaurant'
    WHEN lower(COALESCE(NEW.partner_type,NEW.business_vertical,'')) LIKE '%hotel%'
      OR lower(COALESCE(NEW.partner_type,NEW.business_vertical,'')) LIKE '%hospitality%' THEN 'hotel'
    ELSE 'store'
  END;
  PERFORM public.grant_mamnoon_signup_trial_for_role(NEW.user_id,v_role);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mamnoon_signup_trial_after_partner_profile ON public.partner_business_profiles;
CREATE TRIGGER mamnoon_signup_trial_after_partner_profile
AFTER INSERT OR UPDATE OF partner_type,business_vertical,governorate_key
ON public.partner_business_profiles
FOR EACH ROW EXECUTE FUNCTION public.trigger_mamnoon_signup_trial_from_partner();
REVOKE ALL ON FUNCTION public.trigger_mamnoon_signup_trial_from_partner() FROM PUBLIC, anon, authenticated;

-- Backfill existing conversations so the new inbox classifies old threads correctly.
WITH latest_messages AS (
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id, m.sender_id, m.is_ai, m.created_at
  FROM public.support_messages m
  ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
)
UPDATE public.support_conversations c
SET last_message_at = lm.created_at,
    last_message_source = CASE
      WHEN lm.is_ai THEN 'bot'
      WHEN lm.sender_id = c.user_id THEN 'user'
      ELSE 'admin'
    END,
    needs_admin_reply = (c.ai_status = 'waiting_human'),
    handoff_status = CASE
      WHEN c.ai_status = 'waiting_human' THEN 'waiting_for_admin'
      WHEN c.ticket_status = 'resolved' THEN 'resolved'
      WHEN lm.is_ai THEN 'bot'
      ELSE 'assigned'
    END
FROM latest_messages lm
WHERE lm.conversation_id = c.id;

CREATE OR REPLACE FUNCTION public.admin_revoke_user_fee_override(p_override_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  UPDATE public.mamnoon_user_fee_overrides
  SET revoked_at=now(), revoked_by=auth.uid()
  WHERE id=p_override_id AND revoked_at IS NULL
  RETURNING user_id INTO v_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.log_admin_action(
    'revoke_user_fee_override','user',v_user_id::text,
    jsonb_build_object('override_id',p_override_id)
  );
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_revoke_user_fee_override(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_fee_override(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_support_handoff_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.support_conversations
  SET needs_admin_reply = (
        NEW.ai_status = 'waiting_human'
        AND NEW.ticket_status <> 'resolved'
        AND NEW.handoff_status <> 'assigned'
      ),
      handoff_status = CASE
        WHEN NEW.ticket_status = 'resolved' THEN 'resolved'
        WHEN NEW.ai_status = 'waiting_human' AND NEW.handoff_status = 'assigned' THEN 'assigned'
        WHEN NEW.ai_status = 'waiting_human' THEN 'waiting_for_admin'
        ELSE 'bot'
      END
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_support_handoff_status ON public.support_conversations;
CREATE TRIGGER sync_support_handoff_status
AFTER UPDATE OF ai_status, ticket_status ON public.support_conversations
FOR EACH ROW
WHEN (OLD.ai_status IS DISTINCT FROM NEW.ai_status OR OLD.ticket_status IS DISTINCT FROM NEW.ticket_status)
EXECUTE FUNCTION public.sync_support_handoff_status();
REVOKE ALL ON FUNCTION public.sync_support_handoff_status() FROM PUBLIC, anon, authenticated;

-- Stop the legacy subscription expiry/notification job. Historical subscription
-- rows remain available for reporting and are not deleted.
DO $retire_subscriptions$
DECLARE
  v_job record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    FOR v_job IN
      SELECT jobid FROM cron.job
      WHERE jobname ILIKE '%subscription%'
         OR command ILIKE '%handle_expired_subscriptions%'
    LOOP
      PERFORM cron.unschedule(v_job.jobid);
    END LOOP;
  END IF;
END;
$retire_subscriptions$;

CREATE OR REPLACE FUNCTION public.admin_get_revenue_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_summary jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  SELECT jsonb_build_object(
    'assessed_iqd',COALESCE(SUM(assessed_iqd),0),
    'collected_iqd',COALESCE(SUM(collected_iqd),0),
    'waived_iqd',COALESCE(SUM(waived_iqd),0),
    'outstanding_iqd',COALESCE(SUM(assessed_iqd-collected_iqd-waived_iqd),0),
    'entry_count',COUNT(*)
  ) INTO v_summary
  FROM public.mamnoon_revenue_ledger
  WHERE status <> 'void';

  RETURN v_summary || jsonb_build_object(
    'zaincash_debt_collected_iqd',
    (SELECT COALESCE(SUM(amount_iqd),0) FROM public.mamnoon_revenue_collections)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_get_revenue_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_revenue_summary() TO authenticated;

-- Internal assignment trigger used a separate subscription checker. Override it
-- too so legacy subscription rows can no longer block taxi/worker assignments.
CREATE OR REPLACE FUNCTION public.mamnoon_provider_subscription_active_internal(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN p_user_id IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.mamnoon_provider_subscription_active_internal(uuid) FROM PUBLIC, anon, authenticated;

-- Retire legacy subscription RPCs without deleting historical subscription data.
CREATE OR REPLACE FUNCTION public.get_user_subscription(_user_id uuid)
RETURNS TABLE(
  plan_code text, plan_name_ar text, tier integer, max_requests_per_month integer,
  priority_weight integer, offer_priority integer, badge_label text, badge_color text,
  show_stats boolean, priority_support boolean, status text,
  current_period_end timestamptz, request_count integer, auto_renew boolean,
  subscription_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 'commission'::text, 'حسب نظام عمولات ممنون'::text, 0, 2147483647,
    0, 0, NULL::text, NULL::text, true, false, 'active'::text,
    NULL::timestamptz, 0, false, false;
$function$;

CREATE OR REPLACE FUNCTION public.has_subscription_admin_access(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT false;
$function$;

CREATE OR REPLACE FUNCTION public.admin_grant_subscription(p_user_id uuid,p_plan_code text,p_duration text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RAISE EXCEPTION 'subscriptions_retired';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_grant_subscriptions_bulk(p_user_ids uuid[],p_plan_code text,p_duration text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RAISE EXCEPTION 'subscriptions_retired';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_extend_subscription(p_user_id uuid,p_days integer)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RAISE EXCEPTION 'subscriptions_retired';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_free_subscription(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT false;
$function$;

CREATE OR REPLACE FUNCTION public.admin_pause_all_subscriptions()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 0;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_subscription_status(p_user_id uuid,p_status text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT false;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_own_subscription_at_period_end()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT false;
$function$;

CREATE OR REPLACE FUNCTION public.pause_own_subscription()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT false;
$function$;

CREATE OR REPLACE FUNCTION public.restore_own_subscription_continuation()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT false;
$function$;

CREATE OR REPLACE FUNCTION public.resume_own_subscription()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT false;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_qicard_subscription_payment(
  p_merchant_request_id uuid,p_gateway_payment_id text,p_confirmed_amount integer,
  p_currency text,p_gateway_status text,p_gateway_payload jsonb
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT false;
$function$;

CREATE OR REPLACE FUNCTION public.handle_expired_subscriptions()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 0;
$function$;

CREATE OR REPLACE FUNCTION public.get_subscription_stats()
RETURNS TABLE(total_subscribers bigint,active_subscriptions bigint,expired_subscriptions bigint,monthly_revenue bigint,yearly_revenue bigint,free_count bigint,silver_count bigint,gold_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint;
$function$;

CREATE OR REPLACE FUNCTION public.get_subscription_stats_v2()
RETURNS TABLE(total_subscribers bigint,active_subscriptions bigint,expired_subscriptions bigint,monthly_revenue bigint,yearly_revenue bigint,free_count bigint,bronze_count bigint,silver_count bigint,gold_count bigint,trial_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint;
$function$;

CREATE OR REPLACE FUNCTION public.guard_trial_subscription_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RAISE EXCEPTION 'subscriptions_retired';
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_support_priority_after_subscription_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_grant_subscription(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_grant_subscriptions_bulk(uuid[],text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_extend_subscription(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_cancel_free_subscription(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_pause_all_subscriptions() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_set_subscription_status(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_own_subscription_at_period_end() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pause_own_subscription() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.restore_own_subscription_continuation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.resume_own_subscription() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finalize_qicard_subscription_payment(uuid,text,integer,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.handle_expired_subscriptions() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_grant_subscription(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.user_subscriptions FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.reject_retired_subscription_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.purpose::text = 'subscription' THEN
    RAISE EXCEPTION 'subscriptions_retired';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reject_retired_subscription_payment ON public.payment_transactions;
CREATE TRIGGER reject_retired_subscription_payment
BEFORE INSERT ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.reject_retired_subscription_payment();
REVOKE ALL ON FUNCTION public.reject_retired_subscription_payment() FROM PUBLIC,anon,authenticated;


-- Final retirement sweep: remove residual subscription-only gates and ranking.
-- Existing subscription rows are retained as inert historical records.
DROP TRIGGER IF EXISTS mamnoon_provider_trial_on_role_insert ON public.user_roles;

CREATE OR REPLACE FUNCTION public.refresh_support_conversation_priority(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  UPDATE public.support_conversations
  SET priority_tier = 0
  WHERE user_id = p_user_id AND status = 'open';
$function$;

CREATE OR REPLACE FUNCTION public.set_new_support_conversation_priority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.priority_tier := 0;
  RETURN NEW;
END;
$function$;

-- Provider radius is now a normal provider setting, not a paid subscription perk.
CREATE OR REPLACE FUNCTION public.set_provider_service_radius(p_radius_km integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_changed integer := 0;
  v_rows integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_radius_km IS NULL OR p_radius_km < 1 OR p_radius_km > 55 THEN
    RAISE EXCEPTION 'invalid_radius';
  END IF;
  IF public.has_role(v_uid,'worker') THEN
    UPDATE public.worker_profiles
    SET service_radius_km=p_radius_km,updated_at=now()
    WHERE user_id=v_uid;
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    v_changed:=v_changed+v_rows;
  END IF;
  IF public.has_role(v_uid,'large_driver') THEN
    UPDATE public.driver_profiles
    SET service_radius_km=p_radius_km,updated_at=now()
    WHERE user_id=v_uid;
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    v_changed:=v_changed+v_rows;
  END IF;
  IF v_changed=0 THEN RAISE EXCEPTION 'provider_profile_not_found'; END IF;
  RETURN p_radius_km;
END;
$function$;

-- The old monthly subscription request counter has no role in commission billing.
CREATE OR REPLACE FUNCTION public.increment_request_count(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN;
END;
$function$;

-- Remove subscription-plan ranking and tier-based radius limits from dispatch.
DO $retire_dispatch_subscription_tiers$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.find_nearby_drivers(numeric,numeric,text,numeric,integer)'::regprocedure);
  v_def := replace(v_def, 'coalesce(sp.priority_weight, 0) as subscription_priority', '0::integer as subscription_priority');
  v_def := replace(v_def, $old$
    left join public.user_subscriptions us on us.user_id = dp.user_id
      and us.status = 'active'
      and (us.current_period_end is null or us.current_period_end > now())
    left join public.subscription_plans sp on sp.id = us.plan_id
$old$, '');
  v_def := replace(v_def, $old$
          case coalesce(sp2.code, 'bronze')
            when 'gold' then 55 when 'silver' then 40 else 25
          end)
        from public.driver_profiles dp
        left join public.user_subscriptions us2 on us2.user_id = dp.user_id
          and us2.status = 'active'
          and (us2.current_period_end is null or us2.current_period_end > now())
        left join public.subscription_plans sp2 on sp2.id = us2.plan_id
$old$, $new$
          55)
        from public.driver_profiles dp
$old$);
  IF position('user_subscriptions' in v_def)>0 OR position('subscription_plans' in v_def)>0 THEN
    RAISE EXCEPTION 'find_nearby_drivers_subscription_retirement_patch_failed';
  END IF;
  EXECUTE v_def;

  v_def := pg_get_functiondef('public.advance_service_dispatch(uuid)'::regprocedure);
  v_def := replace(v_def, $old$
      COALESCE(sp.priority_weight, 0) AS subscription_priority,
      LEAST(COALESCE(wp.service_radius_km, 25),
        CASE COALESCE(sp.code, 'bronze')
          WHEN 'gold' THEN 55 WHEN 'silver' THEN 40 ELSE 25
        END
      ) AS effective_radius_km
$old$, $new$
      0::integer AS subscription_priority,
      LEAST(COALESCE(wp.service_radius_km, 25), 55) AS effective_radius_km
$new$);
  v_def := replace(v_def, $old$
    LEFT JOIN public.user_subscriptions us
      ON us.user_id = wp.user_id AND us.status = 'active'
      AND (us.current_period_end IS NULL OR us.current_period_end > now())
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
$old$, '');
  IF position('user_subscriptions' in v_def)>0 OR position('subscription_plans' in v_def)>0 THEN
    RAISE EXCEPTION 'advance_service_dispatch_subscription_retirement_patch_failed';
  END IF;
  EXECUTE v_def;
END;
$retire_dispatch_subscription_tiers$;

-- Demand-zone insights are available to every approved taxi driver, not only Gold.
DO $retire_gold_demand_gate$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.get_taxi_high_demand_areas(text)'::regprocedure);
  v_def := replace(v_def,
    'IF NOT EXISTS(SELECT 1 FROM public.user_subscriptions us JOIN public.subscription_plans sp ON sp.id=us.plan_id WHERE us.user_id=v_uid AND us.status=''active'' AND (us.current_period_end IS NULL OR us.current_period_end>now()) AND sp.code = ''gold'') THEN RAISE EXCEPTION ''gold_required''; END IF;',
    '');
  IF position('gold_required' in v_def)>0 THEN
    RAISE EXCEPTION 'high_demand_subscription_gate_retirement_failed';
  END IF;
  EXECUTE v_def;
END;
$retire_gold_demand_gate$;
