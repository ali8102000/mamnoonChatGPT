-- Keep the public profile contact fields aligned only with verified Auth contacts.
-- The client cannot directly change profiles.phone/email to bypass verification.
CREATE OR REPLACE FUNCTION public.sync_verified_auth_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE public.profiles
       SET email = lower(NEW.email)
     WHERE id = NEW.id;
  END IF;

  IF NEW.phone IS DISTINCT FROM OLD.phone
     AND NEW.phone IS NOT NULL
     AND NEW.phone_confirmed_at IS NOT NULL THEN
    UPDATE public.profiles
       SET phone = NEW.phone
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_verified_auth_contacts() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sync_verified_auth_contacts ON auth.users;
CREATE TRIGGER sync_verified_auth_contacts
AFTER UPDATE OF email, phone, phone_confirmed_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_verified_auth_contacts();
