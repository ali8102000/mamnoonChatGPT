-- Align privileged RPC checks with the granular permission system.
-- Platform admins keep their existing access; delegated staff must hold the
-- matching permission for the target user's/request's governorate.

CREATE OR REPLACE FUNCTION public.admin_set_provider_status(
  p_user_id uuid,
  p_type text,
  p_status text,
  p_suspended_until timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_role public.app_role;
  v_updated integer;
  v_governorate text;
  v_permission text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('approved','suspended','rejected','pending') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF p_type IS NULL OR p_type NOT IN ('driver','large_driver','worker') THEN
    RAISE EXCEPTION 'invalid_type';
  END IF;

  IF p_status = 'suspended' AND p_suspended_until IS NOT NULL AND p_suspended_until <= now() THEN
    RAISE EXCEPTION 'invalid_suspension_expiry';
  END IF;

  SELECT governorate_key INTO v_governorate
  FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider_unavailable'; END IF;

  v_permission := CASE WHEN p_status = 'suspended' THEN 'providers.suspend' ELSE 'providers.verify' END;
  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission(
      v_permission,
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    )
  ) THEN
    RAISE EXCEPTION 'provider_unavailable';
  END IF;

  IF p_type = 'driver' THEN
    v_role := 'driver';
    UPDATE public.driver_profiles SET status=p_status,
      suspended_until=CASE WHEN p_status='suspended' THEN p_suspended_until ELSE NULL END,
      available=CASE WHEN p_status='approved' THEN available ELSE false END
    WHERE user_id=p_user_id AND vehicle_category::text <> 'large';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSIF p_type = 'large_driver' THEN
    v_role := 'large_driver';
    UPDATE public.driver_profiles SET status=p_status,
      suspended_until=CASE WHEN p_status='suspended' THEN p_suspended_until ELSE NULL END,
      available=CASE WHEN p_status='approved' THEN available ELSE false END
    WHERE user_id=p_user_id AND vehicle_category::text = 'large';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSE
    v_role := 'worker';
    UPDATE public.worker_profiles SET status=p_status,
      suspended_until=CASE WHEN p_status='suspended' THEN p_suspended_until ELSE NULL END,
      available=CASE WHEN p_status='approved' THEN available ELSE false END
    WHERE user_id=p_user_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  IF v_updated=0 THEN RAISE EXCEPTION 'provider_unavailable'; END IF;

  IF p_status='approved' THEN
    INSERT INTO public.user_roles(user_id,role)
    VALUES(p_user_id,v_role)
    ON CONFLICT(user_id,role) DO NOTHING;
  ELSIF p_status IN ('rejected','pending') THEN
    DELETE FROM public.user_roles WHERE user_id=p_user_id AND role=v_role;
  END IF;

  PERFORM public.log_admin_action(
    'set_provider_status',p_type,p_user_id::text,
    jsonb_build_object('status',p_status,'suspended_until',p_suspended_until,
      'granted_role',CASE WHEN p_status='approved' THEN v_role::text ELSE NULL END)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_block_user(
  p_user_id uuid,
  p_reason text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_governorate text;
BEGIN
  SELECT governorate_key INTO v_governorate
  FROM public.profiles WHERE id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_unavailable'; END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission(
      'users.block',
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    )
  ) THEN
    RAISE EXCEPTION 'user_unavailable';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_user_id AND role='super_admin') THEN
    RAISE EXCEPTION 'cannot_block_super_admin';
  END IF;

  INSERT INTO public.user_blocks(user_id,blocked_by,reason,expires_at)
  VALUES(p_user_id,auth.uid(),p_reason,p_expires_at)
  ON CONFLICT(user_id) DO UPDATE
    SET blocked_by=EXCLUDED.blocked_by,
        reason=EXCLUDED.reason,
        expires_at=EXCLUDED.expires_at,
        blocked_at=now();

  UPDATE public.driver_profiles SET available=false WHERE user_id=p_user_id;
  UPDATE public.worker_profiles SET available=false WHERE user_id=p_user_id;

  PERFORM public.log_admin_action('block_user','user',p_user_id::text,jsonb_build_object('reason',p_reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_unblock_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_governorate text;
BEGIN
  SELECT governorate_key INTO v_governorate
  FROM public.profiles WHERE id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_unavailable'; END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission(
      'users.unblock',
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    )
  ) THEN
    RAISE EXCEPTION 'user_unavailable';
  END IF;

  DELETE FROM public.user_blocks WHERE user_id=p_user_id;
  PERFORM public.log_admin_action('unblock_user','user',p_user_id::text);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_request(p_request_id uuid,p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_governorate text;
BEGIN
  SELECT governorate_key INTO v_governorate
  FROM public.service_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_unavailable'; END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission(
      'orders.cancel',
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    )
  ) THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  UPDATE public.service_requests
  SET status='cancelled',cancelled_by=auth.uid(),
      cancellation_reason=COALESCE(left(p_reason,500),'ألغته الإدارة')
  WHERE id=p_request_id AND status NOT IN ('completed','cancelled');

  DELETE FROM public.request_offers WHERE request_id=p_request_id;
  PERFORM public.log_admin_action('cancel_request','request',p_request_id::text,jsonb_build_object('reason',p_reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reopen_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_governorate text;
BEGIN
  SELECT governorate_key INTO v_governorate
  FROM public.service_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_unavailable'; END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission(
      'orders.reopen',
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    )
  ) THEN
    RAISE EXCEPTION 'request_unavailable';
  END IF;

  UPDATE public.service_requests
  SET status='searching',provider_id=NULL,accepted_at=NULL,
      searching_started_at=now(),cancellation_reason=NULL
  WHERE id=p_request_id AND status='cancelled';

  PERFORM public.log_admin_action('reopen_request','request',p_request_id::text);
END;
$function$;


-- Secure report, private-chat, and friendship moderation RPCs independently
-- of the Edge Function. Legacy moderation roles remain global-only; regional
-- staff must hold an explicit permission grant for the target governorate.

CREATE OR REPLACE FUNCTION public.admin_resolve_report(
  p_report_id uuid,
  p_status text,
  p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reported_id uuid;
  v_governorate text;
BEGIN
  IF p_report_id IS NULL OR p_status IS NULL
     OR p_status NOT IN ('resolved','closed','dismissed')
     OR (p_note IS NOT NULL AND length(p_note)>500) THEN
    RAISE EXCEPTION 'invalid_report_resolution';
  END IF;

  SELECT reported_id INTO v_reported_id
  FROM public.user_reports
  WHERE id=p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'report_unavailable'; END IF;

  SELECT governorate_key INTO v_governorate
  FROM public.profiles WHERE id=v_reported_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'report_unavailable'; END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission(
      'reports.resolve',
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    )
    OR (
      public.has_user_moderation_access(auth.uid())
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_assignments
        WHERE user_id=auth.uid() AND active=true AND scope_type='governorate'
      )
    )
  ) THEN
    RAISE EXCEPTION 'report_unavailable';
  END IF;

  UPDATE public.user_reports
  SET status=p_status,
      resolution_note=NULLIF(trim(coalesce(p_note,'')),''),
      resolved_by=auth.uid(),
      resolved_at=now()
  WHERE id=p_report_id;

  PERFORM public.log_admin_action(
    'resolve_report','report',p_report_id::text,
    jsonb_build_object('status',p_status)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_chat_id uuid;
BEGIN
  IF p_message_id IS NULL THEN RAISE EXCEPTION 'message_unavailable'; END IF;
  SELECT chat_id INTO v_chat_id FROM public.messages WHERE id=p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'message_unavailable'; END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission('chats.moderate','global',NULL)
    OR (
      public.has_chat_moderation_access(auth.uid())
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_assignments
        WHERE user_id=auth.uid() AND active=true AND scope_type='governorate'
      )
      AND NOT public.is_customer_service_staff(auth.uid())
    )
  ) THEN
    RAISE EXCEPTION 'message_unavailable';
  END IF;

  DELETE FROM public.messages WHERE id=p_message_id;
  PERFORM public.log_admin_action('delete_message','message',p_message_id::text,
    jsonb_build_object('chat_id',v_chat_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_friendship(p_user1_id uuid,p_user2_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_user1_id IS NULL OR p_user2_id IS NULL OR p_user1_id=p_user2_id THEN
    RAISE EXCEPTION 'friendship_unavailable';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user1_id)
     OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user2_id) THEN
    RAISE EXCEPTION 'friendship_unavailable';
  END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission('friends.manage','global',NULL)
    OR (
      public.has_friend_admin_access(auth.uid())
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_assignments
        WHERE user_id=auth.uid() AND active=true AND scope_type='governorate'
      )
    )
  ) THEN
    RAISE EXCEPTION 'friendship_unavailable';
  END IF;

  DELETE FROM public.friends
  WHERE (user_id=p_user1_id AND friend_id=p_user2_id)
     OR (user_id=p_user2_id AND friend_id=p_user1_id);
  PERFORM public.log_admin_action('delete_friendship','user',p_user1_id::text,
    jsonb_build_object('other',p_user2_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_friend_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_request_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.friend_requests WHERE id=p_request_id
  ) THEN
    RAISE EXCEPTION 'friend_request_unavailable';
  END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission('friends.manage','global',NULL)
    OR (
      public.has_friend_admin_access(auth.uid())
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_assignments
        WHERE user_id=auth.uid() AND active=true AND scope_type='governorate'
      )
    )
  ) THEN
    RAISE EXCEPTION 'friend_request_unavailable';
  END IF;

  DELETE FROM public.friend_requests WHERE id=p_request_id;
  PERFORM public.log_admin_action('delete_friend_request','friend_request',p_request_id::text);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_resolve_report(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_report(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_message(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_friendship(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_friendship(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_friend_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_friend_request(uuid) TO authenticated;


-- Register the additional permission keys used by the scoped monitoring APIs.
INSERT INTO public.admin_permission_catalog
  (permission_key,domain,label_ar,risk_level,description,active)
VALUES
  ('live_map.read','operations','عرض الخريطة المباشرة','sensitive','قراءة مواقع الطلبات النشطة ضمن نطاق المحافظة',true),
  ('reports.read','reports','عرض البلاغات','normal','قراءة البلاغات عن المستخدمين ضمن نطاق المحافظة',true),
  ('reports.resolve','reports','معالجة البلاغات','sensitive','إغلاق أو معالجة بلاغات المستخدمين ضمن نطاق المحافظة',true),
  ('chats.moderate','communications','إدارة الدردشة الخاصة','sensitive','مراجعة وحذف الرسائل ضمن الصلاحية العامة الممنوحة',true),
  ('friends.manage','social','إدارة الأصدقاء','sensitive','مراجعة وإدارة علاقات وطلبات الصداقة بصلاحية عامة',true)
ON CONFLICT (permission_key) DO UPDATE
SET domain=EXCLUDED.domain,
    label_ar=EXCLUDED.label_ar,
    risk_level=EXCLUDED.risk_level,
    description=EXCLUDED.description,
    active=true;
