
CREATE OR REPLACE FUNCTION public.admin_pause_all_subscriptions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN
  PERFORM public.assert_staff('admin');
  WITH changed AS (
    UPDATE public.user_subscriptions SET status='paused',paused_at=now(),cancel_at_period_end=false,updated_at=now()
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
END; $$;

CREATE OR REPLACE FUNCTION public.admin_grant_subscriptions_bulk(p_user_ids uuid[],p_plan_code text,p_duration text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid;v_count integer:=0;
BEGIN
  PERFORM public.assert_staff('admin');
  IF p_user_ids IS NULL OR cardinality(p_user_ids)=0 OR cardinality(p_user_ids)>500 THEN RAISE EXCEPTION 'invalid_user_selection'; END IF;
  FOR v_uid IN SELECT DISTINCT unnest(p_user_ids) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_uid AND role::text IN ('worker','driver','large_driver')) THEN RAISE EXCEPTION 'not_a_provider:%',v_uid; END IF;
    PERFORM public.admin_grant_subscription(v_uid,p_plan_code,p_duration);
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_broadcast_announcement(p_target text,p_title text,p_body text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN
  PERFORM public.assert_staff('admin');
  IF p_target NOT IN ('all','worker','large_driver','driver') THEN RAISE EXCEPTION 'invalid_announcement_target'; END IF;
  IF length(trim(coalesce(p_title,'')))<2 OR length(trim(coalesce(p_title,'')))>100 OR length(trim(coalesce(p_body,'')))<2 OR length(trim(coalesce(p_body,'')))>1500 THEN RAISE EXCEPTION 'invalid_announcement_content'; END IF;
  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  SELECT p.id,'company_announcement',trim(p_title),trim(p_body),'/profile',
    jsonb_build_object('target',p_target,'expires_at',now()+interval '24 hours','official',true,'sent_by',auth.uid())
  FROM public.profiles p
  WHERE p_target='all' OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role::text=p_target);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.admin_pause_all_subscriptions() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_grant_subscriptions_bulk(uuid[],text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_broadcast_announcement(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pause_all_subscriptions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_subscriptions_bulk(uuid[],text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_announcement(text,text,text) TO authenticated;
