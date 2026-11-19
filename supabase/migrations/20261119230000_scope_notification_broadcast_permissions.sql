-- Require the same granular notification permission for both Edge Function
-- calls and direct authenticated RPC calls. Platform admins retain full access;
-- delegated staff are constrained to the selected user's/governorate's scope.

CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(
  p_target text,
  p_title text,
  p_body text,
  p_single_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_target_governorate text;
  v_scope_type text := 'global';
BEGIN
  IF p_target IS NULL OR p_target NOT IN ('all','drivers','large_drivers','workers','customers','single') THEN
    RAISE EXCEPTION 'invalid_notification_target';
  END IF;

  IF p_target = 'single' THEN
    SELECT governorate_key INTO v_target_governorate
    FROM public.profiles
    WHERE id = p_single_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'notification_user_not_found';
    END IF;

    IF v_target_governorate IS NOT NULL THEN
      v_scope_type := 'governorate';
    END IF;
  END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission(
      'notifications.send',
      v_scope_type,
      v_target_governorate
    )
  ) THEN
    RAISE EXCEPTION 'permission_required:notifications.send';
  END IF;

  IF length(trim(coalesce(p_title,''))) < 1 OR length(trim(p_title)) > 200
     OR length(trim(coalesce(p_body,''))) < 1 OR length(trim(p_body)) > 2000 THEN
    RAISE EXCEPTION 'invalid_notification_content';
  END IF;

  IF p_target = 'single' AND p_single_user_id IS NULL THEN
    RAISE EXCEPTION 'notification_user_required';
  END IF;

  INSERT INTO public.notifications(user_id,type,title,body)
  SELECT p.id,'broadcast',trim(p_title),trim(p_body)
  FROM public.profiles p
  WHERE CASE p_target
    WHEN 'all' THEN true
    WHEN 'drivers' THEN EXISTS(
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id=p.id AND r.role::text='driver'
    )
    WHEN 'large_drivers' THEN EXISTS(
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id=p.id AND r.role::text='large_driver'
    )
    WHEN 'workers' THEN EXISTS(
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id=p.id AND r.role::text='worker'
    )
    WHEN 'customers' THEN EXISTS(
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id=p.id AND r.role::text='customer'
    )
    WHEN 'single' THEN p.id=p_single_user_id
    ELSE false
  END;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public.log_admin_action(
    'broadcast_notification',
    'notification',
    p_target,
    jsonb_build_object('title',trim(p_title),'sent',v_count)
  );

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_broadcast_governorate_notification(
  p_governorate_key text,
  p_title text,
  p_body text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission(
      'notifications.send',
      'governorate',
      p_governorate_key
    )
  ) THEN
    RAISE EXCEPTION 'permission_required:notifications.send';
  END IF;

  IF p_governorate_key NOT IN (
    'baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
    'najaf','karbala','babil','anbar','diyala','saladin','wasit',
    'dhiqar','maysan','muthanna','qadisiyah'
  ) THEN
    RAISE EXCEPTION 'invalid_governorate';
  END IF;

  IF length(trim(coalesce(p_title,''))) < 1 OR length(trim(p_title)) > 200
     OR length(trim(coalesce(p_body,''))) < 1 OR length(trim(p_body)) > 2000 THEN
    RAISE EXCEPTION 'invalid_notification_content';
  END IF;

  INSERT INTO public.notifications(user_id,type,title,body,data)
  SELECT p.id,'broadcast',trim(p_title),trim(p_body),
    jsonb_build_object('target','governorate','governorate_key',p_governorate_key)
  FROM public.profiles p
  WHERE p.governorate_key = p_governorate_key;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public.log_admin_action(
    'broadcast_notification',
    'governorate',
    p_governorate_key,
    jsonb_build_object('title',trim(p_title),'sent',v_count)
  );

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_broadcast_notification(text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_notification(text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_broadcast_governorate_notification(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_governorate_notification(text,text,text) TO authenticated;
