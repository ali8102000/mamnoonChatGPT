-- Integration checks for handle_new_user() against a minimal PostgreSQL Auth schema.
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DO $test$
DECLARE
  v_phone text;
  v_email text;
  v_role_count integer;
  v_id constant uuid := '10000000-0000-4000-8000-000000000001';
  v_auth_phone_id constant uuid := '10000000-0000-4000-8000-000000000002';
  v_admin_id constant uuid := '10000000-0000-4000-8000-000000000003';
  v_duplicate_id constant uuid := '10000000-0000-4000-8000-000000000004';
  v_bad_email_id constant uuid := '10000000-0000-4000-8000-000000000005';
  v_short_phone_id constant uuid := '10000000-0000-4000-8000-000000000006';
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (
    v_id,
    'phone9647701234567@mamnoon.app',
    jsonb_build_object(
      'phone', '07701234567',
      'full_name', 'Test Customer',
      'contact_email', 'TEST@Example.COM'
    )
  );

  SELECT phone, email INTO v_phone, v_email
  FROM public.profiles WHERE id = v_id;

  IF v_phone <> '+9647701234567' THEN
    RAISE EXCEPTION 'phone normalization failed: %', v_phone;
  END IF;
  IF v_email <> 'test@example.com' THEN
    RAISE EXCEPTION 'contact email normalization failed: %', v_email;
  END IF;

  SELECT count(*) INTO v_role_count
  FROM public.user_roles WHERE user_id = v_id AND role = 'customer';
  IF v_role_count <> 1 THEN
    RAISE EXCEPTION 'customer role was not created';
  END IF;

  INSERT INTO auth.users (id, email, phone, raw_user_meta_data)
  VALUES (
    v_auth_phone_id,
    'phone9647801234567@mamnoon.app',
    '+9647801234567',
    jsonb_build_object('full_name', 'Phone Auth User')
  );

  SELECT phone INTO v_phone FROM public.profiles WHERE id = v_auth_phone_id;
  IF v_phone <> '+9647801234567' THEN
    RAISE EXCEPTION 'auth.users.phone fallback failed: %', v_phone;
  END IF;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (
    v_admin_id,
    'admin@example.com',
    jsonb_build_object('full_name', 'Admin User')
  );

  SELECT phone, email INTO v_phone, v_email
  FROM public.profiles WHERE id = v_admin_id;
  IF v_phone <> ('user-' || v_admin_id::text) THEN
    RAISE EXCEPTION 'synthetic phone fallback failed: %', v_phone;
  END IF;
  IF v_email <> 'admin@example.com' THEN
    RAISE EXCEPTION 'regular email account was not preserved: %', v_email;
  END IF;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (
      v_duplicate_id,
      'phone9647701234567@mamnoon.app',
      jsonb_build_object('phone', '+964 770 123 4567', 'full_name', 'Duplicate')
    );
    RAISE EXCEPTION 'expected duplicate phone to be rejected';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'profile_phone_already_registered' THEN
      RAISE;
    END IF;
  END;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_duplicate_id) THEN
    RAISE EXCEPTION 'duplicate Auth user row was not rolled back';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (
      v_short_phone_id,
      'phone9641234567@mamnoon.app',
      jsonb_build_object('phone', '1234567', 'full_name', 'Short Phone')
    );
    RAISE EXCEPTION 'expected short phone to be rejected';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'profile_phone_invalid' THEN
      RAISE;
    END IF;
  END;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_short_phone_id) THEN
    RAISE EXCEPTION 'short-phone Auth user row was not rolled back';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (
      v_bad_email_id,
      'phone9647901234567@mamnoon.app',
      jsonb_build_object(
        'phone', '07901234567',
        'full_name', 'Invalid Email',
        'contact_email', 'not-an-email'
      )
    );
    RAISE EXCEPTION 'expected invalid contact email to be rejected';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'profile_contact_email_invalid' THEN
      RAISE;
    END IF;
  END;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_bad_email_id) THEN
    RAISE EXCEPTION 'invalid-email Auth user row was not rolled back';
  END IF;

  RAISE NOTICE 'PASS: auth profile trigger migration integration checks';
END
$test$;
