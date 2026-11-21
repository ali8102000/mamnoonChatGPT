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
        WHEN NEW.is_ai THEN false
        WHEN NEW.sender_id = v_user_id THEN (v_ai_status = 'waiting_human')
        ELSE false
      END,
      handoff_status = CASE
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
        AND status IN ('accrued','partially_collected')
        AND assessed_iqd > collected_iqd
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_due := v_revenue.assessed_iqd - v_revenue.collected_iqd;
      v_take := LEAST(v_remaining, v_due);
      UPDATE public.mamnoon_revenue_ledger
      SET collected_iqd = collected_iqd + v_take,
          status = CASE
            WHEN collected_iqd + v_take >= assessed_iqd THEN 'collected'
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
  v_commission bigint := 0;
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
  ORDER BY CASE role::text WHEN 'driver' THEN 1 WHEN 'large_driver' THEN 2 ELSE 3 END
  LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'commission_provider_role_required'; END IF;

  SELECT governorate_key INTO v_governorate FROM public.profiles WHERE id = p_user_id;
  v_event := CASE WHEN v_request.type::text = 'taxi' THEN 'taxi_acceptance' ELSE 'service_acceptance' END;
  v_revenue_type := CASE WHEN v_request.type::text = 'taxi' THEN 'taxi_commission' ELSE 'service_commission' END;
  v_base := COALESCE(p_base_amount_iqd, v_request.customer_payable::bigint,
                     v_request.customer_price::bigint, v_request.price_estimate::bigint, 0);
  IF v_base <= 0 THEN RETURN 0; END IF;

  SELECT * INTO v_policy
  FROM public.mamnoon_commission_policies p
  WHERE p.is_enabled = true
    AND p.collection_event = v_event
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
  END
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
  IF FOUND THEN v_charge_percent := v_override; END IF;

  IF EXISTS (
    SELECT 1 FROM public.mamnoon_user_trial_entitlements t
    WHERE t.user_id = p_user_id AND t.account_role = v_role
      AND t.starts_at <= now() AND t.ends_at > now()
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
    p_user_id, p_request_id, v_revenue_type, v_commission, 0, 'accrued', v_key,
    jsonb_build_object('base_amount_iqd',v_base,'commission_rate_percent',v_rate,'commission_charge_percent',v_charge_percent,'wallet_balance_after_iqd',v_next_balance)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_commission;
END;
$function$;

REVOKE ALL ON FUNCTION public.charge_mamnoon_commission_on_accept(uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated;
