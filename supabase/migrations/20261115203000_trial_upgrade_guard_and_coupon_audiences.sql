-- Lock trial subscriptions to the bronze trial until a verified payment or an explicit admin grant.
CREATE OR REPLACE FUNCTION public.guard_trial_subscription_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_trial IS TRUE
     AND (NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.is_trial IS DISTINCT FROM OLD.is_trial) THEN
    IF NEW.grant_type = 'paid' AND coalesce(auth.role(), '') = 'service_role' THEN
      RETURN NEW;
    END IF;
    IF NEW.grant_type = 'admin' AND auth.uid() IS NOT NULL
       AND public.has_admin_access(auth.uid()) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'trial_subscription_upgrade_requires_payment'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_trial_subscription_upgrade ON public.user_subscriptions;
CREATE TRIGGER trg_guard_trial_subscription_upgrade
BEFORE UPDATE OF plan_id, is_trial, grant_type ON public.user_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.guard_trial_subscription_upgrade();

REVOKE ALL ON FUNCTION public.guard_trial_subscription_upgrade() FROM PUBLIC, anon, authenticated;

-- Add two safe, mutually exclusive coupon audiences:
-- new profiles from the last 24 hours, and users who have never received a coupon.
CREATE OR REPLACE FUNCTION public.admin_coupon_audience_count(p_target text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  PERFORM public.assert_staff('admin');
  IF p_target NOT IN ('all','customers','drivers','workers','single',
    'customers_1','customers_2','customers_3','customers_4','customers_5',
    'new_users_24h','users_without_coupon') THEN
    RAISE EXCEPTION 'فئة التوزيع غير صحيحة';
  END IF;
  IF p_target = 'single' THEN RETURN 1; END IF;

  IF p_target IN ('customers_1','customers_2','customers_3','customers_4','customers_5') THEN
    SELECT count(*) INTO v_count
    FROM public.profiles p
    WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer')
      AND (
        CASE WHEN p_target='customers_5' THEN
          (SELECT count(*) FROM public.service_requests sr WHERE sr.customer_id=p.id AND sr.created_at >= now()-interval '7 days' AND sr.status::text <> 'cancelled') >= 5
        ELSE
          (SELECT count(*) FROM public.service_requests sr WHERE sr.customer_id=p.id AND sr.created_at >= now()-interval '7 days' AND sr.status::text <> 'cancelled') =
          CASE p_target WHEN 'customers_1' THEN 1 WHEN 'customers_2' THEN 2 WHEN 'customers_3' THEN 3 WHEN 'customers_4' THEN 4 END
        END
      );
  ELSE
    SELECT count(*) INTO v_count
    FROM public.profiles p
    WHERE CASE p_target
      WHEN 'all' THEN true
      WHEN 'customers' THEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer')
      WHEN 'drivers' THEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='driver')
      WHEN 'workers' THEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='worker')
      WHEN 'new_users_24h' THEN p.created_at >= now()-interval '24 hours'
      WHEN 'users_without_coupon' THEN NOT EXISTS (SELECT 1 FROM public.coupon_assignments ca WHERE ca.user_id=p.id)
      ELSE false END;
  END IF;
  RETURN coalesce(v_count,0);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_distribute_coupon(
  p_coupon_id uuid,
  p_target text DEFAULT 'all',
  p_single_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_coupon public.coupons%ROWTYPE; v_count integer := 0;
BEGIN
  PERFORM public.assert_staff('admin');
  IF p_target NOT IN ('all','customers','drivers','workers','single',
    'customers_1','customers_2','customers_3','customers_4','customers_5',
    'new_users_24h','users_without_coupon') THEN
    RAISE EXCEPTION 'فئة التوزيع غير صحيحة';
  END IF;
  IF p_target='single' AND p_single_user_id IS NULL THEN RAISE EXCEPTION 'حدد المستخدم المطلوب'; END IF;

  SELECT * INTO v_coupon FROM public.coupons
  WHERE id=p_coupon_id AND active=true AND (expires_at IS NULL OR expires_at>now())
    AND used_count<max_uses FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الكوبون غير فعال أو منتهي الصلاحية أو مكتمل الاستخدام'; END IF;

  WITH customer_activity AS (
    SELECT customer_id,count(*)::integer request_count
    FROM public.service_requests
    WHERE created_at>=now()-interval '7 days' AND status::text<>'cancelled'
    GROUP BY customer_id
  ), targets AS (
    SELECT p.id FROM public.profiles p LEFT JOIN customer_activity ca ON ca.customer_id=p.id
    WHERE CASE p_target
      WHEN 'all' THEN true
      WHEN 'customers' THEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer')
      WHEN 'drivers' THEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='driver')
      WHEN 'workers' THEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='worker')
      WHEN 'single' THEN p.id=p_single_user_id
      WHEN 'customers_1' THEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer') AND coalesce(ca.request_count,0)=1
      WHEN 'customers_2' THEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer') AND coalesce(ca.request_count,0)=2
      WHEN 'customers_3' THEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer') AND coalesce(ca.request_count,0)=3
      WHEN 'customers_4' THEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer') AND coalesce(ca.request_count,0)=4
      WHEN 'customers_5' THEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer') AND coalesce(ca.request_count,0)>=5
      WHEN 'new_users_24h' THEN p.created_at>=now()-interval '24 hours'
      WHEN 'users_without_coupon' THEN NOT EXISTS(SELECT 1 FROM public.coupon_assignments ca2 WHERE ca2.user_id=p.id)
      ELSE false END
  ), inserted AS (
    INSERT INTO public.coupon_assignments(coupon_id,user_id,assigned_by)
    SELECT p_coupon_id,id,auth.uid() FROM targets
    ON CONFLICT(coupon_id,user_id) DO NOTHING
    RETURNING user_id
  ), notified AS (
    INSERT INTO public.notifications(user_id,type,title,body,link,data)
    SELECT i.user_id,'coupon_received','وصلك كوبون من ممنون 🎁',
      'الكود: '||v_coupon.code||' — '||
      CASE WHEN v_coupon.type='percentage'
        THEN trim(to_char(v_coupon.value,'FM999990.##'))||'% خصم'
        ELSE trim(to_char(v_coupon.value,'FM999999990'))||' دينار خصم' END,
      '/coupons',
      jsonb_build_object('coupon_id',v_coupon.id,'code',v_coupon.code,'type',v_coupon.type,
        'value',v_coupon.value,'expires_at',v_coupon.expires_at)
    FROM inserted i
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM inserted;

  PERFORM public.log_admin_action('distribute_coupon','coupon',p_coupon_id::text,
    jsonb_build_object('target',p_target,'sent',v_count));
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_coupon_audience_count(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_coupon_audience_count(text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_distribute_coupon(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_distribute_coupon(uuid,text,uuid) TO authenticated;
