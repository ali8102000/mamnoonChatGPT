-- Allow a driver to resubmit a rejected application without allowing self-approval.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_provider_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_admin_access(auth.uid()) THEN

    IF TG_OP = 'INSERT' THEN
      IF TG_TABLE_NAME = 'driver_profiles' THEN
        NEW.status := 'pending';
      ELSE
        NEW.status := 'approved';
      END IF;

    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        TG_TABLE_NAME = 'driver_profiles'
        AND auth.uid() = OLD.user_id
        AND OLD.status = 'rejected'
        AND NEW.status = 'pending'
      ) THEN
        RAISE EXCEPTION 'status_readonly';
      END IF;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.rating_avg IS DISTINCT FROM OLD.rating_avg THEN
      RAISE EXCEPTION 'rating_readonly';
    END IF;

    IF NEW.status <> 'approved' AND NEW.available THEN
      NEW.available := false;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

COMMIT;
