-- Provider cash payables: electronic service/taxi payments owed by the platform
-- to drivers and workers, less the commission already recorded on each completed request.
-- Cash settlements are append-only and never mutate provider earnings or wallet balances.

CREATE TABLE IF NOT EXISTS public.mamnoon_provider_cash_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.profiles(id),
  amount_iqd bigint NOT NULL CHECK (amount_iqd > 0),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 2 AND 500),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mamnoon_provider_cash_settlements_provider_created_idx
  ON public.mamnoon_provider_cash_settlements(provider_id, created_at DESC);

ALTER TABLE public.mamnoon_provider_cash_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mamnoon_provider_cash_settlements FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mamnoon_provider_cash_settlements TO service_role;

COMMENT ON TABLE public.mamnoon_provider_cash_settlements IS
  'Append-only records of cash handed by the platform owner to a driver/worker against electronically collected completed requests. Does not alter provider wallet or earnings statistics.';

-- Return exact all-time totals; the Edge Function separately limits visible line items.
CREATE OR REPLACE FUNCTION public.admin_get_provider_payables_summary(p_provider_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_provider_governorate text;
  v_scope_type text;
  v_scope_governorate text;
  v_gross bigint := 0;
  v_commission bigint := 0;
  v_payable bigint := 0;
  v_settled bigint := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_provider_id IS NULL THEN RAISE EXCEPTION 'provider_required'; END IF;

  SELECT governorate_key INTO v_provider_governorate
  FROM public.profiles
  WHERE id = p_provider_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_provider_id
      AND role::text IN ('driver', 'worker', 'large_driver')
  ) THEN
    RAISE EXCEPTION 'provider_account_required';
  END IF;

  SELECT scope_type, scope_governorate
  INTO v_scope_type, v_scope_governorate
  FROM public.staff_assignments
  WHERE user_id = v_actor AND active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_scope_type = 'governorate'
     AND v_scope_governorate IS DISTINCT FROM v_provider_governorate THEN
    RAISE EXCEPTION 'provider_outside_finance_scope';
  END IF;

  IF NOT (
    public.has_admin_access(v_actor)
    OR public.admin_has_permission(
      'finance.read',
      CASE WHEN v_provider_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_provider_governorate
    )
  ) THEN
    RAISE EXCEPTION 'missing_finance_read_permission';
  END IF;

  SELECT
    COALESCE(SUM(q.gross_iqd), 0)::bigint,
    COALESCE(SUM(q.commission_iqd), 0)::bigint,
    COALESCE(SUM(GREATEST(q.gross_iqd - q.commission_iqd, 0)), 0)::bigint
  INTO v_gross, v_commission, v_payable
  FROM (
    SELECT
      sr.id,
      SUM(pt.amount)::bigint AS gross_iqd,
      LEAST(
        SUM(pt.amount)::bigint,
        GREATEST(0, ROUND(COALESCE(sr.commission, 0)))::bigint
      ) AS commission_iqd
    FROM public.service_requests sr
    JOIN public.payment_transactions pt
      ON pt.request_id = sr.id
     AND pt.purpose = 'service_request'
     AND pt.status = 'paid'
     AND pt.provider = 'zaincash'
     AND pt.currency = 'IQD'
     AND pt.user_id = sr.customer_id
    WHERE sr.provider_id = p_provider_id
      AND sr.status = 'completed'
      AND sr.payment_method = 'zaincash'
    GROUP BY sr.id, sr.commission
  ) q;

  SELECT COALESCE(SUM(amount_iqd), 0)::bigint
  INTO v_settled
  FROM public.mamnoon_provider_cash_settlements
  WHERE provider_id = p_provider_id;

  RETURN jsonb_build_object(
    'gross_paid_iqd', v_gross,
    'commission_iqd', v_commission,
    'payable_iqd', v_payable,
    'settled_iqd', v_settled,
    'outstanding_iqd', GREATEST(0, v_payable - v_settled),
    'over_settled_iqd', GREATEST(0, v_settled - v_payable)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_provider_payables_summary(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_provider_payables_summary(uuid)
  TO authenticated;

CREATE INDEX IF NOT EXISTS service_requests_provider_zaincash_completed_idx
  ON public.service_requests(provider_id, completed_at DESC)
  WHERE status = 'completed' AND payment_method = 'zaincash';

CREATE INDEX IF NOT EXISTS payment_transactions_zaincash_service_paid_idx
  ON public.payment_transactions(request_id, user_id)
  WHERE purpose = 'service_request' AND status = 'paid'
    AND provider = 'zaincash' AND currency = 'IQD';

CREATE OR REPLACE FUNCTION public.admin_record_provider_cash_settlement(
  p_provider_id uuid,
  p_amount_iqd bigint,
  p_note text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_governorate text;
  v_scope_type text;
  v_scope_governorate text;
  v_existing public.mamnoon_provider_cash_settlements%ROWTYPE;
  v_payable_total bigint := 0;
  v_settled_total bigint := 0;
  v_outstanding bigint := 0;
  v_settlement_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_provider_id IS NULL THEN RAISE EXCEPTION 'provider_required'; END IF;
  IF p_amount_iqd IS NULL OR p_amount_iqd <= 0 OR p_amount_iqd > 1000000000 THEN
    RAISE EXCEPTION 'invalid_settlement_amount';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION 'settlement_note_required';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'valid_idempotency_key_required';
  END IF;

  SELECT governorate_key INTO v_governorate
  FROM public.profiles
  WHERE id = p_provider_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_provider_id
      AND role::text IN ('driver', 'worker', 'large_driver')
  ) THEN
    RAISE EXCEPTION 'provider_account_required';
  END IF;

  SELECT scope_type, scope_governorate
  INTO v_scope_type, v_scope_governorate
  FROM public.staff_assignments
  WHERE user_id = v_actor AND active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_scope_type = 'governorate'
     AND v_scope_governorate IS DISTINCT FROM v_governorate THEN
    RAISE EXCEPTION 'provider_outside_finance_scope';
  END IF;

  IF NOT (
    public.has_admin_access(v_actor)
    OR public.admin_has_permission(
      'finance.wallet.adjust',
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    )
  ) THEN
    RAISE EXCEPTION 'missing_finance_wallet_permission';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_provider_id::text, 913578)
  );

  SELECT * INTO v_existing
  FROM public.mamnoon_provider_cash_settlements
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.provider_id <> p_provider_id
       OR v_existing.amount_iqd <> p_amount_iqd
       OR v_existing.note <> btrim(p_note) THEN
      RAISE EXCEPTION 'settlement_idempotency_conflict';
    END IF;
    RETURN jsonb_build_object(
      'settlement_id', v_existing.id,
      'amount_iqd', v_existing.amount_iqd,
      'duplicate', true
    );
  END IF;

  -- One commission is deducted per completed request, even if the gateway
  -- contains more than one successful payment row for that request.
  SELECT COALESCE(SUM(GREATEST(q.gross_iqd - q.commission_iqd, 0)), 0)::bigint
  INTO v_payable_total
  FROM (
    SELECT
      sr.id,
      SUM(pt.amount)::bigint AS gross_iqd,
      LEAST(
        SUM(pt.amount)::bigint,
        GREATEST(0, ROUND(COALESCE(sr.commission, 0)))::bigint
      ) AS commission_iqd
    FROM public.service_requests sr
    JOIN public.payment_transactions pt
      ON pt.request_id = sr.id
     AND pt.purpose = 'service_request'
     AND pt.status = 'paid'
     AND pt.provider = 'zaincash'
     AND pt.currency = 'IQD'
     AND pt.user_id = sr.customer_id
    WHERE sr.provider_id = p_provider_id
      AND sr.status = 'completed'
      AND sr.payment_method = 'zaincash'
    GROUP BY sr.id, sr.commission
  ) q;

  SELECT COALESCE(SUM(amount_iqd), 0)::bigint
  INTO v_settled_total
  FROM public.mamnoon_provider_cash_settlements
  WHERE provider_id = p_provider_id;

  v_outstanding := v_payable_total - v_settled_total;
  IF v_outstanding <= 0 OR p_amount_iqd > v_outstanding THEN
    RAISE EXCEPTION 'settlement_exceeds_provider_payable';
  END IF;

  INSERT INTO public.mamnoon_provider_cash_settlements(
    provider_id, amount_iqd, note, idempotency_key, created_by
  )
  VALUES (
    p_provider_id, p_amount_iqd, btrim(p_note), p_idempotency_key, v_actor
  )
  RETURNING id INTO v_settlement_id;

  PERFORM public.log_admin_action(
    'record_provider_cash_settlement',
    'provider',
    p_provider_id::text,
    jsonb_build_object(
      'settlement_id', v_settlement_id,
      'amount_iqd', p_amount_iqd,
      'note', btrim(p_note),
      'outstanding_before_iqd', v_outstanding,
      'outstanding_after_iqd', v_outstanding - p_amount_iqd
    )
  );

  RETURN jsonb_build_object(
    'settlement_id', v_settlement_id,
    'amount_iqd', p_amount_iqd,
    'outstanding_after_iqd', v_outstanding - p_amount_iqd,
    'duplicate', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_record_provider_cash_settlement(uuid,bigint,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_provider_cash_settlement(uuid,bigint,text,text)
  TO authenticated;
