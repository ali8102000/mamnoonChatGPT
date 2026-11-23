-- Request identity, ZainCash cancellation review, and request-linked support.
-- This migration is committed to the PR only. It is NOT applied to production.

UPDATE public.admin_permission_catalog
SET label_ar = 'اعتماد وتسجيل الاسترداد',
    description = 'اعتماد قرار الاسترداد وتسجيل إعادة المبلغ يدوياً بعد التحقق؛ لا ينفذ تحويل تلقائي',
    risk_level = 'critical',
    active = true
WHERE permission_key = 'finance.refund';

UPDATE public.admin_permission_catalog
SET label_ar = 'عرض طلبات الإلغاء والاسترداد',
    description = 'عرض بيانات الزبون والدفع وطلبات الاسترداد ضمن النطاق الإداري المصرح',
    risk_level = 'sensitive',
    active = true
WHERE permission_key = 'finance.refund.read';

CREATE SEQUENCE IF NOT EXISTS public.mamnoon_request_code_seq;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS request_code text;

WITH numbered AS (
  SELECT id, created_at, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.service_requests
  WHERE request_code IS NULL
)
UPDATE public.service_requests r
SET request_code = 'MN-' || to_char(numbered.created_at, 'YYYY') || '-' || lpad(numbered.rn::text, 8, '0')
FROM numbered
WHERE r.id = numbered.id;

SELECT setval(
  'public.mamnoon_request_code_seq',
  GREATEST((SELECT count(*) FROM public.service_requests), 1),
  (SELECT count(*) > 0 FROM public.service_requests)
);

CREATE UNIQUE INDEX IF NOT EXISTS service_requests_request_code_uidx
  ON public.service_requests(request_code);
ALTER TABLE public.service_requests ALTER COLUMN request_code SET NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_mamnoon_request_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.request_code := 'MN-' || to_char(clock_timestamp(), 'YYYY') || '-' ||
      lpad(nextval('public.mamnoon_request_code_seq')::text, 8, '0');
    RETURN NEW;
  END IF;

  IF NEW.request_code IS DISTINCT FROM OLD.request_code THEN
    RAISE EXCEPTION 'request_code_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS assign_mamnoon_request_code ON public.service_requests;
CREATE TRIGGER assign_mamnoon_request_code
BEFORE INSERT OR UPDATE OF request_code ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.assign_mamnoon_request_code();

REVOKE ALL ON FUNCTION public.assign_mamnoon_request_code() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.service_requests.request_code IS
  'Stable, unique, user-facing Mamnoon order code. Immutable after creation.';

CREATE OR REPLACE FUNCTION public.enrich_request_notification_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request_id uuid;
  v_request_code text;
  v_request_id_text text;
BEGIN
  v_request_id_text := coalesce(NEW.data ->> 'request_id', '');
  IF v_request_id_text = '' AND NEW.link ~ '^/request/[0-9a-fA-F-]{36}($|[?])' THEN
    v_request_id_text := split_part(split_part(NEW.link, '/request/', 2), '?', 1);
  END IF;
  IF v_request_id_text <> '' THEN
    BEGIN
      v_request_id := v_request_id_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NEW;
    END;

    SELECT request_code INTO v_request_code
    FROM public.service_requests
    WHERE id = v_request_id;

    IF v_request_code IS NOT NULL THEN
      NEW.data := coalesce(NEW.data, '{}'::jsonb) || jsonb_build_object(
        'request_id', v_request_id,
        'request_code', v_request_code
      );
      IF position(v_request_code in coalesce(NEW.body,'')) = 0 THEN
        NEW.body := left(coalesce(NEW.body,'') || ' · رقم الطلب ' || v_request_code, 500);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enrich_request_notification_code ON public.notifications;
CREATE TRIGGER enrich_request_notification_code
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.enrich_request_notification_code();
REVOKE ALL ON FUNCTION public.enrich_request_notification_code() FROM PUBLIC, anon, authenticated;


CREATE TABLE IF NOT EXISTS public.support_conversation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  linked_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, request_id)
);
CREATE INDEX IF NOT EXISTS support_conversation_requests_request_idx
  ON public.support_conversation_requests(request_id, created_at DESC);
ALTER TABLE public.support_conversation_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.support_conversation_requests TO authenticated;
GRANT ALL ON public.support_conversation_requests TO service_role;
REVOKE UPDATE, DELETE ON public.support_conversation_requests FROM anon, authenticated;

DROP POLICY IF EXISTS "Support participants read linked requests" ON public.support_conversation_requests;
CREATE POLICY "Support participants read linked requests"
  ON public.support_conversation_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_conversations c
      WHERE c.id = conversation_id
        AND (c.user_id = (SELECT auth.uid()) OR public.has_staff_role((SELECT auth.uid())))
    )
  );

DROP POLICY IF EXISTS "Customer or staff link own support requests" ON public.support_conversation_requests;
CREATE POLICY "Customer or staff link own support requests"
  ON public.support_conversation_requests FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.support_conversations c
      JOIN public.service_requests r ON r.id = request_id
      WHERE c.id = conversation_id
        AND (
          (c.user_id = (SELECT auth.uid()) AND r.customer_id = (SELECT auth.uid()))
          OR (public.has_staff_role((SELECT auth.uid())))
        )
        AND (
          linked_by IS NULL
          OR linked_by = (SELECT auth.uid())
          OR public.has_staff_role((SELECT auth.uid()))
        )
    )
  );

CREATE TABLE IF NOT EXISTS public.mamnoon_zaincash_refund_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payment_transactions(id),
  request_id uuid NOT NULL REFERENCES public.service_requests(id),
  customer_id uuid NOT NULL REFERENCES public.profiles(id),
  amount_iqd bigint NOT NULL CHECK (amount_iqd > 0),
  currency text NOT NULL DEFAULT 'IQD' CHECK (currency = 'IQD'),
  cancellation_reason text,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','rejected','refunded')),
  decision_note text,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  refund_reference text,
  refunded_amount_iqd bigint CHECK (refunded_amount_iqd IS NULL OR refunded_amount_iqd > 0),
  refunded_by uuid REFERENCES auth.users(id),
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'pending_review' AND decided_by IS NULL AND decided_at IS NULL AND refunded_at IS NULL)
    OR (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND refunded_at IS NULL)
    OR (status = 'refunded' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
        AND refunded_by IS NOT NULL AND refunded_at IS NOT NULL
        AND refund_reference IS NOT NULL AND refunded_amount_iqd IS NOT NULL AND refunded_amount_iqd = amount_iqd)
  )
);
CREATE INDEX IF NOT EXISTS mamnoon_zaincash_refund_cases_status_idx
  ON public.mamnoon_zaincash_refund_cases(status, created_at DESC);
CREATE INDEX IF NOT EXISTS mamnoon_zaincash_refund_cases_customer_idx
  ON public.mamnoon_zaincash_refund_cases(customer_id, created_at DESC);
ALTER TABLE public.mamnoon_zaincash_refund_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mamnoon_zaincash_refund_cases FROM anon, authenticated;
GRANT ALL ON public.mamnoon_zaincash_refund_cases TO service_role;

CREATE TABLE IF NOT EXISTS public.mamnoon_zaincash_refund_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_case_id uuid NOT NULL REFERENCES public.mamnoon_zaincash_refund_cases(id),
  event_type text NOT NULL CHECK (event_type IN ('opened','approved','rejected','refunded')),
  actor_id uuid REFERENCES auth.users(id),
  note text,
  reference text,
  amount_iqd bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mamnoon_zaincash_refund_events_case_idx
  ON public.mamnoon_zaincash_refund_events(refund_case_id, created_at);
ALTER TABLE public.mamnoon_zaincash_refund_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mamnoon_zaincash_refund_events FROM anon, authenticated;
GRANT ALL ON public.mamnoon_zaincash_refund_events TO service_role;

CREATE TABLE IF NOT EXISTS public.mamnoon_refund_commission_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_case_id uuid NOT NULL REFERENCES public.mamnoon_zaincash_refund_cases(id),
  revenue_ledger_id uuid NOT NULL REFERENCES public.mamnoon_revenue_ledger(id),
  provider_id uuid NOT NULL REFERENCES public.profiles(id),
  amount_iqd bigint NOT NULL CHECK (amount_iqd > 0),
  wallet_transaction_id uuid REFERENCES public.account_wallet_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (refund_case_id, revenue_ledger_id)
);
ALTER TABLE public.mamnoon_refund_commission_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mamnoon_refund_commission_reversals FROM anon, authenticated;
GRANT ALL ON public.mamnoon_refund_commission_reversals TO service_role;

CREATE OR REPLACE FUNCTION public.open_zaincash_refund_case_on_customer_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment record;
  v_case_id uuid;
  v_conversation_id uuid;
  v_opened integer := 0;
BEGIN
  IF NEW.status::text <> 'cancelled'
     OR OLD.status::text = 'cancelled'
     OR NEW.cancelled_by IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  FOR v_payment IN
    SELECT p.id, p.amount, p.user_id
    FROM public.payment_transactions p
    WHERE p.request_id = NEW.id
      AND p.purpose = 'service_request'
      AND p.provider = 'zaincash'
      AND p.currency = 'IQD'
      AND p.status = 'paid'
      AND p.user_id = NEW.customer_id
    ORDER BY p.paid_at, p.created_at
  LOOP
    v_case_id := NULL;
    INSERT INTO public.mamnoon_zaincash_refund_cases(
      payment_id, request_id, customer_id, amount_iqd, cancellation_reason
    ) VALUES (
      v_payment.id, NEW.id, NEW.customer_id, v_payment.amount,
      left(coalesce(NEW.cancellation_reason, 'إلغاء الطلب من الزبون'), 500)
    )
    ON CONFLICT (payment_id) DO NOTHING
    RETURNING id INTO v_case_id;

    IF v_case_id IS NULL THEN
      CONTINUE;
    END IF;

    v_opened := v_opened + 1;
    INSERT INTO public.mamnoon_zaincash_refund_events(refund_case_id, event_type, note, amount_iqd)
    VALUES (v_case_id, 'opened', left(coalesce(NEW.cancellation_reason, 'إلغاء الطلب من الزبون'), 500), v_payment.amount);

    UPDATE public.mamnoon_revenue_ledger
    SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'refund_review_pending', true,
          'refund_case_id', v_case_id
        ),
        updated_at = now()
    WHERE request_id = NEW.id
      AND revenue_type IN ('taxi_commission','service_commission','order_commission')
      AND status <> 'void';

    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (
      NEW.customer_id,
      'zaincash_refund_review',
      'طلبك قيد مراجعة الاسترداد',
      'استلمنا طلب إلغاء الطلب المدفوع بزين كاش. المبلغ لم يُسترد بعد، وستصلك نتيجة المراجعة.',
      '/support-chat?requestId=' || NEW.id::text,
      jsonb_build_object('request_id', NEW.id, 'request_code', NEW.request_code, 'refund_case_id', v_case_id)
    );

    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    SELECT DISTINCT ur.user_id,
      'zaincash_refund_review',
      'طلب إلغاء واسترداد يحتاج مراجعة',
      'طلب مدفوع بزين كاش أُلغي من الزبون · ' || coalesce(NEW.request_code, NEW.id::text),
      '/admin',
      jsonb_build_object('request_id', NEW.id, 'request_code', NEW.request_code, 'refund_case_id', v_case_id)
    FROM public.user_roles ur
    WHERE ur.role::text IN ('super_admin','admin','finance','support');

  END LOOP;

  IF v_opened > 0 THEN
    SELECT c.id INTO v_conversation_id
    FROM public.support_conversations c
    WHERE c.user_id = NEW.customer_id AND c.status = 'open'
    ORDER BY c.updated_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_conversation_id IS NULL THEN
      BEGIN
        INSERT INTO public.support_conversations(user_id, created_by, subject, status)
        VALUES (NEW.customer_id, NEW.customer_id, 'استفسار إلغاء واسترداد · ' || coalesce(NEW.request_code, NEW.id::text), 'open')
        RETURNING id INTO v_conversation_id;
      EXCEPTION WHEN unique_violation THEN
        SELECT c.id INTO v_conversation_id
        FROM public.support_conversations c
        WHERE c.user_id = NEW.customer_id AND c.status = 'open'
        ORDER BY c.updated_at DESC
        LIMIT 1;
      END;
    END IF;

    IF v_conversation_id IS NOT NULL THEN
      INSERT INTO public.support_conversation_requests(conversation_id, request_id, linked_by)
      VALUES (v_conversation_id, NEW.id, NEW.customer_id)
      ON CONFLICT (conversation_id, request_id) DO NOTHING;
      UPDATE public.support_conversations
      SET subject = CASE
            WHEN position(NEW.request_code in subject) > 0 THEN subject
            ELSE left(subject, greatest(0, 150 - length(' · ' || NEW.request_code))) || ' · ' || NEW.request_code
          END,
          needs_admin_reply = true,
          ai_status = 'waiting_human',
          ticket_status = 'new',
          handoff_status = CASE WHEN assigned_staff_id IS NOT NULL THEN 'assigned' ELSE 'waiting_for_admin' END,
          last_message_source = 'user',
          last_message_at = now(),
          updated_at = now()
      WHERE id = v_conversation_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS open_zaincash_refund_case_on_customer_cancel ON public.service_requests;
CREATE TRIGGER open_zaincash_refund_case_on_customer_cancel
AFTER UPDATE OF status ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.open_zaincash_refund_case_on_customer_cancel();
REVOKE ALL ON FUNCTION public.open_zaincash_refund_case_on_customer_cancel() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_decide_zaincash_refund(
  p_refund_case_id uuid,
  p_decision text,
  p_note text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_case public.mamnoon_zaincash_refund_cases%ROWTYPE;
  v_request_code text;
  v_note text := left(btrim(coalesce(p_note,'')),500);
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_refund_case_id IS NULL OR p_actor_id IS NULL
     OR p_decision NOT IN ('approved','rejected')
     OR (p_decision = 'rejected' AND length(v_note) < 2) THEN
    RAISE EXCEPTION 'invalid_refund_decision';
  END IF;

  SELECT * INTO v_case
  FROM public.mamnoon_zaincash_refund_cases
  WHERE id = p_refund_case_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_case_not_found'; END IF;
  IF v_case.status <> 'pending_review' THEN
    RAISE EXCEPTION 'refund_case_already_reviewed';
  END IF;

  SELECT request_code INTO v_request_code
  FROM public.service_requests WHERE id = v_case.request_id;

  UPDATE public.mamnoon_zaincash_refund_cases
  SET status = p_decision,
      decision_note = coalesce(nullif(v_note,''), CASE WHEN p_decision='approved'
        THEN 'تمت الموافقة المبدئية؛ بانتظار تنفيذ الاسترداد اليدوي.'
        ELSE 'تم رفض طلب الاسترداد.' END),
      decided_by = p_actor_id,
      decided_at = now(),
      updated_at = now()
  WHERE id = v_case.id;

  IF p_decision = 'rejected' AND NOT EXISTS (
    SELECT 1 FROM public.mamnoon_zaincash_refund_cases other_case
    WHERE other_case.request_id = v_case.request_id
      AND other_case.id <> v_case.id
      AND other_case.status IN ('pending_review','approved')
  ) THEN
    UPDATE public.mamnoon_revenue_ledger
    SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'refund_review_pending', false,
          'refund_review_decision', 'rejected',
          'refund_case_id', v_case.id
        ),
        updated_at = now()
    WHERE request_id = v_case.request_id
      AND revenue_type IN ('taxi_commission','service_commission','order_commission')
      AND status <> 'void';
  END IF;

  INSERT INTO public.mamnoon_zaincash_refund_events(
    refund_case_id,event_type,actor_id,note,amount_iqd
  ) VALUES (
    v_case.id,p_decision,p_actor_id,
    coalesce(nullif(v_note,''), CASE WHEN p_decision='approved'
      THEN 'تمت الموافقة المبدئية؛ لم يتم تحويل أي مبلغ بعد.'
      ELSE 'تم رفض طلب الاسترداد.' END),
    v_case.amount_iqd
  );

  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  VALUES (
    v_case.customer_id,
    'zaincash_refund_decision',
    CASE WHEN p_decision='approved' THEN 'تمت الموافقة على طلب الاسترداد' ELSE 'تم رفض طلب الاسترداد' END,
    CASE WHEN p_decision='approved'
      THEN 'تمت الموافقة المبدئية على طلبك. ستصلك رسالة أخرى بعد تسجيل إعادة المبلغ فعلياً.'
      ELSE 'تم رفض طلب الاسترداد. السبب: ' || coalesce(nullif(v_note,''),'يرجى مراسلة الدعم لمزيد من التفاصيل.') END,
    '/support-chat?requestId=' || v_case.request_id::text,
    jsonb_build_object('request_id',v_case.request_id,'request_code',v_request_code,'refund_case_id',v_case.id)
  );

  RETURN jsonb_build_object('ok',true,'refund_case_id',v_case.id,'status',p_decision);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_decide_zaincash_refund(uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_zaincash_refund(uuid,text,text,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_mark_zaincash_refund(
  p_refund_case_id uuid,
  p_refund_reference text,
  p_actor_id uuid,
  p_refunded_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_case public.mamnoon_zaincash_refund_cases%ROWTYPE;
  v_payment public.payment_transactions%ROWTYPE;
  v_ledger public.mamnoon_revenue_ledger%ROWTYPE;
  v_collection record;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_refund_case_id IS NULL
     OR p_actor_id IS NULL
     OR p_refund_reference IS NULL
     OR length(btrim(p_refund_reference)) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'invalid_refund_details';
  END IF;

  SELECT * INTO v_case
  FROM public.mamnoon_zaincash_refund_cases
  WHERE id = p_refund_case_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_case_not_found'; END IF;
  IF v_case.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'refund_case_id', v_case.id);
  END IF;
  IF v_case.status <> 'approved' THEN RAISE EXCEPTION 'refund_not_approved'; END IF;

  SELECT * INTO v_payment
  FROM public.payment_transactions
  WHERE id = v_case.payment_id
  FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'paid' THEN
    RAISE EXCEPTION 'payment_not_in_paid_state';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payment_transactions other_payment
    WHERE other_payment.request_id = v_case.request_id
      AND other_payment.purpose = 'service_request'
      AND other_payment.provider = 'zaincash'
      AND other_payment.status = 'paid'
      AND other_payment.id <> v_payment.id
  ) THEN
  FOR v_ledger IN
    SELECT *
    FROM public.mamnoon_revenue_ledger
    WHERE request_id = v_case.request_id
      AND revenue_type IN ('taxi_commission','service_commission','order_commission')
      AND status <> 'void'
    FOR UPDATE
  LOOP
    IF v_ledger.assessed_iqd > v_ledger.waived_iqd THEN
      INSERT INTO public.mamnoon_refund_commission_reversals(
        refund_case_id,revenue_ledger_id,provider_id,amount_iqd,wallet_transaction_id
      ) VALUES (
        v_case.id,v_ledger.id,v_ledger.user_id,
        v_ledger.assessed_iqd - v_ledger.waived_iqd,
        NULL
      )
      ON CONFLICT (refund_case_id,revenue_ledger_id) DO NOTHING;
    END IF;

    FOR v_collection IN
      SELECT rc.id, rc.amount_iqd
      FROM public.mamnoon_revenue_collections rc
      WHERE rc.revenue_ledger_id = v_ledger.id
    LOOP
      INSERT INTO public.mamnoon_revenue_collection_reversals(
        revenue_collection_id,revenue_ledger_id,amount_iqd,reason,idempotency_key
      ) VALUES (
        v_collection.id,v_ledger.id,v_collection.amount_iqd,
        'استرداد كامل لطلب زين كاش',
        'zaincash-refund:' || v_case.id::text || ':' || v_collection.id::text
      )
      ON CONFLICT (revenue_collection_id) DO NOTHING;
    END LOOP;

    UPDATE public.mamnoon_revenue_ledger
    SET collected_iqd = 0,
        waived_iqd = assessed_iqd,
        status = 'void',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'void_reason','full_zaincash_refund',
          'refund_case_id',v_case.id,
          'commission_revenue_voided_iqd',GREATEST(v_ledger.assessed_iqd - v_ledger.waived_iqd,0),
          'refund_review_pending',false
        ),
        updated_at = now()
    WHERE id = v_ledger.id;
  END LOOP;
  END IF;

  UPDATE public.payment_transactions
  SET status = 'refunded',
      gateway_status = 'REFUNDED',
      metadata = metadata || jsonb_build_object(
        'refund_case_id',v_case.id,
        'refund_reference',btrim(p_refund_reference),
        'refunded_amount_iqd',v_case.amount_iqd,
        'refunded_at',coalesce(p_refunded_at,now())
      ),
      updated_at = now()
  WHERE id = v_payment.id;

  UPDATE public.mamnoon_zaincash_refund_cases
  SET status = 'refunded',
      refund_reference = btrim(p_refund_reference),
      refunded_amount_iqd = amount_iqd,
      refunded_by = p_actor_id,
      refunded_at = coalesce(p_refunded_at,now()),
      updated_at = now()
  WHERE id = v_case.id;

  INSERT INTO public.mamnoon_zaincash_refund_events(
    refund_case_id,event_type,actor_id,note,reference,amount_iqd
  ) VALUES (
    v_case.id,'refunded',p_actor_id,'تم تأكيد إعادة المبلغ يدوياً عبر زين كاش',
    btrim(p_refund_reference),v_case.amount_iqd
  );

  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  VALUES (
    v_case.customer_id,'zaincash_refund_completed','تم تسجيل استرداد مبلغك',
    'تم تسجيل إعادة المبلغ الخاص بالطلب ' || coalesce((SELECT request_code FROM public.service_requests WHERE id=v_case.request_id),v_case.request_id::text),
    '/request/' || v_case.request_id::text,
    jsonb_build_object('request_id',v_case.request_id,'refund_case_id',v_case.id,'amount_iqd',v_case.amount_iqd)
  );

  RETURN jsonb_build_object('ok',true,'duplicate',false,'refund_case_id',v_case.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_mark_zaincash_refund(uuid,text,uuid,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_zaincash_refund(uuid,text,uuid,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_revenue_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_summary jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'super_admin_required';
  END IF;

  SELECT jsonb_build_object(
    'assessed_iqd',COALESCE(SUM(assessed_iqd),0),
    'collected_iqd',COALESCE(SUM(collected_iqd),0),
    'waived_iqd',COALESCE(SUM(waived_iqd),0),
    'outstanding_iqd',COALESCE(SUM(assessed_iqd-collected_iqd-waived_iqd),0),
    'entry_count',COUNT(*)
  ) INTO v_summary
  FROM public.mamnoon_revenue_ledger
  WHERE status <> 'void'
    AND NOT (metadata @> '{"refund_review_pending": true}'::jsonb);

  RETURN v_summary || jsonb_build_object(
    'zaincash_debt_collected_iqd',
    (
      SELECT COALESCE(SUM(rc.amount_iqd),0)
      FROM public.mamnoon_revenue_collections rc
      WHERE NOT EXISTS (
        SELECT 1 FROM public.mamnoon_revenue_collection_reversals reversal
        WHERE reversal.revenue_collection_id = rc.id
      )
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_get_revenue_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_revenue_summary() TO authenticated;


COMMENT ON TABLE public.mamnoon_zaincash_refund_cases IS
  'Manual review queue for customer-cancelled paid ZainCash requests. No gateway refund is initiated automatically.';
