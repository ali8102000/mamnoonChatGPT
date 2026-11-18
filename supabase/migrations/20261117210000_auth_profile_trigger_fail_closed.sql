-- A signup must not leave an Auth account without its profile or role.
-- Normalize Iraqi phone numbers and fail closed on duplicates instead of
-- silently assigning a synthetic placeholder phone to a second account.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_phone_digits text;
  v_phone text;
BEGIN
  v_phone_digits := regexp_replace(
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, ''),
    '[^0-9]',
    '',
    'g'
  );

  IF v_phone_digits = '' THEN
    RAISE EXCEPTION 'profile_phone_required';
  END IF;

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
    WHERE p.phone !~ '^user-'
      AND right(regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g'), 10)
          = right(v_phone_digits, 10)
  ) THEN
    RAISE EXCEPTION 'profile_phone_already_registered';
  END IF;

  INSERT INTO public.profiles (id, phone, full_name, email)
  VALUES (
    NEW.id,
    v_phone,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), ''),
    CASE
      WHEN NEW.email LIKE '%@mamnoon.app' THEN NULL
      ELSE lower(NEW.email)
    END
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
