-- Cash change refund: return overpaid cash to the customer's Mamnoon wallet.
-- The provider funds the credit through their own account wallet in the same transaction.

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS cash_received_iqd bigint,
  ADD COLUMN IF NOT EXISTS cash_change_iqd bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_settled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cash_settled_at timestamptz;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.service_requests'::regclass
      AND conname = 'service_requests_cash_received_nonnegative'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_cash_received_nonnegative
      CHECK (cash_received_iqd IS NULL OR cash_received_iqd >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.service_requests'::regclass
      AND conname = 'service_requests_cash_change_nonnegative'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_cash_change_nonnegative
      CHECK (cash_change_iqd >= 0);
  END IF;
END;
$constraints$;

COMMENT ON COLUMN public.service_requests.cash_received_iqd IS
  'Cash amount physically received by the assigned provider at completion, in IQD.';
COMMENT ON COLUMN public.service_requests.cash_change_iqd IS
  'Cash overpayment returned as customer wallet credit, in IQD.';
COMMENT ON COLUMN public.service_requests.cash_settled_by IS
  'Provider account that confirmed cash received and funded any customer change credit.';
COMMENT ON COLUMN public.service_requests.cash_settled_at IS
  'Timestamp of the one-time cash/change settlement at request completion.';

CREATE OR REPLACE FUNCTION public.complete_service_request_with_cash(
  _request_id uuid,
  _cash_received_iqd bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v public.service_requests%ROWTYPE;
  v_actor uuid := auth.uid();
  v_is_service_member boolean := false;
  v_fare_iqd bigint;
  v_cash_iqd bigint;
  v_change_iqd bigint;
  v_customer_balance bigint;
  v_provider_balance bigint;
  v_customer_next bigint;
  v_provider_next bigint;
  v_customer_tx uuid;
  v_provider_tx uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _request_id IS NULL THEN RAISE EXCEPTION 'request_id_required'; END IF;
  IF _cash_received_iqd IS NULL OR _cash_received_iqd < 0 OR _cash_received_iqd > 100000000 THEN
    RAISE EXCEPTION 'invalid_cash_received_amount';
  END IF;

  SELECT * INTO v
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;

  v_is_service_member := v.type::text = 'service'
    AND public.is_service_request_provider(_request_id, v_actor);

  IF v.provider_id IS DISTINCT FROM v_actor AND NOT v_is_service_member THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- A retry by the same provider with the same amount is safe and never posts twice.
  IF v.status::text = 'completed' THEN
    IF v.cash_settled_at IS NOT NULL
       AND v.cash_settled_by = v_actor
       AND v.cash_received_iqd = _cash_received_iqd THEN
      RETURN jsonb_build_object(
        'request_id', v.id,
        'fare_iqd', COALESCE(v.customer_payable, v.customer_price, v.price_estimate, 0)::bigint,
        'cash_received_iqd', v.cash_received_iqd,
        'change_iqd', v.cash_change_iqd,
        'duplicate', true
      );
    END IF;
    RAISE EXCEPTION 'request_already_completed';
  END IF;

  IF v.status::text <> 'in_progress' THEN
    RAISE EXCEPTION 'request_not_in_progress';
  END IF;

  v_fare_iqd := COALESCE(
    round(v.customer_payable),
    round(v.customer_price),
    round(v.price_estimate)
  )::bigint;
  IF v_fare_iqd IS NULL OR v_fare_iqd < 0 THEN
    RAISE EXCEPTION 'request_final_fare_unavailable';
  END IF;

  IF v.payment_method = 'zaincash' THEN
    IF _cash_received_iqd <> 0 THEN
      RAISE EXCEPTION 'cash_not_expected_for_electronic_payment';
    END IF;
    v_cash_iqd := 0;
    v_change_iqd := 0;
  ELSE
    IF _cash_received_iqd < v_fare_iqd THEN
      RAISE EXCEPTION 'cash_received_less_than_fare';
    END IF;
    v_cash_iqd := _cash_received_iqd;
    v_change_iqd := GREATEST(v_cash_iqd - v_fare_iqd, 0);
  END IF;

  IF v_change_iqd > 0 THEN
    -- Provision both wallets, then lock them in deterministic UUID order.
    INSERT INTO public.account_wallets(user_id)
    VALUES (v.customer_id), (v_actor)
    ON CONFLICT (user_id) DO NOTHING;

    PERFORM 1
    FROM public.account_wallets
    WHERE user_id IN (v.customer_id, v_actor)
    ORDER BY user_id
    FOR UPDATE;

    SELECT balance_iqd INTO v_customer_balance
    FROM public.account_wallets
    WHERE user_id = v.customer_id;

    SELECT balance_iqd INTO v_provider_balance
    FROM public.account_wallets
    WHERE user_id = v_actor;

    v_customer_next := v_customer_balance + v_change_iqd;
    v_provider_next := v_provider_balance - v_change_iqd;

    IF v_provider_next < -5000 THEN
      RAISE EXCEPTION 'provider_wallet_debt_limit_exceeded';
    END IF;

    INSERT INTO public.account_wallet_transactions(
      user_id, transaction_type, amount_iqd, balance_after_iqd,
      provider, provider_reference, idempotency_key, description, metadata
    ) VALUES (
      v.customer_id, 'refund', v_change_iqd, v_customer_next,
      'mamnoon_cash_change', 'cash-change:' || _request_id::text || ':customer',
      'cash-change:' || _request_id::text || ':customer',
      'إرجاع باقي مبلغ نقدي لطلب ممنون',
      jsonb_build_object(
        'request_id', _request_id,
        'provider_id', v_actor,
        'fare_iqd', v_fare_iqd,
        'cash_received_iqd', v_cash_iqd,
        'change_iqd', v_change_iqd,
        'direction', 'customer_credit'
      )
    )
    RETURNING id INTO v_customer_tx;

    INSERT INTO public.account_wallet_transactions(
      user_id, transaction_type, amount_iqd, balance_after_iqd,
      provider, provider_reference, idempotency_key, description, metadata
    ) VALUES (
      v_actor, 'deduction', -v_change_iqd, v_provider_next,
      'mamnoon_cash_change', 'cash-change:' || _request_id::text || ':provider',
      'cash-change:' || _request_id::text || ':provider',
      'تسوية باقي نقدي أُضيف إلى محفظة الزبون',
      jsonb_build_object(
        'request_id', _request_id,
        'customer_id', v.customer_id,
        'fare_iqd', v_fare_iqd,
        'cash_received_iqd', v_cash_iqd,
        'change_iqd', v_change_iqd,
        'direction', 'provider_debit'
      )
    )
    RETURNING id INTO v_provider_tx;

    UPDATE public.account_wallets
    SET balance_iqd = v_customer_next, updated_at = now()
    WHERE user_id = v.customer_id;

    UPDATE public.account_wallets
    SET balance_iqd = v_provider_next, updated_at = now()
    WHERE user_id = v_actor;
  END IF;

  PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
  UPDATE public.service_requests
  SET status = 'completed',
      completed_at = now(),
      cash_received_iqd = v_cash_iqd,
      cash_change_iqd = v_change_iqd,
      cash_settled_by = v_actor,
      cash_settled_at = now(),
      updated_at = now()
  WHERE id = _request_id
    AND status = 'in_progress';
  PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);

  RETURN jsonb_build_object(
    'request_id', _request_id,
    'fare_iqd', v_fare_iqd,
    'cash_received_iqd', v_cash_iqd,
    'change_iqd', v_change_iqd,
    'customer_transaction_id', v_customer_tx,
    'provider_transaction_id', v_provider_tx,
    'duplicate', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_service_request_with_cash(uuid,bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_service_request_with_cash(uuid,bigint)
  TO authenticated;

-- Prevent older clients from bypassing the cash amount prompt. Starting a
-- request remains unchanged; completion must go through the new atomic RPC.
CREATE OR REPLACE FUNCTION public.transition_service_request(
  _request_id uuid,
  _status public.request_status,
  _reason text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v public.service_requests%ROWTYPE;
  v_is_service_member boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF _status = 'cancelled' THEN
    PERFORM public.cancel_service_request(_request_id, _reason);
    RETURN true;
  END IF;

  SELECT * INTO v
  FROM public.service_requests
  WHERE id = _request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;

  v_is_service_member := v.type::text = 'service'
    AND public.is_service_request_provider(_request_id, auth.uid());

  IF v.provider_id IS DISTINCT FROM auth.uid() AND NOT v_is_service_member THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _status = 'in_progress' AND v.status = 'accepted' THEN
    IF (
      v.type::text = 'service'
      OR (v.type::text = 'taxi' AND COALESCE(v.vehicle_category::text, '') = 'large')
    ) AND v.provider_arrived_at IS NULL THEN
      RAISE EXCEPTION 'provider_not_arrived';
    END IF;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'true', true);
    UPDATE public.service_requests
    SET status = 'in_progress', started_at = now()
    WHERE id = _request_id;
    PERFORM set_config('mamnoon.allow_provider_request_transition', 'false', true);
    RETURN true;
  END IF;

  IF _status = 'completed' THEN
    RAISE EXCEPTION 'cash_received_amount_required';
  END IF;

  RAISE EXCEPTION 'invalid_status_transition';
END;
$function$;

REVOKE ALL ON FUNCTION public.transition_service_request(uuid,public.request_status,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_service_request(uuid,public.request_status,text)
  TO authenticated;
