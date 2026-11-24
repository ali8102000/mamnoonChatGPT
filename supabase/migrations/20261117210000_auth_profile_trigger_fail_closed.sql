-- Keep every new Auth user paired with a profile and customer role.
-- Normalize supplied Iraqi phone numbers and reject duplicate phone identities.
-- Email-only/admin-created users retain a non-contact synthetic profile phone.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_phone_input text;
  v_phone_digits text;
  v_phone text;
  v_contact_email text;
  v_profile_email text;
BEGIN
  v_phone_input := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NEW.phone,
    ''
  );

  v_phone_digits := regexp_replace(v_phone_input, '[^0-9]', '', 'g');

  IF v_phone_digits = '' THEN
    v_phone := 'user-' || NEW.id::text;
  ELSE
    IF left(v_phone_digits, 2) = '00' THEN
      v_phone_digits := substr(v_phone_digits, 3);
    END IF;

    IF left(v_phone_digits, 1) = '0' THEN
      v_phone_digits := '964' || substr(v_phone_digits, 2);
    ELSIF left(v_phone_digits, 3) <> '964' THEN
      v_phone_digits := '964' || v_phone_digits;
    END IF;

    IF length(v_phone_digits) < 12 OR length(v_phone_digits) > 15 THEN
      RAISE EXCEPTION 'profile_phone_invalid';
    END IF;

    v_phone := '+' || v_phone_digits;

    IF EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id <> NEW.id
        AND p.phone !~ '^user-'
        AND right(regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g'), 10)
            = right(v_phone_digits, 10)
    ) THEN
      RAISE EXCEPTION 'profile_phone_already_registered';
    END IF;
  END IF;

  v_contact_email := NULLIF(
    lower(trim(COALESCE(NEW.raw_user_meta_data->>'contact_email', ''))),
    ''
  );

  IF v_contact_email IS NOT NULL
     AND v_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'profile_contact_email_invalid';
  END IF;

  v_profile_email := CASE
    WHEN NEW.email LIKE '%@mamnoon.app' THEN v_contact_email
    ELSE lower(NEW.email)
  END;

  INSERT INTO public.profiles (id, phone, full_name, email)
  VALUES (
    NEW.id,
    v_phone,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), ''),
    v_profile_email
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
