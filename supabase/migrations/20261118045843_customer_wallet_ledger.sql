-- Dedicated customer wallet ledger. Provider earnings remain in driver_wallets.
CREATE TABLE IF NOT EXISTS public.customer_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance numeric(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency text NOT NULL DEFAULT 'IQD' CHECK (currency = 'IQD'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('deposit','withdrawal','payment','refund','adjustment')),
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  CONSTRAINT customer_wallet_transaction_amount_direction CHECK (
    (transaction_type IN ('deposit','refund') AND amount > 0)
    OR (transaction_type IN ('withdrawal','payment') AND amount < 0)
    OR transaction_type = 'adjustment'
  ),
  balance_after numeric(14,2) NOT NULL CHECK (balance_after >= 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','failed','reversed')),
  provider text,
  provider_reference text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_wallet_transactions_user_created_idx
  ON public.customer_wallet_transactions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS customer_wallet_transactions_provider_ref_uidx
  ON public.customer_wallet_transactions(provider, provider_reference)
  WHERE provider IS NOT NULL AND provider_reference IS NOT NULL;

ALTER TABLE public.customer_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers read own wallet" ON public.customer_wallets;
CREATE POLICY "Customers read own wallet" ON public.customer_wallets
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Customers read own wallet transactions" ON public.customer_wallet_transactions;
CREATE POLICY "Customers read own wallet transactions" ON public.customer_wallet_transactions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.customer_wallets, public.customer_wallet_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customer_wallets, public.customer_wallet_transactions TO authenticated;
GRANT ALL ON public.customer_wallets, public.customer_wallet_transactions TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_customer_wallet()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_wallet public.customer_wallets%ROWTYPE;
  v_transactions jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user AND role = 'customer'::public.app_role
  ) THEN
    RAISE EXCEPTION 'customer_role_required';
  END IF;

  INSERT INTO public.customer_wallets(user_id)
  VALUES (v_user)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet
  FROM public.customer_wallets
  WHERE user_id = v_user;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'type', t.transaction_type,
        'amount', t.amount,
        'balance_after', t.balance_after,
        'status', t.status,
        'note', t.description,
        'created_at', t.created_at
      ) ORDER BY t.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_transactions
  FROM (
    SELECT * FROM public.customer_wallet_transactions
    WHERE user_id = v_user
    ORDER BY created_at DESC
    LIMIT 30
  ) t;

  RETURN jsonb_build_object(
    'wallet', jsonb_build_object(
      'user_id', v_wallet.user_id,
      'balance', v_wallet.balance,
      'currency', v_wallet.currency,
      'updated_at', v_wallet.updated_at
    ),
    'transactions', v_transactions
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_customer_wallet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_customer_wallet() TO authenticated;
