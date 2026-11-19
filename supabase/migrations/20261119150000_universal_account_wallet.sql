-- Universal cash wallet for every authenticated Mamnoon account.
-- This ledger is intentionally separate from driver/provider earnings tables.
CREATE TABLE IF NOT EXISTS public.account_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_iqd bigint NOT NULL DEFAULT 0 CHECK (balance_iqd >= 0),
  currency text NOT NULL DEFAULT 'IQD' CHECK (currency = 'IQD'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.account_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN (
    'topup','zaincash_topup','payment','deduction','refund','cashout','adjustment'
  )),
  amount_iqd bigint NOT NULL CHECK (amount_iqd <> 0),
  balance_after_iqd bigint NOT NULL CHECK (balance_after_iqd >= 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','failed','reversed')),
  provider text,
  provider_reference text,
  idempotency_key text NOT NULL UNIQUE,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_wallet_amount_direction CHECK (
    (transaction_type IN ('topup','zaincash_topup','refund') AND amount_iqd > 0)
    OR (transaction_type IN ('payment','deduction','cashout') AND amount_iqd < 0)
    OR transaction_type = 'adjustment'
  )
);

CREATE INDEX IF NOT EXISTS account_wallet_transactions_user_created_idx
  ON public.account_wallet_transactions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS account_wallet_transactions_provider_ref_uidx
  ON public.account_wallet_transactions(provider, provider_reference)
  WHERE provider IS NOT NULL AND provider_reference IS NOT NULL;

ALTER TABLE public.account_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own account wallet" ON public.account_wallets;
CREATE POLICY "Users read own account wallet" ON public.account_wallets
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users read own account wallet transactions" ON public.account_wallet_transactions;
CREATE POLICY "Users read own account wallet transactions" ON public.account_wallet_transactions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.account_wallets, public.account_wallet_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_wallets, public.account_wallet_transactions TO authenticated;
GRANT ALL ON public.account_wallets, public.account_wallet_transactions TO service_role;

-- Provision one wallet for every existing account and automatically for new signups.
INSERT INTO public.account_wallets(user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_account_wallet_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.account_wallets(user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_account_wallet_for_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS create_account_wallet_after_signup ON auth.users;
CREATE TRIGGER create_account_wallet_after_signup
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.create_account_wallet_for_new_user();

-- Client-safe read RPC. The authenticated user can only read their own wallet.
CREATE OR REPLACE FUNCTION public.get_my_account_wallet()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_wallet public.account_wallets%ROWTYPE;
  v_transactions jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  INSERT INTO public.account_wallets(user_id)
  VALUES (v_user)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet
  FROM public.account_wallets
  WHERE user_id = v_user;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'type', t.transaction_type,
      'amount_iqd', t.amount_iqd,
      'balance_after_iqd', t.balance_after_iqd,
      'status', t.status,
      'provider', t.provider,
      'description', t.description,
      'created_at', t.created_at
    ) ORDER BY t.created_at DESC
  ), '[]'::jsonb)
  INTO v_transactions
  FROM (
    SELECT * FROM public.account_wallet_transactions
    WHERE user_id = v_user
    ORDER BY created_at DESC
    LIMIT 50
  ) t;

  RETURN jsonb_build_object(
    'wallet', jsonb_build_object(
      'user_id', v_wallet.user_id,
      'balance_iqd', v_wallet.balance_iqd,
      'currency', v_wallet.currency,
      'updated_at', v_wallet.updated_at
    ),
    'transactions', v_transactions
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_account_wallet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_account_wallet() TO authenticated;

-- Server-only atomic posting. The signed amount is authoritative; clients cannot call this.
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
    RETURN jsonb_build_object(
      'transaction_id', v_existing.id,
      'balance_iqd', v_existing.balance_after_iqd,
      'duplicate', true
    );
  END IF;

  v_next_balance := v_balance + p_amount_iqd;
  IF v_next_balance < 0 THEN RAISE EXCEPTION 'insufficient_wallet_balance'; END IF;

  INSERT INTO public.account_wallet_transactions(
    user_id, transaction_type, amount_iqd, balance_after_iqd,
    provider, provider_reference, idempotency_key, description, metadata
  )
  VALUES (
    p_user_id, p_transaction_type, p_amount_iqd, v_next_balance,
    p_provider, p_provider_reference, p_idempotency_key,
    left(p_description, 500), p_metadata
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
    IF NOT FOUND
       OR v_existing.user_id <> p_user_id
       OR v_existing.transaction_type <> p_transaction_type
       OR v_existing.amount_iqd <> p_amount_iqd
       OR v_existing.idempotency_key <> p_idempotency_key THEN
      RAISE EXCEPTION 'wallet_idempotency_or_provider_reference_conflict';
    END IF;
    RETURN jsonb_build_object(
      'transaction_id', v_existing.id,
      'balance_iqd', v_existing.balance_after_iqd,
      'duplicate', true
    );
  END IF;

  UPDATE public.account_wallets
  SET balance_iqd = v_next_balance, updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'balance_iqd', v_next_balance,
    'duplicate', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_account_wallet_transaction(uuid,text,bigint,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_account_wallet_transaction(uuid,text,bigint,text,text,text,text,jsonb)
  TO service_role;

-- Enable row-level change feeds when the standard Supabase publication is present.
DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'account_wallets'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.account_wallets;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'account_wallet_transactions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.account_wallet_transactions;
    END IF;
  END IF;
END;
$publication$;
