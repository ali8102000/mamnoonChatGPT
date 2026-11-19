-- Extend the existing verified ZainCash pipeline to wallet top-ups.
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_purpose_check,
  DROP CONSTRAINT IF EXISTS payment_transactions_purpose_ref_check;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_purpose_check
    CHECK (purpose IN ('subscription','service_request','wallet_topup')),
  ADD CONSTRAINT payment_transactions_purpose_ref_check
    CHECK (
      (purpose = 'subscription' AND plan_id IS NOT NULL AND request_id IS NULL)
      OR (purpose = 'service_request' AND request_id IS NOT NULL AND plan_id IS NULL)
      OR (purpose = 'wallet_topup' AND plan_id IS NULL AND request_id IS NULL)
    );

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
  v_plan public.subscription_plans%ROWTYPE;
  v_start timestamptz;
  v_end timestamptz;
  v_wallet_result jsonb;
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

    v_wallet_result := public.apply_account_wallet_transaction(
      v_payment.user_id,
      'zaincash_topup',
      v_payment.amount::bigint,
      'zaincash-payment:' || v_payment.id::text,
      'zaincash',
      p_gateway_transaction_id,
      'شحن محفظة ممنون عبر زين كاش',
      jsonb_build_object(
        'payment_id', v_payment.id,
        'external_reference_id', v_payment.external_reference_id,
        'gateway_transaction_id', p_gateway_transaction_id,
        'verified_status', 'SUCCESS'
      )
    );

  ELSIF v_payment.purpose = 'subscription' THEN
    SELECT * INTO v_plan
    FROM public.subscription_plans
    WHERE id = v_payment.plan_id
      AND is_active
      AND monthly_price = v_payment.amount
      AND currency = 'IQD';
    IF NOT FOUND THEN RAISE EXCEPTION 'subscription_plan_unavailable_or_price_changed'; END IF;

    IF EXISTS (
      SELECT 1 FROM public.user_subscriptions
      WHERE user_id = v_payment.user_id AND grant_type = 'admin'
    ) THEN
      RAISE EXCEPTION 'company_granted_subscription_managed_by_admin';
    END IF;

    SELECT CASE
      WHEN us.status = 'active' AND NOT us.is_trial AND us.current_period_end > now()
      THEN us.current_period_end ELSE now()
    END
    INTO v_start
    FROM public.user_subscriptions us
    WHERE us.user_id = v_payment.user_id
    FOR UPDATE;
    IF v_start IS NULL THEN v_start := now(); END IF;
    v_end := v_start + interval '1 month';

    INSERT INTO public.user_subscriptions
      (user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,
       request_count,resets_count_period_start,auto_renew,is_trial,trial_started_at,trial_ends_at,
       granted_by,grant_type,cancel_at_period_end,cancelled_at,provider_types)
    VALUES
      (v_payment.user_id,v_payment.plan_id,'active','monthly',v_start,v_end,0,now(),false,
       false,null,null,null,'paid',false,null,public.mamnoon_provider_kinds(v_payment.user_id))
    ON CONFLICT (user_id) DO UPDATE SET
      plan_id=excluded.plan_id,status='active',billing_cycle='monthly',
      current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
      request_count=0,resets_count_period_start=now(),auto_renew=false,
      is_trial=false,trial_started_at=null,trial_ends_at=null,granted_by=null,
      grant_type='paid',cancel_at_period_end=false,cancelled_at=null,
      provider_types=excluded.provider_types,updated_at=now();

    INSERT INTO public.notifications(user_id,type,title,body,link)
    VALUES(v_payment.user_id,'subscription_activated','تم تفعيل اشتراكك',
      'تم تأكيد الدفع عبر زين كاش وتفعيل الاشتراك لمدة شهر','/subscriptions');

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
      metadata=metadata || COALESCE(p_payload,'{}'::jsonb),updated_at=now()
  WHERE id=v_payment.id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_zaincash_payment(uuid,text,text,integer,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_zaincash_payment(uuid,text,text,integer,text,jsonb)
  TO service_role;
