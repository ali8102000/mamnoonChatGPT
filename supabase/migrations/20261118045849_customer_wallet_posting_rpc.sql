-- Atomic, idempotent posting for the customer wallet ledger.
-- Only trusted server-side service_role code may call this function.
CREATE OR REPLACE FUNCTION public.apply_customer_wallet_transaction(
  _user_id uuid,
  _transaction_type text,
  _amount numeric,
  _provider text DEFAULT NULL,
  _provider_reference text DEFAULT NULL,
  _description text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_balance numeric(14,2);
  v_next_balance numeric(14,2);
  v_transaction_id uuid;
  v_existing public.customer_wallet_transactions%ROWTYPE;
  v_amount numeric(14,2);
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'wallet_user_required'; END IF;
  IF _transaction_type NOT IN ('deposit','withdrawal','payment','refund','adjustment') THEN
    RAISE EXCEPTION 'invalid_wallet_transaction_type';
  END IF;
  IF _amount IS NULL OR _amount = 0 OR _amount <> round(_amount, 0) THEN
    RAISE EXCEPTION 'wallet_amount_must_be_nonzero_whole_iqd';
  END IF;
  IF _transaction_type IN ('deposit','refund') AND _amount < 0 THEN
    RAISE EXCEPTION 'wallet_credit_must_be_positive';
  END IF;
  IF _transaction_type IN ('withdrawal','payment') AND _amount > 0 THEN
    RAISE EXCEPTION 'wallet_debit_must_be_negative';
  END IF;
  IF _metadata IS NULL OR jsonb_typeof(_metadata) <> 'object' THEN
    RAISE EXCEPTION 'wallet_metadata_must_be_object';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'customer'::public.app_role
  ) THEN
    RAISE EXCEPTION 'customer_role_required';
  END IF;

  v_amount := _amount::numeric(14,2);

  INSERT INTO public.customer_wallets(user_id)
  VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO v_balance
  FROM public.customer_wallets
  WHERE user_id = _user_id
  FOR UPDATE;

  IF _provider IS NOT NULL AND _provider_reference IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.customer_wallet_transactions
    WHERE provider = _provider AND provider_reference = _provider_reference;

    IF FOUND THEN
      IF v_existing.user_id <> _user_id
         OR v_existing.transaction_type <> _transaction_type
         OR v_existing.amount <> v_amount THEN
        RAISE EXCEPTION 'wallet_provider_reference_conflict';
      END IF;
      RETURN jsonb_build_object(
        'transaction_id', v_existing.id,
        'balance', v_existing.balance_after,
        'duplicate', true
      );
    END IF;
  END IF;

  v_next_balance := v_balance + v_amount;
  IF v_next_balance < 0 THEN
    RAISE EXCEPTION 'insufficient_wallet_balance';
  END IF;

  INSERT INTO public.customer_wallet_transactions(
    user_id, transaction_type, amount, balance_after, status,
    provider, provider_reference, description, metadata
  )
  VALUES (
    _user_id, _transaction_type, v_amount, v_next_balance, 'completed',
    _provider, _provider_reference, left(_description, 500), _metadata
  )
  ON CONFLICT (provider, provider_reference)
    WHERE provider IS NOT NULL AND provider_reference IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.customer_wallet_transactions
    WHERE provider = _provider AND provider_reference = _provider_reference;

    IF NOT FOUND
       OR v_existing.user_id <> _user_id
       OR v_existing.transaction_type <> _transaction_type
       OR v_existing.amount <> v_amount THEN
      RAISE EXCEPTION 'wallet_provider_reference_conflict';
    END IF;

    RETURN jsonb_build_object(
      'transaction_id', v_existing.id,
      'balance', v_existing.balance_after,
      'duplicate', true
    );
  END IF;

  UPDATE public.customer_wallets
  SET balance = v_next_balance, updated_at = now()
  WHERE user_id = _user_id;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'balance', v_next_balance,
    'duplicate', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_customer_wallet_transaction(uuid,text,numeric,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_customer_wallet_transaction(uuid,text,numeric,text,text,text,jsonb)
  TO service_role;
