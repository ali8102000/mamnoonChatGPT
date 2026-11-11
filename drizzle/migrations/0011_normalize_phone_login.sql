-- Match Iraqi mobile numbers consistently whether entered as 07..., 7...,
-- 9647..., or +9647..., while keeping this lookup server-only.
CREATE OR REPLACE FUNCTION public.lookup_email_by_phone(_phone text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_email text;
BEGIN
  v_digits := regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g');
  IF length(v_digits) < 8 OR length(v_digits) > 15 THEN
    RETURN NULL;
  END IF;

  SELECT lower(u.email::text)
    INTO v_email
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE p.phone IS NOT NULL
     AND length(regexp_replace(p.phone, '[^0-9]', '', 'g')) BETWEEN 8 AND 15
     AND right(regexp_replace(p.phone, '[^0-9]', '', 'g'), 10) = right(v_digits, 10)
   ORDER BY p.created_at DESC
   LIMIT 1;

  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_email_by_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_email_by_phone(text) TO service_role;
