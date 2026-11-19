-- Keep the user-facing wallet read RPC under the caller's RLS context.
-- Wallet creation is handled by the auth.users trigger and the backfill migration.
CREATE OR REPLACE FUNCTION public.get_my_account_wallet()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_wallet public.account_wallets%ROWTYPE;
  v_transactions jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO v_wallet
  FROM public.account_wallets
  WHERE user_id = v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_not_provisioned';
  END IF;

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
