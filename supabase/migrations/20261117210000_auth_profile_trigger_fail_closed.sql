-- Fail the Auth user insert transaction if its required profile/role bootstrap fails.
-- The old WHEN OTHERS handler swallowed profile insertion errors and returned
-- NEW, which could leave an Auth account without its public profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
BEGIN
  v_phone := NULLIF(trim(NEW.raw_user_meta_data->>'phone'), '');

  IF v_phone IS NULL
     OR EXISTS (SELECT 1 FROM public.profiles WHERE phone = v_phone) THEN
    v_phone := 'user-' || NEW.id::text;
  END IF;

  INSERT INTO public.profiles (id, phone, full_name, email)
  VALUES (
    NEW.id,
    v_phone,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
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
END
$$;
