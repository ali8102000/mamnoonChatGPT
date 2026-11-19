-- Allow explicitly delegated global subscription managers to use the same
-- subscription RPCs as platform admins. Regional grants are intentionally not
-- accepted here because the current subscription administration UI operates
-- across the entire platform and does not filter by governorate.

CREATE OR REPLACE FUNCTION public.admin_grant_subscription(p_user_id uuid,p_plan_code text,p_duration text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
  v_plan_name text;
  v_subscription_id uuid;
  v_start timestamptz := now();
  v_end timestamptz;
  v_duration_label text;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission('subscriptions.manage','global',NULL)
  ) THEN RAISE EXCEPTION 'permission_required:subscriptions.manage'; END IF;

  IF p_user_id IS NULL OR p_plan_code IS NULL OR p_duration IS NULL
     OR p_duration NOT IN ('month','two_months','year','permanent') THEN
    RAISE EXCEPTION 'invalid_duration_or_user';
  END IF;

  SELECT id,name_ar INTO v_plan_id,v_plan_name
  FROM public.subscription_plans WHERE code=p_plan_code AND is_active LIMIT 1;
  IF v_plan_id IS NULL THEN RAISE EXCEPTION 'plan_not_found'; END IF;

  v_end := CASE p_duration
    WHEN 'month' THEN v_start + interval '1 month'
    WHEN 'two_months' THEN v_start + interval '2 months'
    WHEN 'year' THEN v_start + interval '1 year'
    ELSE NULL END;

  v_duration_label := CASE p_duration
    WHEN 'month' THEN 'شهر واحد'
    WHEN 'two_months' THEN 'شهرين'
    WHEN 'year' THEN 'سنة واحدة'
    ELSE 'اشتراك دائم' END;

  INSERT INTO public.user_subscriptions
    (user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,
     request_count,resets_count_period_start,auto_renew,is_trial,trial_started_at,trial_ends_at,
     granted_by,grant_type,cancel_at_period_end,cancelled_at,provider_types)
  VALUES
    (p_user_id,v_plan_id,'active','monthly',v_start,v_end,0,v_start,false,false,NULL,NULL,
     auth.uid(),'admin',false,NULL,public.mamnoon_provider_kinds(p_user_id))
  ON CONFLICT (user_id) DO UPDATE SET
    plan_id=excluded.plan_id,status='active',billing_cycle='monthly',
    current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    request_count=0,resets_count_period_start=excluded.resets_count_period_start,auto_renew=false,
    is_trial=false,trial_started_at=NULL,trial_ends_at=NULL,granted_by=auth.uid(),
    grant_type='admin',cancel_at_period_end=false,cancelled_at=NULL,
    provider_types=excluded.provider_types,updated_at=now()
  RETURNING id INTO v_subscription_id;

  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  VALUES (
    p_user_id,'subscription_granted','ممنون منحك اشتراكاً مجانياً',
    'تم منحك باقة '||v_plan_name||' لمدة '||v_duration_label||
      CASE WHEN v_end IS NULL THEN '.' ELSE '، وينتهي اشتراكك بتاريخ '||
        to_char(v_end AT TIME ZONE 'Asia/Baghdad','YYYY-MM-DD HH24:MI')||'.' END||
      ' استمتع بمزايا اشتراكك في ممنون.',
    '/profile',
    jsonb_build_object('subscription_id',v_subscription_id,'plan_code',p_plan_code,
      'plan_name',v_plan_name,'duration',p_duration,'granted_by',auth.uid(),'expires_at',v_end)
  );
  RETURN v_subscription_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_subscription_status(p_user_id uuid,p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_sub public.user_subscriptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission('subscriptions.manage','global',NULL)
  ) THEN RAISE EXCEPTION 'permission_required:subscriptions.manage'; END IF;

  IF p_user_id IS NULL OR p_status IS NULL OR p_status NOT IN ('active','paused','cancelled') THEN
    RAISE EXCEPTION 'invalid_subscription_status';
  END IF;

  SELECT * INTO v_sub FROM public.user_subscriptions WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_status='active' AND v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end<=now() THEN
    RAISE EXCEPTION 'subscription_period_expired';
  END IF;

  UPDATE public.user_subscriptions
  SET status=p_status,
      paused_at=CASE WHEN p_status='paused' THEN now() ELSE NULL END,
      cancelled_at=CASE WHEN p_status='cancelled' THEN now() ELSE NULL END,
      cancel_at_period_end=false,updated_at=now()
  WHERE id=v_sub.id;

  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  VALUES(p_user_id,'subscription_admin_updated',
    CASE p_status WHEN 'paused' THEN 'تم إيقاف اشتراكك من إدارة ممنون'
      WHEN 'active' THEN 'تم تفعيل اشتراكك من إدارة ممنون' ELSE 'تم إيقاف اشتراكك من إدارة ممنون' END,
    CASE p_status WHEN 'paused' THEN 'تم إيقاف الاشتراك مؤقتاً ولن تستقبل طلبات جديدة حتى إعادة تفعيله.'
      WHEN 'active' THEN 'تم إعادة تفعيل اشتراكك ويمكنك استقبال الطلبات الجديدة.'
      ELSE 'تم إيقاف الاشتراك. تواصل مع الدعم إذا كنت تعتقد أن هذا الإجراء غير صحيح.' END,
    '/profile',jsonb_build_object('subscription_id',v_sub.id,'status',p_status,'changed_by',auth.uid()));
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_extend_subscription(p_user_id uuid,p_days integer)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_sub public.user_subscriptions%ROWTYPE; v_end timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission('subscriptions.manage','global',NULL)
  ) THEN RAISE EXCEPTION 'permission_required:subscriptions.manage'; END IF;

  IF p_user_id IS NULL OR p_days IS NULL OR p_days<1 OR p_days>3650 THEN
    RAISE EXCEPTION 'invalid_extension_days';
  END IF;
  SELECT * INTO v_sub FROM public.user_subscriptions WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription_not_found'; END IF;

  v_end:=greatest(coalesce(v_sub.current_period_end,now()),now())+make_interval(days=>p_days);
  UPDATE public.user_subscriptions SET current_period_end=v_end,status='active',paused_at=NULL,
    cancelled_at=NULL,cancel_at_period_end=false,updated_at=now() WHERE id=v_sub.id;

  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  VALUES(p_user_id,'subscription_extended','ممنون مدد اشتراكك',
    'تم تمديد اشتراكك لمدة '||p_days||' يوم. تاريخ الانتهاء الجديد: '||
      to_char(v_end AT TIME ZONE 'Asia/Baghdad','YYYY-MM-DD HH24:MI')||'.',
    '/profile',jsonb_build_object('subscription_id',v_sub.id,'extension_days',p_days,
      'expires_at',v_end,'changed_by',auth.uid()));
  RETURN v_end;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_pause_all_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission('subscriptions.manage','global',NULL)
  ) THEN RAISE EXCEPTION 'permission_required:subscriptions.manage'; END IF;

  WITH changed AS (
    UPDATE public.user_subscriptions SET status='paused',paused_at=now(),
      cancel_at_period_end=false,updated_at=now()
    WHERE status='active' RETURNING user_id,id
  ), notices AS (
    INSERT INTO public.notifications(user_id,type,title,body,link,data)
    SELECT user_id,'subscription_admin_updated','تم إيقاف الاشتراك من إدارة ممنون',
      'تم إيقاف الاشتراك مؤقتاً من إدارة ممنون ولن تستقبل طلبات جديدة حتى إعادة تفعيله.',
      '/profile',jsonb_build_object('status','paused','bulk',true,'changed_by',auth.uid())
    FROM changed RETURNING id
  )
  SELECT count(*) INTO v_count FROM changed;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_grant_subscriptions_bulk(p_user_ids uuid[],p_plan_code text,p_duration text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_uid uuid;v_count integer:=0;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission('subscriptions.manage','global',NULL)
  ) THEN RAISE EXCEPTION 'permission_required:subscriptions.manage'; END IF;

  IF p_user_ids IS NULL OR cardinality(p_user_ids)=0 OR cardinality(p_user_ids)>500 THEN
    RAISE EXCEPTION 'invalid_user_selection';
  END IF;
  FOR v_uid IN SELECT DISTINCT unnest(p_user_ids) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_uid
      AND role::text IN ('worker','driver','large_driver')) THEN
      RAISE EXCEPTION 'not_a_provider:%',v_uid;
    END IF;
    PERFORM public.admin_grant_subscription(v_uid,p_plan_code,p_duration);
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_broadcast_announcement(p_target text,p_title text,p_body text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission('subscriptions.manage','global',NULL)
  ) THEN RAISE EXCEPTION 'permission_required:subscriptions.manage'; END IF;

  IF p_target IS NULL OR p_target NOT IN ('all','worker','large_driver','driver') THEN
    RAISE EXCEPTION 'invalid_announcement_target';
  END IF;
  IF length(trim(coalesce(p_title,'')))<2 OR length(trim(coalesce(p_title,'')))>100
     OR length(trim(coalesce(p_body,'')))<2 OR length(trim(coalesce(p_body,'')))>1500 THEN
    RAISE EXCEPTION 'invalid_announcement_content';
  END IF;

  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  SELECT p.id,'company_announcement',trim(p_title),trim(p_body),'/profile',
    jsonb_build_object('target',p_target,'expires_at',now()+interval '24 hours',
      'official',true,'sent_by',auth.uid())
  FROM public.profiles p
  WHERE p_target='all' OR EXISTS(
    SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role::text=p_target
  );
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$function$;
