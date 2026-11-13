-- Correct Iraqi phone matching for friend discovery and keep profile email
-- synchronized only after the Auth email is confirmed.
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
    AND right(regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g'), 10)
        = right(v_digits, 10)
    AND NOT EXISTS (
      SELECT 1 FROM public.friends f
      WHERE f.user_id = v_uid AND f.friend_id = p.id
    )
  ORDER BY p.created_at DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_verified_auth_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND NEW.email_confirmed_at IS NOT NULL
     AND (
       NEW.email IS DISTINCT FROM OLD.email
       OR NEW.email_confirmed_at IS DISTINCT FROM OLD.email_confirmed_at
     ) THEN
    UPDATE public.profiles
       SET email = lower(NEW.email)
     WHERE id = NEW.id;
  END IF;

  IF NEW.phone IS NOT NULL
     AND NEW.phone_confirmed_at IS NOT NULL
     AND (
       NEW.phone IS DISTINCT FROM OLD.phone
       OR NEW.phone_confirmed_at IS DISTINCT FROM OLD.phone_confirmed_at
     ) THEN
    UPDATE public.profiles
       SET phone = NEW.phone
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.search_profiles_for_friend(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profiles_for_friend(text) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_verified_auth_contacts() FROM PUBLIC, anon, authenticated;
