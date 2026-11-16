-- Server-authoritative routing and pricing for automatically priced taxi categories only.
CREATE TABLE IF NOT EXISTS public.pricing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL CHECK (service_type IN ('economy','premium','luxury')),
  is_intercity boolean NOT NULL DEFAULT false,
  base_fare numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_fare >= 0),
  per_km_rate numeric(12,2) NOT NULL CHECK (per_km_rate >= 0),
  per_min_rate numeric(12,2) NOT NULL DEFAULT 0 CHECK (per_min_rate >= 0),
  min_fare numeric(12,2) NOT NULL DEFAULT 0 CHECK (min_fare >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_type, is_intercity)
);

ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_settings FROM anon, authenticated;
GRANT SELECT ON public.pricing_settings TO authenticated;
DROP POLICY IF EXISTS "Authenticated users can read taxi pricing" ON public.pricing_settings;
CREATE POLICY "Authenticated users can read taxi pricing"
  ON public.pricing_settings FOR SELECT TO authenticated USING (true);

INSERT INTO public.pricing_settings
  (service_type,is_intercity,base_fare,per_km_rate,per_min_rate,min_fare)
VALUES
  ('economy',false,0,400,0,0),
  ('premium',false,0,400,0,0),
  ('luxury',false,0,400,0,0),
  ('economy',true,0,187.5,0,0),
  ('premium',true,0,187.5,0,0),
  ('luxury',true,0,187.5,0,0)
ON CONFLICT (service_type,is_intercity) DO NOTHING;

-- Only the authenticated Edge Function using the service role may create
-- automatically priced taxi requests. Large vehicles keep their existing flow.
CREATE OR REPLACE FUNCTION public.prepare_taxi_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
  v_base numeric;
  v_raw numeric;
  v_tier_multiplier numeric := 1;
  v_trip_multiplier numeric := 1;
  v_extra_time_fare numeric := 0;
  v_base_fare numeric;
  v_per_min_rate numeric;
  v_min_fare numeric;
BEGIN
  IF NEW.type <> 'taxi' THEN RETURN NEW; END IF;

  NEW.trip_type := COALESCE(NEW.trip_type, 'one_way');
  NEW.extra_minutes := COALESCE(NEW.extra_minutes, 0);
  IF NEW.trip_type NOT IN ('one_way','round_trip','second_trip','stop') THEN
    RAISE EXCEPTION 'نوع الرحلة غير صالح';
  END IF;
  IF NEW.extra_minutes < 0 OR NEW.extra_minutes > 120 OR NEW.extra_minutes % 5 <> 0 THEN
    RAISE EXCEPTION 'وقت الانتظار يجب أن يكون من 5 إلى 120 دقيقة وبفواصل 5 دقائق';
  END IF;

  IF NEW.vehicle_category::text = 'large' THEN
    NEW.vehicle_type := COALESCE(NEW.vehicle_type,
      CASE WHEN COALESCE(NEW.notes,'') ILIKE '%كيا ركاب%' THEN 'kia_passenger' ELSE 'kia_cargo' END);
    IF NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL THEN
      RAISE EXCEPTION 'نقطة الانطلاق مطلوبة';
    END IF;
    NEW.distance_km := NULL;
    NEW.duration_min := NULL;
    NEW.price_estimate := NULL;
    NEW.commission := 0;
    NEW.status := 'searching';
    NEW.searching_started_at := now();
    NEW.pricing_mode := CASE WHEN NEW.customer_price IS NOT NULL THEN 'fixed' ELSE 'negotiable' END;
    RETURN NEW;
  END IF;

  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'أنشئ طلب التاكسي من خدمة التسعير الآمنة';
  END IF;

  NEW.vehicle_type := NULL;
  IF NEW.distance_km IS NULL OR NEW.distance_km <= 0 OR NEW.duration_min IS NULL
     OR NEW.duration_min < 0 OR NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL
     OR NEW.dest_lat IS NULL OR NEW.dest_lng IS NULL THEN
    RAISE EXCEPTION 'بيانات الطريق غير مكتملة';
  END IF;

  SELECT base_fare, per_km_rate, per_min_rate, min_fare
    INTO v_base_fare, v_rate, v_per_min_rate, v_min_fare
    FROM public.pricing_settings
    WHERE service_type = NEW.vehicle_category::text
      AND is_intercity = COALESCE(NEW.is_intercity,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'إعدادات تسعير هذه الفئة غير متوفرة'; END IF;

  v_base := v_base_fare + (NEW.distance_km * v_rate) + (NEW.duration_min * v_per_min_rate);
  IF NEW.vehicle_category::text = 'premium' THEN
    v_tier_multiplier := CASE
      WHEN COALESCE(NEW.is_intercity,false) THEN 1.05
      ELSE 1.10 - 0.05 * LEAST(1,GREATEST(0,(v_base - 4500)/1000))
    END;
  ELSIF NEW.vehicle_category::text = 'luxury' THEN
    v_tier_multiplier := CASE
      WHEN COALESCE(NEW.is_intercity,false) THEN 1.10
      ELSE 1.25 - 0.15 * LEAST(1,GREATEST(0,(v_base - 4500)/1000))
    END;
  END IF;
  IF NEW.trip_type IN ('round_trip','second_trip') THEN
    v_trip_multiplier := CASE WHEN NEW.trip_type = 'round_trip' THEN 1.8 ELSE 2 END;
  END IF;
  v_extra_time_fare := ceil(NEW.extra_minutes::numeric / 5) * 500;
  v_raw := v_base * v_tier_multiplier * v_trip_multiplier + v_extra_time_fare;
  IF NEW.trip_type = 'round_trip' THEN v_raw := v_base * v_tier_multiplier * 2 * 0.9 + v_extra_time_fare; END IF;

  NEW.price_estimate := GREATEST(v_min_fare, ceil(v_raw / 250) * 250);
  NEW.commission := 0;
  NEW.status := 'searching';
  NEW.searching_started_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_taxi_request() FROM PUBLIC, anon, authenticated;

-- Coupon redemption for Edge-created taxi requests. The customer JWT is checked
-- here so service-role insertion never has to impersonate the customer.
CREATE OR REPLACE FUNCTION public.prevent_request_coupon_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.allow_coupon_update', true) = 'on'
     AND auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;
  IF NEW.coupon_code IS DISTINCT FROM OLD.coupon_code
     OR NEW.coupon_id IS DISTINCT FROM OLD.coupon_id
     OR NEW.coupon_discount IS DISTINCT FROM OLD.coupon_discount
     OR NEW.customer_payable IS DISTINCT FROM OLD.customer_payable THEN
    RAISE EXCEPTION 'لا يمكن تعديل الكوبون أو الخصم بعد إرسال الطلب';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_coupon_to_existing_request(
  p_request_id uuid,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.service_requests%ROWTYPE;
  v_coupon public.coupons%ROWTYPE;
  v_amount numeric;
  v_discount numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'سجّل الدخول أولاً'; END IF;
  SELECT * INTO v_request FROM public.service_requests
   WHERE id = p_request_id AND customer_id = auth.uid()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الطلب غير موجود أو لا تملك صلاحية تعديله'; END IF;
  IF v_request.type::text <> 'taxi'
     OR COALESCE(v_request.vehicle_category::text,'') NOT IN ('economy','premium','luxury')
     OR v_request.status::text NOT IN ('pending','searching')
     OR v_request.coupon_id IS NOT NULL THEN
    RAISE EXCEPTION 'الكوبون غير متاح لهذا الطلب';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role='customer')
     OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role IN ('driver','worker')) THEN
    RAISE EXCEPTION 'الكوبونات مخصصة لحسابات الزبائن فقط';
  END IF;
  v_amount := COALESCE(v_request.price_estimate,v_request.customer_price);
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'سعر الطلب غير صالح'; END IF;

  SELECT cp.* INTO v_coupon
    FROM public.coupons cp
    JOIN public.coupon_assignments ca ON ca.coupon_id=cp.id
   WHERE ca.user_id=auth.uid()
     AND upper(cp.code)=upper(trim(p_code))
     AND cp.active=true
     AND (cp.expires_at IS NULL OR cp.expires_at>now())
     AND cp.used_count<cp.max_uses
     AND v_amount>=cp.min_amount
     AND NOT EXISTS (
       SELECT 1 FROM public.coupon_redemptions cr
        WHERE cr.coupon_id=cp.id AND cr.user_id=auth.uid()
     )
   FOR UPDATE OF cp;
  IF NOT FOUND THEN RAISE EXCEPTION 'الكوبون غير متاح لحسابك أو منتهي أو لا يطابق شروط الطلب'; END IF;

  v_discount := CASE WHEN v_coupon.type='percentage'
    THEN round(v_amount*v_coupon.value/100,2)
    ELSE least(v_amount,v_coupon.value) END;
  v_discount := greatest(0,least(v_amount,v_discount));

  PERFORM set_config('app.allow_coupon_update','on',true);
  UPDATE public.service_requests
     SET coupon_code=v_coupon.code,coupon_id=v_coupon.id,
         coupon_discount=v_discount,customer_payable=v_amount-v_discount
   WHERE id=p_request_id;

  INSERT INTO public.coupon_redemptions(coupon_id,user_id,request_id,discount_amount)
  VALUES(v_coupon.id,auth.uid(),p_request_id,v_discount);
  UPDATE public.coupons SET used_count=used_count+1,updated_at=now() WHERE id=v_coupon.id;
  INSERT INTO public.coupon_subsidy_ledger(request_id,coupon_id,customer_id,discount_amount,currency,status)
  VALUES(p_request_id,v_coupon.id,auth.uid(),v_discount,'IQD','pending_completion');
  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  VALUES(auth.uid(),'coupon_redeemed','تم تطبيق الكوبون 🎉',
    'تم خصم '||trim(to_char(v_discount,'FM999999990.##'))||' د.ع من طلبك',
    '/request/'||p_request_id,
    jsonb_build_object('coupon_id',v_coupon.id,'request_id',p_request_id,'discount',v_discount,'payable',v_amount-v_discount));

  RETURN jsonb_build_object('discount',v_discount,'payable',v_amount-v_discount,'coupon_id',v_coupon.id);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_coupon_to_existing_request(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_coupon_to_existing_request(uuid,text) TO authenticated;
