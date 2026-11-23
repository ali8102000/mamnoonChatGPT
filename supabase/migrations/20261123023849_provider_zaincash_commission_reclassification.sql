-- Preserve the audit trail when an acceptance-time wallet commission was already
-- collected through a later wallet top-up. Such collection is reversed as part of
-- the reclassification, then the verified service payment becomes the sole source.
CREATE TABLE IF NOT EXISTS public.mamnoon_revenue_collection_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_collection_id uuid NOT NULL REFERENCES public.mamnoon_revenue_collections(id),
  revenue_ledger_id uuid NOT NULL REFERENCES public.mamnoon_revenue_ledger(id),
  amount_iqd bigint NOT NULL CHECK (amount_iqd > 0),
  reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mamnoon_revenue_collection_reversal_once UNIQUE (revenue_collection_id)
);
ALTER TABLE public.mamnoon_revenue_collection_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mamnoon_revenue_collection_reversals FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS mamnoon_revenue_collections_ledger_idx
  ON public.mamnoon_revenue_collections(revenue_ledger_id);
CREATE INDEX IF NOT EXISTS mamnoon_revenue_collection_reversals_ledger_idx
  ON public.mamnoon_revenue_collection_reversals(revenue_ledger_id);

CREATE OR REPLACE FUNCTION public.reclassify_zaincash_provider_commission(
  p_request_id uuid,
  p_payment_id uuid,
  p_gateway_transaction_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.service_requests%ROWTYPE;
  v_payment public.payment_transactions%ROWTYPE;
  v_ledger public.mamnoon_revenue_ledger%ROWTYPE;
  v_wallet_tx public.account_wallet_transactions%ROWTYPE;
  v_refund_iqd bigint := 0;
  v_reversed_topup_collections bigint := 0;
  v_collected_before bigint := 0;
  v_due bigint := 0;
  v_take bigint := 0;
  v_collected_after bigint := 0;
  v_collection record;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_request_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'invalid_commission_reclassification_target';
  END IF;

  SELECT * INTO v_request
  FROM public.service_requests
  WHERE id = p_request_id
  FOR UPDATE;
  -- A successful gateway callback can race with a customer cancellation.
  -- Keep the paid transaction for refund review, but do not assess provider commission.
  IF v_request.status::text = 'cancelled'
     AND v_request.cancelled_by IS NOT DISTINCT FROM v_request.customer_id THEN
    UPDATE public.service_requests
    SET payment_method = 'zaincash',
        commission = 0,
        updated_at = now()
    WHERE id = p_request_id;
    RETURN;
  END IF;

  IF NOT FOUND OR v_request.payment_method IS DISTINCT FROM 'zaincash'
     OR v_request.provider_id IS NULL THEN
    RAISE EXCEPTION 'zaincash_request_provider_not_found';
  END IF;

  SELECT * INTO v_payment
  FROM public.payment_transactions
  WHERE id = p_payment_id
    AND request_id = p_request_id
    AND purpose = 'service_request'
    AND status = 'paid'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'verified_zaincash_payment_required'; END IF;

  SELECT * INTO v_ledger
  FROM public.mamnoon_revenue_ledger
  WHERE request_id = p_request_id
    AND user_id = v_request.provider_id
    AND revenue_type = CASE WHEN v_request.type::text = 'taxi'
      THEN 'taxi_commission' ELSE 'service_commission' END
  FOR UPDATE;
  IF NOT FOUND THEN
    -- A zero commission is valid for exempt requests and has no ledger row.
    -- A positive request commission without its ledger is inconsistent financial data;
    -- fail the payment finalization transaction instead of silently erasing the fee.
    IF COALESCE(v_request.commission, 0) > 0 THEN
      RAISE EXCEPTION 'zaincash_commission_ledger_missing';
    END IF;
    UPDATE public.service_requests
    SET commission = 0, updated_at = now()
    WHERE id = p_request_id;
    RETURN;
  END IF;

  -- Reverse any commission debt already collected from a provider's wallet top-up.
  -- Keep the original collection row and add a separate, auditable reversal row.
  FOR v_collection IN
    SELECT rc.id, rc.amount_iqd
    FROM public.mamnoon_revenue_collections rc
    JOIN public.payment_transactions pt ON pt.id = rc.payment_id
    WHERE rc.revenue_ledger_id = v_ledger.id
      AND pt.purpose = 'wallet_topup'
  LOOP
    INSERT INTO public.mamnoon_revenue_collection_reversals(
      revenue_collection_id,revenue_ledger_id,amount_iqd,reason,idempotency_key
    ) VALUES (
      v_collection.id,v_ledger.id,v_collection.amount_iqd,
      'Reclassified to verified ZainCash service-request commission',
      'zaincash-commission-collection-reversal:' || v_collection.id::text
    ) ON CONFLICT (revenue_collection_id) DO NOTHING;
  END LOOP;

  SELECT COALESCE(SUM(amount_iqd),0)::bigint
  INTO v_reversed_topup_collections
  FROM public.mamnoon_revenue_collection_reversals
  WHERE revenue_ledger_id = v_ledger.id;

  -- Reverse the original acceptance-time wallet debit once, preserving history.
  SELECT * INTO v_wallet_tx
  FROM public.account_wallet_transactions
  WHERE idempotency_key = 'mamnoon-commission:' || p_request_id::text || ':' || v_request.provider_id::text;
  IF FOUND AND v_wallet_tx.amount_iqd < 0 THEN
    v_refund_iqd := abs(v_wallet_tx.amount_iqd);
    PERFORM public.apply_account_wallet_transaction(
      v_request.provider_id,
      'refund',
      v_refund_iqd,
      'mamnoon-zaincash-commission-refund:' || p_request_id::text || ':' || v_request.provider_id::text,
      NULL,
      NULL,
      'إرجاع عمولة الطلب إلى محفظة مقدم الخدمة بعد اعتماد الدفع الإلكتروني',
      jsonb_build_object('request_id',p_request_id,'source','verified_zaincash_service_payment','reversed_wallet_transaction_id',v_wallet_tx.id)
    );
  END IF;

  SELECT COALESCE(SUM(rc.amount_iqd),0)::bigint
    - COALESCE(SUM(rr.amount_iqd),0)::bigint
  INTO v_collected_before
  FROM public.mamnoon_revenue_collections rc
  LEFT JOIN public.mamnoon_revenue_collection_reversals rr
    ON rr.revenue_collection_id = rc.id
  WHERE rc.revenue_ledger_id = v_ledger.id;

  v_due := GREATEST(0, v_ledger.assessed_iqd - v_ledger.waived_iqd - v_collected_before);
  v_take := LEAST(v_payment.amount::bigint, v_due);
  IF v_take > 0 THEN
    INSERT INTO public.mamnoon_revenue_collections(
      revenue_ledger_id,payment_id,amount_iqd,provider_reference
    ) VALUES (
      v_ledger.id,p_payment_id,v_take,COALESCE(p_gateway_transaction_id,v_payment.gateway_transaction_id,'zaincash:' || p_payment_id::text)
    ) ON CONFLICT (revenue_ledger_id,payment_id) DO NOTHING;
  END IF;

  SELECT COALESCE(SUM(rc.amount_iqd),0)::bigint
    - COALESCE(SUM(rr.amount_iqd),0)::bigint
  INTO v_collected_after
  FROM public.mamnoon_revenue_collections rc
  LEFT JOIN public.mamnoon_revenue_collection_reversals rr
    ON rr.revenue_collection_id = rc.id
  WHERE rc.revenue_ledger_id = v_ledger.id;

  UPDATE public.mamnoon_revenue_ledger
  SET collected_iqd = LEAST(assessed_iqd - waived_iqd, GREATEST(0,v_collected_after)),
      status = CASE
        WHEN LEAST(assessed_iqd - waived_iqd, GREATEST(0,v_collected_after)) >= assessed_iqd THEN 'collected'
        WHEN LEAST(assessed_iqd - waived_iqd, GREATEST(0,v_collected_after)) > 0
          AND waived_iqd > 0
          AND LEAST(assessed_iqd - waived_iqd, GREATEST(0,v_collected_after)) + waived_iqd >= assessed_iqd
          THEN 'partially_waived'
        WHEN LEAST(assessed_iqd - waived_iqd, GREATEST(0,v_collected_after)) > 0 THEN 'partially_collected'
        WHEN waived_iqd >= assessed_iqd THEN 'waived'
        WHEN waived_iqd > 0 THEN 'partially_waived'
        ELSE 'accrued'
      END,
      provider_reference = COALESCE(p_gateway_transaction_id,provider_reference),
      metadata = metadata || jsonb_build_object(
        'collection_source','verified_zaincash_service_payment',
        'provider_wallet_commission_refunded_iqd',v_refund_iqd,
        'wallet_topup_collections_reversed_iqd',v_reversed_topup_collections,
        'provider_payable_commission_iqd',GREATEST(assessed_iqd - waived_iqd, 0)
      ),
      updated_at = now()
  WHERE id = v_ledger.id;

  UPDATE public.service_requests
  SET commission = GREATEST(v_ledger.assessed_iqd - v_ledger.waived_iqd, 0), updated_at = now()
  WHERE id = p_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reclassify_zaincash_provider_commission(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclassify_zaincash_provider_commission(uuid,uuid,text)
  TO service_role;

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

  IF v_payment.purpose = 'wallet_topup' THEN
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

  IF v_payment.purpose = 'service_request' THEN
    PERFORM public.reclassify_zaincash_provider_commission(
      v_payment.request_id, v_payment.id, p_gateway_transaction_id
    );
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_zaincash_payment(uuid,text,text,integer,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_zaincash_payment(uuid,text,text,integer,text,jsonb)
  TO service_role;
