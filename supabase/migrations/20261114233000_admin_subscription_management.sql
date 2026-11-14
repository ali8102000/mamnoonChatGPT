CREATE OR REPLACE FUNCTION public.admin_set_subscription_status(p_user_id uuid,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sub public.user_subscriptions%ROWTYPE;
BEGIN
  PERFORM public.assert_staff('admin');
  IF p_status NOT IN ('active','paused','cancelled') THEN RAISE EXCEPTION 'invalid_subscription_status'; END IF;
  SELECT * INTO v_sub FROM public.user_subscriptions WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_status='active' AND v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end<=now() THEN RAISE EXCEPTION 'subscription_period_expired'; END IF;
  UPDATE public.user_subscriptions SET status=p_status,paused_at=CASE WHEN p_status='paused' THEN now() ELSE NULL END,
    cancelled_at=CASE WHEN p_status='cancelled' THEN now() ELSE NULL END,cancel_at_period_end=false,updated_at=now()
  WHERE id=v_sub.id;
  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  VALUES(p_user_id,'subscription_admin_updated',
    CASE p_status WHEN 'paused' THEN 'تم إيقاف اشتراكك من إدارة ممنون' WHEN 'active' THEN 'تم تفعيل اشتراكك من إدارة ممنون' ELSE 'تم إيقاف اشتراكك من إدارة ممنون' END,
    CASE p_status WHEN 'paused' THEN 'تم إيقاف الاشتراك مؤقتاً ولن تستقبل طلبات جديدة حتى إعادة تفعيله.' WHEN 'active' THEN 'تم إعادة تفعيل اشتراكك ويمكنك استقبال الطلبات الجديدة.' ELSE 'تم إيقاف الاشتراك. تواصل مع الدعم إذا كنت تعتقد أن هذا الإجراء غير صحيح.' END,
    '/profile',jsonb_build_object('subscription_id',v_sub.id,'status',p_status,'changed_by',auth.uid()));
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_extend_subscription(p_user_id uuid,p_days integer)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sub public.user_subscriptions%ROWTYPE; v_end timestamptz;
BEGIN
  PERFORM public.assert_staff('admin');
  IF p_days IS NULL OR p_days<1 OR p_days>3650 THEN RAISE EXCEPTION 'invalid_extension_days'; END IF;
  SELECT * INTO v_sub FROM public.user_subscriptions WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription_not_found'; END IF;
  v_end:=greatest(coalesce(v_sub.current_period_end,now()),now())+make_interval(days=>p_days);
  UPDATE public.user_subscriptions SET current_period_end=v_end,status='active',paused_at=NULL,cancelled_at=NULL,
    cancel_at_period_end=false,updated_at=now() WHERE id=v_sub.id;
  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  VALUES(p_user_id,'subscription_extended','ممنون مدد اشتراكك',
    'تم تمديد اشتراكك لمدة '||p_days||' يوم. تاريخ الانتهاء الجديد: '||to_char(v_end AT TIME ZONE 'Asia/Baghdad','YYYY-MM-DD HH24:MI')||'.',
    '/profile',jsonb_build_object('subscription_id',v_sub.id,'extension_days',p_days,'expires_at',v_end,'changed_by',auth.uid()));
  RETURN v_end;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_subscription_status(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_extend_subscription(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_subscription_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_subscription(uuid,integer) TO authenticated;