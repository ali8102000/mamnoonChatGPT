-- Exclude accounts that have provider roles even if they also carry a customer role.
-- Preserve all historical coupon redemptions and subsidy accounting.

CREATE OR REPLACE FUNCTION public.preview_my_coupon(p_code text,p_amount numeric)
RETURNS TABLE(coupon_id uuid,code text,discount numeric,payable numeric,type text,value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.coupons%rowtype; v_discount numeric;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role='customer')
    OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role IN ('driver','large_driver','worker')) THEN
   RAISE EXCEPTION 'الكوبونات مخصصة لحسابات الزبائن فقط ولا تشمل حسابات مقدمي الخدمة';
 END IF;
 IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'قيمة الطلب غير صالحة'; END IF;
 SELECT cp.* INTO c FROM public.coupons cp JOIN public.coupon_assignments ca ON ca.coupon_id=cp.id
 WHERE ca.user_id=auth.uid() AND upper(cp.code)=upper(trim(p_code)) AND cp.active=true
   AND (cp.expires_at IS NULL OR cp.expires_at>now()) AND cp.used_count<cp.max_uses AND p_amount>=cp.min_amount
   AND NOT EXISTS(SELECT 1 FROM public.coupon_redemptions cr WHERE cr.coupon_id=cp.id AND cr.user_id=auth.uid())
 LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'الكوبون غير متاح لحسابك أو منتهي أو لا يطابق شروط الطلب'; END IF;
 v_discount:=CASE WHEN c.type='percentage' THEN round(p_amount*c.value/100,2) ELSE least(p_amount,c.value) END;
 v_discount:=greatest(0,least(p_amount,v_discount));
 RETURN QUERY SELECT c.id,c.code,v_discount,p_amount-v_discount,c.type,c.value;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_coupon_to_new_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.coupons%rowtype; v_amount numeric; v_discount numeric;
BEGIN
 IF nullif(trim(new.coupon_code),'') IS NULL THEN
  new.coupon_code:=NULL; new.coupon_id:=NULL; new.coupon_discount:=0;
  new.customer_payable:=coalesce(new.price_estimate,new.customer_price); RETURN new;
 END IF;
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM new.customer_id THEN RAISE EXCEPTION 'غير مخوّل لاستخدام الكوبون'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=new.customer_id AND r.role='customer')
    OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=new.customer_id AND r.role IN ('driver','large_driver','worker')) THEN
  RAISE EXCEPTION 'الكوبونات مخصصة لحسابات الزبائن فقط ولا تشمل حسابات مقدمي الخدمة';
 END IF;
 IF new.type::text<>'taxi' OR coalesce(new.vehicle_category::text,'') NOT IN ('economy','premium','luxury') THEN
  RAISE EXCEPTION 'الكوبونات متاحة لطلبات التكسي العادي فقط ولا تشمل الفنيين أو سيارات الكيا والحمل';
 END IF;
 v_amount:=coalesce(new.price_estimate,new.customer_price);
 IF v_amount IS NULL OR v_amount<=0 THEN RAISE EXCEPTION 'لا يمكن تطبيق كوبون قبل تحديد سعر الطلب'; END IF;
 SELECT cp.* INTO c FROM public.coupons cp JOIN public.coupon_assignments ca ON ca.coupon_id=cp.id
 WHERE ca.user_id=new.customer_id AND upper(cp.code)=upper(trim(new.coupon_code)) AND cp.active=true
  AND (cp.expires_at IS NULL OR cp.expires_at>now()) AND cp.used_count<cp.max_uses AND v_amount>=cp.min_amount
  AND NOT EXISTS(SELECT 1 FROM public.coupon_redemptions cr WHERE cr.coupon_id=cp.id AND cr.user_id=new.customer_id)
 FOR UPDATE OF cp;
 IF NOT FOUND THEN RAISE EXCEPTION 'الكوبون غير متاح لحسابك أو منتهي أو لا يطابق شروط الطلب'; END IF;
 v_discount:=CASE WHEN c.type='percentage' THEN round(v_amount*c.value/100,2) ELSE least(v_amount,c.value) END;
 v_discount:=greatest(0,least(v_amount,v_discount));
 new.coupon_code:=c.code; new.coupon_id:=c.id; new.coupon_discount:=v_discount; new.customer_payable:=v_amount-v_discount;
 RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_coupons()
RETURNS TABLE(id uuid,code text,type text,value numeric,min_amount numeric,expires_at timestamptz,active boolean,assigned_at timestamptz,used boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 SELECT c.id,c.code,c.type,c.value,c.min_amount,c.expires_at,c.active,a.assigned_at,
  EXISTS(SELECT 1 FROM public.coupon_redemptions r WHERE r.coupon_id=c.id AND r.user_id=auth.uid()) AS used
 FROM public.coupon_assignments a JOIN public.coupons c ON c.id=a.coupon_id
 WHERE a.user_id=auth.uid()
  AND EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='customer')
  AND NOT EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('driver','large_driver','worker'))
 ORDER BY a.assigned_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.admin_coupon_audience_count(p_target text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count integer;
BEGIN
 PERFORM public.assert_staff('admin');
 IF p_target NOT IN ('customers','single','customers_1','customers_2','customers_3','customers_4','customers_5') THEN
  RAISE EXCEPTION 'فئة توزيع الكوبون يجب أن تكون من الزبائن فقط';
 END IF;
 IF p_target='single' THEN RETURN 1; END IF;
 IF p_target IN ('customers_1','customers_2','customers_3','customers_4','customers_5') THEN
  SELECT count(*) INTO v_count FROM public.profiles p
  WHERE EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer')
   AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role IN ('driver','large_driver','worker'))
   AND (CASE WHEN p_target='customers_5' THEN
    (SELECT count(*) FROM public.service_requests sr WHERE sr.customer_id=p.id AND sr.created_at>=now()-interval '7 days' AND sr.status::text<>'cancelled')>=5
   ELSE
    (SELECT count(*) FROM public.service_requests sr WHERE sr.customer_id=p.id AND sr.created_at>=now()-interval '7 days' AND sr.status::text<>'cancelled')=
    CASE p_target WHEN 'customers_1' THEN 1 WHEN 'customers_2' THEN 2 WHEN 'customers_3' THEN 3 ELSE 4 END
   END);
 ELSE
  SELECT count(*) INTO v_count FROM public.profiles p
  WHERE EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer')
   AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role IN ('driver','large_driver','worker'));
 END IF;
 RETURN coalesce(v_count,0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_distribute_coupon(p_coupon_id uuid,p_target text DEFAULT 'customers',p_single_user_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_coupon public.coupons%rowtype; v_count integer:=0;
BEGIN
 PERFORM public.assert_staff('admin');
 IF p_target NOT IN ('customers','single','customers_1','customers_2','customers_3','customers_4','customers_5') THEN
  RAISE EXCEPTION 'الكوبونات يمكن توزيعها على الزبائن فقط';
 END IF;
 IF p_target='single' AND p_single_user_id IS NULL THEN RAISE EXCEPTION 'حدد حساب زبون مطلوب'; END IF;
 SELECT * INTO v_coupon FROM public.coupons WHERE id=p_coupon_id AND active=true
  AND (expires_at IS NULL OR expires_at>now()) AND used_count<max_uses FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'الكوبون غير فعال أو منتهي الصلاحية أو مكتمل الاستخدام'; END IF;
 IF p_target='single' AND (
  NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p_single_user_id AND r.role='customer')
  OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p_single_user_id AND r.role IN ('driver','large_driver','worker'))
 ) THEN RAISE EXCEPTION 'المستخدم المحدد ليس حساب زبون'; END IF;
 WITH customer_activity AS (
  SELECT customer_id,count(*)::integer AS request_count FROM public.service_requests
  WHERE created_at>=now()-interval '7 days' AND status::text<>'cancelled' GROUP BY customer_id
 ), targets AS (
  SELECT p.id FROM public.profiles p LEFT JOIN customer_activity ca ON ca.customer_id=p.id
  WHERE EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='customer')
   AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role IN ('driver','large_driver','worker'))
   AND CASE p_target
    WHEN 'customers' THEN true WHEN 'single' THEN p.id=p_single_user_id
    WHEN 'customers_1' THEN coalesce(ca.request_count,0)=1
    WHEN 'customers_2' THEN coalesce(ca.request_count,0)=2
    WHEN 'customers_3' THEN coalesce(ca.request_count,0)=3
    WHEN 'customers_4' THEN coalesce(ca.request_count,0)=4
    WHEN 'customers_5' THEN coalesce(ca.request_count,0)>=5 ELSE false END
 ), inserted AS (
  INSERT INTO public.coupon_assignments(coupon_id,user_id,assigned_by)
  SELECT p_coupon_id,id,auth.uid() FROM targets ON CONFLICT(coupon_id,user_id) DO NOTHING RETURNING user_id
 ), notified AS (
  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  SELECT i.user_id,'coupon_received','وصلك كوبون من ممنون 🎁',
   'الكود: '||v_coupon.code||' — '||
   CASE WHEN v_coupon.type='percentage' THEN trim(to_char(v_coupon.value,'FM999990.##'))||'% خصم'
    ELSE trim(to_char(v_coupon.value,'FM999999990'))||' دينار خصم' END,
   '/coupons',jsonb_build_object('coupon_id',v_coupon.id,'code',v_coupon.code,'type',v_coupon.type,'value',v_coupon.value,'expires_at',v_coupon.expires_at)
  FROM inserted i RETURNING id
 ) SELECT count(*) INTO v_count FROM inserted;
 PERFORM public.log_admin_action('distribute_coupon','coupon',p_coupon_id::text,jsonb_build_object('target',p_target,'sent',v_count,'activity_window','7 days'));
 RETURN v_count;
END;
$function$;

DELETE FROM public.coupon_assignments ca
WHERE NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=ca.user_id AND r.role='customer')
 OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=ca.user_id AND r.role IN ('driver','large_driver','worker'));

REVOKE ALL ON FUNCTION public.preview_my_coupon(text,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.apply_coupon_to_new_request() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_coupons() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_coupon_audience_count(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_distribute_coupon(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_my_coupon(text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_coupons() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_coupon_audience_count(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_distribute_coupon(uuid,text,uuid) TO authenticated;
