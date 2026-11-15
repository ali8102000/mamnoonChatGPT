-- Keep role lookup self-scoped; only the super admin may inspect another user's staff roles.
CREATE OR REPLACE FUNCTION public.get_staff_roles(p_user_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE(
    (SELECT array_agg(role::text ORDER BY role::text) FROM public.user_roles
     WHERE user_id=p_user_id AND role::text IN ('super_admin','admin','support','finance','moderator')),
    ARRAY[]::text[]
  );
END
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_staff_roles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_roles(uuid) TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated
USING (user_id=auth.uid() OR has_admin_access(auth.uid()));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admin_delete_friendship(p_user1_id uuid,p_user2_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.has_friend_admin_access(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.friends WHERE (user_id=p_user1_id AND friend_id=p_user2_id) OR (user_id=p_user2_id AND friend_id=p_user1_id);
  PERFORM public.log_admin_action('delete_friendship','user',p_user1_id::text,jsonb_build_object('other',p_user2_id));
END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admin_delete_friend_request(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.has_friend_admin_access(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.friend_requests WHERE id=p_request_id;
  PERFORM public.log_admin_action('delete_friend_request','friend_request',p_request_id::text);
END
$fn$;
