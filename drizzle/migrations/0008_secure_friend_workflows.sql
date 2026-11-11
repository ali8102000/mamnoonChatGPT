-- Secure friend discovery, listing, and acceptance for the mobile client.
-- All functions derive the caller from auth.uid(); callers cannot act for another user.

CREATE OR REPLACE FUNCTION public.search_profiles_for_friend(_phone text)
RETURNS TABLE(id uuid, full_name text, phone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_digits text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  v_digits := regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g');
  IF length(v_digits) < 8 OR length(v_digits) > 15 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.phone
  FROM public.profiles p
  WHERE p.id <> v_uid
    AND (
      regexp_replace(p.phone, '[^0-9]', '', 'g') = v_digits
      OR regexp_replace(p.phone, '[^0-9]', '', 'g') = right(v_digits, 10)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.friends f
      WHERE f.user_id = v_uid AND f.friend_id = p.id
    )
  ORDER BY p.created_at DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_friends()
RETURNS TABLE(id uuid, full_name text, phone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.phone
  FROM public.friends f
  JOIN public.profiles p ON p.id = f.friend_id
  WHERE f.user_id = v_uid
  ORDER BY p.full_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_pending_friend_requests()
RETURNS TABLE(id uuid, sender_id uuid, sender_full_name text, sender_phone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
  SELECT fr.id, fr.sender_id, p.full_name, p.phone
  FROM public.friend_requests fr
  JOIN public.profiles p ON p.id = fr.sender_id
  WHERE fr.receiver_id = v_uid AND fr.status = 'pending'
  ORDER BY fr.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_friend_request(_request_id uuid, _accept boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sender uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  UPDATE public.friend_requests
  SET status = CASE WHEN _accept THEN 'accepted' ELSE 'rejected' END
  WHERE id = _request_id
    AND receiver_id = v_uid
    AND status = 'pending'
  RETURNING sender_id INTO v_sender;

  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'friend_request_not_found_or_already_handled';
  END IF;

  IF _accept THEN
    INSERT INTO public.friends (user_id, friend_id)
    VALUES (v_uid, v_sender), (v_sender, v_uid)
    ON CONFLICT (user_id, friend_id) DO NOTHING;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.search_profiles_for_friend(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_friends() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_pending_friend_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_friend_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profiles_for_friend(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_friends() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_friend_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) TO authenticated;
